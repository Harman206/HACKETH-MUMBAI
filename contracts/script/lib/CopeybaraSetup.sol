// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {ISafe, ISafeProxyFactory} from "../../src/interfaces/ISafe.sol";
import {
    IETHRegistrar,
    IMockERC20,
    IPermissionedRegistry,
    IPermissionedResolver,
    IUserRegistry,
    IVerifiableFactory,
    ENSName,
    ENSv2Roles
} from "../../src/interfaces/IENSv2.sol";
import {SafeExec} from "./SafeExec.sol";

/// Shared setup steps used by both the live scripts and the fork tests.
abstract contract CopeybaraSetup is Script {
    struct Cfg {
        address factory;
        address resolverImpl;
        address registrar;
        address registry;
        address paymentToken;
        address universalResolver;
        address safeFactory;
        address safeSingleton;
        address safeFallback;
    }

    uint64 internal constant DURATION = 365 days;

    /// contracts-v2 UserRegistry implementation on Sepolia (contracts/docs/addresses/sepolia.md). Not in
    /// config/networks.json on purpose: that file is a kit trust root and the kit never reads subnames.
    address internal constant USER_REGISTRY_IMPL = 0x840Fa461059862Ea466A711E8C98c8dE732061C0;
    string internal constant KEY_AGENT = "org.copeybara.agent";
    string internal constant KEY_STATUS = "org.copeybara.status";
    string internal constant KEY_BLOCKLIST = "org.copeybara.blocklist";

    /// An agent's ENS identity: <sub>.<label>.eth, addr = the agent's key, text records describing what it may do.
    struct Agent {
        string sub;
        address addr;
        string description;
        string json; // org.copeybara.agent
        string url;
    }

    function loadCfg() internal view returns (Cfg memory c) {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), "/../config/networks.json"));
        c.factory = vm.parseJsonAddress(j, ".ens.verifiableFactory");
        c.resolverImpl = vm.parseJsonAddress(j, ".ens.permissionedResolverImpl");
        c.registrar = vm.parseJsonAddress(j, ".ens.ethRegistrar");
        c.registry = vm.parseJsonAddress(j, ".ens.ethRegistry");
        c.paymentToken = vm.parseJsonAddress(j, ".ens.paymentToken");
        c.universalResolver = vm.parseJsonAddress(j, ".ens.universalResolver");
        c.safeFactory = vm.parseJsonAddress(j, ".safe.proxyFactory");
        c.safeSingleton = vm.parseJsonAddress(j, ".safe.singletonL2");
        c.safeFallback = vm.parseJsonAddress(j, ".safe.fallbackHandler");
    }

    function deploySafe(Cfg memory c, address[] memory owners, uint256 threshold, uint256 saltNonce)
        internal
        returns (ISafe)
    {
        bytes memory init = abi.encodeCall(
            ISafe.setup, (owners, threshold, address(0), "", c.safeFallback, address(0), 0, payable(address(0)))
        );
        return ISafe(ISafeProxyFactory(c.safeFactory).createProxyWithNonce(c.safeSingleton, init, saltNonce));
    }

    /// Deploy the per-app PermissionedResolver. Only `admin` (the Safe) receives roles.
    /// `keys`/`values` are written during initialize (no role checks while initializing).
    function deployResolver(Cfg memory c, address admin, string memory label, string[] memory keys, string[] memory values)
        internal
        returns (IPermissionedResolver)
    {
        bytes memory dns = ENSName.dnsEncodeEth(label);
        bytes[] memory calls = new bytes[](keys.length);
        for (uint256 i; i < keys.length; ++i) {
            calls[i] = abi.encodeCall(IPermissionedResolver.setText, (dns, keys[i], values[i]));
        }
        IPermissionedResolver.Grant[] memory grants = new IPermissionedResolver.Grant[](1);
        grants[0] = IPermissionedResolver.Grant(admin, ENSv2Roles.ALL_ROLES);
        bytes memory init = abi.encodeCall(IPermissionedResolver.initialize, (grants, calls));
        uint256 salt = uint256(keccak256(abi.encodePacked("blackout:", label)));
        return IPermissionedResolver(IVerifiableFactory(c.factory).deployProxy(c.resolverImpl, salt, init));
    }

    function commitment(Cfg memory c, string memory label, address owner, address resolver, bytes32 secret)
        internal
        pure
        returns (bytes32)
    {
        return IETHRegistrar(c.registrar).makeCommitment(label, owner, secret, address(0), resolver, DURATION, bytes32(0));
    }

    /// Pay with mock USDC (free mint on Sepolia) and commit. Caller is the payer.
    function payAndCommit(Cfg memory c, string memory label, address owner, address resolver, bytes32 secret, address payer)
        internal
    {
        (uint256 base, uint256 premium) = IETHRegistrar(c.registrar).getRegisterPrice(label, DURATION, c.paymentToken);
        IMockERC20(c.paymentToken).mint(payer, base + premium);
        IMockERC20(c.paymentToken).approve(c.registrar, base + premium);
        IETHRegistrar(c.registrar).commit(commitment(c, label, owner, resolver, secret));
    }

    function register(Cfg memory c, string memory label, address owner, address resolver, bytes32 secret)
        internal
        returns (uint256 tokenId)
    {
        return IETHRegistrar(c.registrar).register(
            label, owner, secret, address(0), resolver, DURATION, c.paymentToken, bytes32(0)
        );
    }

    /// Safe grants the website key ROLE_SET_TEXT on the `url` record only.
    function grantUrlRole(ISafe safe, IPermissionedResolver resolver, string memory label, address webKey, uint256[] memory keys)
        internal
    {
        // Only the selector and the key matter; name and value inside the setter are ignored.
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "url", ""));
        bytes memory call_ = abi.encodeCall(IPermissionedResolver.grantSetterRoles, (setter, webKey));
        require(SafeExec.exec(safe, address(resolver), call_, keys), "grant failed");
    }

    /// Safe grants the watcher key ROLE_SET_TEXT on org.copeybara.status and org.copeybara.blocklist only:
    /// it can raise or clear a warning, never touch the release, manifest, site fingerprint or url.
    function grantWatcherRoles(ISafe safe, IPermissionedResolver resolver, string memory label, address watcher, uint256[] memory keys)
        internal
    {
        string[2] memory ks = ["org.copeybara.status", "org.copeybara.blocklist"];
        for (uint256 i; i < 2; ++i) {
            bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), ks[i], ""));
            bytes memory call_ = abi.encodeCall(IPermissionedResolver.grantSetterRoles, (setter, watcher));
            require(SafeExec.exec(safe, address(resolver), call_, keys), "watcher grant failed");
        }
    }

    function safeSetText(ISafe safe, IPermissionedResolver resolver, string memory label, string memory key, string memory value, uint256[] memory keys)
        internal
    {
        bytes memory call_ = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), key, value));
        require(SafeExec.exec(safe, address(resolver), call_, keys), "setText failed");
    }

    /// ENSIP-7 contenthash (the kit on IPFS), written by the Safe like every release record.
    function safeSetContenthash(ISafe safe, IPermissionedResolver resolver, string memory label, bytes memory hash, uint256[] memory keys)
        internal
    {
        bytes memory call_ = abi.encodeCall(IPermissionedResolver.setContenthash, (ENSName.dnsEncodeEth(label), hash));
        require(SafeExec.exec(safe, address(resolver), call_, keys), "setContenthash failed");
    }

    // ---- the watcher agent: identity as an ENSv2 subname, roles the Safe can revoke and re-grant ----

    /// org.copeybara.agent for the watcher of `parentName`, operated by `operator` (the Safe).
    function watcherAgentJson(string memory parentName, address operator) internal pure returns (string memory) {
        return string.concat(
            '{"role":"watcher","may_write":["', KEY_STATUS, '","', KEY_BLOCKLIST, '"],"of":"', parentName,
            '","operator":"', vm.toString(operator), '","code":"apps/watcher","version":1}'
        );
    }

    /// A PermissionedResolver for the agent subname only, records written during initialize. Only `admin` (the Safe)
    /// holds roles: neither the website key nor the watcher key has any grant on it, so the agent cannot rewrite
    /// its own identity (resolver roles are per resolver, which is why it is not the parent's resolver).
    function deployAgentResolver(Cfg memory c, address admin, string memory label, Agent memory a)
        internal
        returns (IPermissionedResolver)
    {
        bytes memory dns = ENSName.dnsEncodeSub(a.sub, label);
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(IPermissionedResolver.setText, (dns, "description", a.description));
        calls[1] = abi.encodeCall(IPermissionedResolver.setText, (dns, KEY_AGENT, a.json));
        calls[2] = abi.encodeCall(IPermissionedResolver.setText, (dns, "url", a.url));
        calls[3] = abi.encodeCall(IPermissionedResolver.setAddress, (dns, 60, abi.encodePacked(a.addr)));
        IPermissionedResolver.Grant[] memory grants = new IPermissionedResolver.Grant[](1);
        grants[0] = IPermissionedResolver.Grant(admin, ENSv2Roles.ALL_ROLES);
        bytes memory init = abi.encodeCall(IPermissionedResolver.initialize, (grants, calls));
        uint256 salt = uint256(keccak256(abi.encodePacked("copeybara-agent:", a.sub, ".", label)));
        return IPermissionedResolver(IVerifiableFactory(c.factory).deployProxy(c.resolverImpl, salt, init));
    }

    /// A UserRegistry (subname registry) for `label`.eth; only `admin` (the Safe) holds roles.
    function deployUserRegistry(Cfg memory c, address admin, string memory label) internal returns (IUserRegistry) {
        bytes memory init = abi.encodeCall(IUserRegistry.initialize, (admin, ENSv2Roles.ALL_ROLES));
        uint256 salt = uint256(keccak256(abi.encodePacked("copeybara-subnames:", label)));
        return IUserRegistry(IVerifiableFactory(c.factory).deployProxy(USER_REGISTRY_IMPL, salt, init));
    }

    /// Roles the Safe keeps on the subname token (it also holds every root role on the subregistry).
    function subnameTokenRoles() internal pure returns (uint256) {
        return ENSv2Roles.ROLE_SET_RESOLVER | (ENSv2Roles.ROLE_SET_RESOLVER << 128) | ENSv2Roles.ROLE_SET_SUBREGISTRY
            | (ENSv2Roles.ROLE_SET_SUBREGISTRY << 128) | ENSv2Roles.ROLE_RENEW | (ENSv2Roles.ROLE_RENEW << 128)
            | ENSv2Roles.ROLE_CAN_TRANSFER_ADMIN;
    }

    /// Safe: point <label>.eth at the subregistry (skipped if already set), record its parent, register <sub> owned
    /// by the Safe with `resolver`, expiring with the parent. Three Safe transactions at most.
    function attachSubname(
        ISafe safe,
        Cfg memory c,
        string memory label,
        IUserRegistry subregistry,
        string memory sub,
        address resolver,
        uint256[] memory keys
    ) internal {
        IPermissionedRegistry eth = IPermissionedRegistry(c.registry);
        uint256 parentId = uint256(keccak256(bytes(label)));
        if (eth.getSubregistry(label) != address(subregistry)) {
            bytes memory set_ = abi.encodeCall(IPermissionedRegistry.setSubregistry, (parentId, address(subregistry)));
            require(SafeExec.exec(safe, c.registry, set_, keys), "setSubregistry failed");
        }
        (address parent,) = subregistry.getParent();
        if (parent != c.registry) {
            bytes memory par = abi.encodeCall(IPermissionedRegistry.setParent, (c.registry, label));
            require(SafeExec.exec(safe, address(subregistry), par, keys), "setParent failed");
        }
        uint64 expiry = eth.getExpiry(parentId);
        bytes memory reg =
            abi.encodeCall(IPermissionedRegistry.register, (sub, address(safe), address(0), resolver, subnameTokenRoles(), expiry));
        require(SafeExec.exec(safe, address(subregistry), reg, keys), "register subname failed");
    }

    /// Safe takes the watcher's setter roles away (one Safe transaction: resolver multicall of two revokes).
    function revokeWatcherRoles(ISafe safe, IPermissionedResolver resolver, address watcher, uint256[] memory keys) internal {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            IPermissionedResolver.revokeRoles, (ENSName.textResource(KEY_STATUS), ENSv2Roles.ROLE_SET_TEXT, watcher)
        );
        calls[1] = abi.encodeCall(
            IPermissionedResolver.revokeRoles, (ENSName.textResource(KEY_BLOCKLIST), ENSv2Roles.ROLE_SET_TEXT, watcher)
        );
        bytes memory call_ = abi.encodeWithSignature("multicall(bytes[])", calls);
        require(SafeExec.exec(safe, address(resolver), call_, keys), "watcher revoke failed");
    }

    function watcherCanWrite(IPermissionedResolver resolver, address watcher) internal view returns (bool status, bool blocklist) {
        status = resolver.hasRoles(ENSName.textResource(KEY_STATUS), ENSv2Roles.ROLE_SET_TEXT, watcher);
        blocklist = resolver.hasRoles(ENSName.textResource(KEY_BLOCKLIST), ENSv2Roles.ROLE_SET_TEXT, watcher);
    }
}
