// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Signatures from the live Sepolia bytecode, ENS docs, ensjs-abi v2 and ensdomains/verifiable-factory.
/// See docs/ens-notes.md for sources and how they differ from the PRD.

interface IEnhancedAccessControl {
    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotRevokeRoles(uint256 resource, uint256 roleBitmap, address account);

    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function roles(uint256 resource, address account) external view returns (uint256);
    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);
    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);
}

/// Live Sepolia PermissionedResolver (impl 0x115e…2b2c). Name-based setters, argument-scoped grants.
/// Matches ensdomains/docs ensv2/permissioned-resolver and ensjs-abi v2, not the contracts-v2 main branch.
interface IPermissionedResolver is IEnhancedAccessControl {
    struct Grant {
        address account;
        uint256 roleBitmap;
    }

    function initialize(Grant[] calldata grants, bytes[] calldata calls) external;
    function setText(bytes calldata name, string calldata key, string calldata value) external;
    function setContenthash(bytes calldata name, bytes calldata hash) external;
    function grantSetterRoles(bytes calldata setter, address account) external returns (bool);
    function revokeRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory);
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
}

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address);
    function predictProxyAddress(address deployer, uint256 salt) external view returns (address);
}

interface IETHRegistrar {
    function MIN_COMMITMENT_AGE() external view returns (uint64);
    function commit(bytes32 commitment) external;
    function isAvailable(string calldata label) external view returns (bool);
    function getRegisterPrice(string calldata label, uint64 duration, address paymentToken)
        external
        view
        returns (uint256 base, uint256 premium);
    function makeCommitment(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        bytes32 referrer
    ) external pure returns (bytes32);
    function register(
        string calldata label,
        address owner,
        bytes32 secret,
        address subregistry,
        address resolver,
        uint64 duration,
        address paymentToken,
        bytes32 referrer
    ) external returns (uint256 tokenId);
    function ETH_REGISTRY() external view returns (address);
}

interface IPermissionedRegistry is IEnhancedAccessControl {
    function setResolver(uint256 anyId, address resolver) external;
    function getResolver(string calldata label) external view returns (address);
    function getOwner(uint256 anyId) external view returns (address);
    function getResource(uint256 anyId) external view returns (uint256);
}

interface IUniversalResolverV2 {
    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory, address);
}

interface IMockERC20 {
    function mint(address to, uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

library ENSv2Roles {
    // PermissionedResolverLib
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;
    // RegistryRolesLib
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    // EACBaseRolesLib
    uint256 internal constant ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;
}

library ENSName {
    /// DNS-encode a single-label .eth name, e.g. "demoswap-blackout" → \x11demoswap-blackout\x03eth\x00
    function dnsEncodeEth(string memory label) internal pure returns (bytes memory) {
        bytes memory l = bytes(label);
        require(l.length > 0 && l.length < 64, "label length");
        return abi.encodePacked(uint8(l.length), l, uint8(3), "eth", uint8(0));
    }

    function namehashEth(string memory label) internal pure returns (bytes32) {
        bytes32 ethNode = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        return keccak256(abi.encodePacked(ethNode, keccak256(bytes(label))));
    }

    /// Resolver resource for a text key: keccak256(bytes(key)). Names play no part (docs: Resource Scheme).
    function textResource(string memory key) internal pure returns (uint256) {
        return uint256(keccak256(bytes(key)));
    }
}
