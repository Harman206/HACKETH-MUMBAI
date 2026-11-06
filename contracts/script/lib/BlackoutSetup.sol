// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {ISafe, ISafeProxyFactory} from "../../src/interfaces/ISafe.sol";
import {
    IETHRegistrar,
    IMockERC20,
    IPermissionedResolver,
    IVerifiableFactory,
    ENSName,
    ENSv2Roles
} from "../../src/interfaces/IENSv2.sol";
import {SafeExec} from "./SafeExec.sol";

/// Shared setup steps used by both the live scripts and the fork tests.
abstract contract BlackoutSetup is Script {
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
}
