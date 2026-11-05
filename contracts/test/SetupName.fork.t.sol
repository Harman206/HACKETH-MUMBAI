// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BlackoutSetup} from "../script/lib/BlackoutSetup.sol";
import {ISafe} from "../src/interfaces/ISafe.sol";
import {
    IPermissionedRegistry,
    IPermissionedResolver,
    IUniversalResolverV2,
    ENSName,
    ENSv2Roles
} from "../src/interfaces/IENSv2.sol";

/// Shared fixture: a fresh 2-of-3 Safe owning a fresh name with a scoped web key.
abstract contract BlackoutForkFixture is Test, BlackoutSetup {
    Cfg internal c;
    ISafe internal safe;
    IPermissionedResolver internal resolver;
    uint256 internal tokenId;
    string internal label;
    bytes32 internal node;
    uint256[] internal ownerKeys;
    address internal deployer = makeAddr("deployer");
    uint256 internal webKeyPk = 0xB0B;
    address internal webKey;

    string internal constant RELEASE_V1 = "sha256:abababababababababababababababababababababababababababababababab;v=1";
    string internal constant MANIFEST = '{"v":1,"c":{}}';

    function setUp() public virtual {
        vm.createSelectFork(vm.envString("SEPOLIA_RPC"));
        c = loadCfg();
        webKey = vm.addr(webKeyPk);
        label = string.concat("blackout-fork-", vm.toString(block.number));
        node = ENSName.namehashEth(label);

        address[] memory owners = new address[](3);
        ownerKeys = new uint256[](2);
        for (uint256 i; i < 3; ++i) owners[i] = vm.addr(0xA11CE + i);
        ownerKeys[0] = 0xA11CE;
        ownerKeys[1] = 0xA11CE + 2;
        safe = deploySafe(c, owners, 2, block.number);

        string[] memory keys = new string[](3);
        string[] memory vals = new string[](3);
        (keys[0], vals[0]) = ("url", "https://demoswap.example");
        (keys[1], vals[1]) = ("org.blackout.release", RELEASE_V1);
        (keys[2], vals[2]) = ("org.blackout.manifest", MANIFEST);

        vm.startPrank(deployer);
        resolver = deployResolver(c, address(safe), label, keys, vals);
        bytes32 secret = keccak256("secret");
        payAndCommit(c, label, address(safe), address(resolver), secret, deployer);
        vm.warp(block.timestamp + 61);
        tokenId = register(c, label, address(safe), address(resolver), secret);
        vm.stopPrank();

        grantUrlRole(safe, resolver, label, webKey, ownerKeys);
    }

    function _resolveText(string memory key) internal view returns (string memory) {
        bytes memory inner = abi.encodeWithSignature("text(bytes32,string)", node, key);
        (bytes memory out,) = IUniversalResolverV2(c.universalResolver).resolve(ENSName.dnsEncodeEth(label), inner);
        return abi.decode(out, (string));
    }
}

contract SetupNameForkTest is BlackoutForkFixture {
    function test_registryPointsAtOurResolver_ownedBySafe() public view {
        assertEq(IPermissionedRegistry(c.registry).getResolver(label), address(resolver));
        assertEq(IPermissionedRegistry(c.registry).getOwner(tokenId), address(safe));
    }

    function test_safeHoldsAllResolverRoles_deployerNone() public view {
        assertTrue(resolver.hasRootRoles(ENSv2Roles.ALL_ROLES, address(safe)));
        assertEq(resolver.roles(0, deployer), 0);
    }

    function test_webKeyHoldsOnlyUrlTextRole() public view {
        assertEq(resolver.roles(ENSName.textResource("url"), webKey), ENSv2Roles.ROLE_SET_TEXT);
        assertEq(resolver.roles(ENSName.textResource("org.blackout.release"), webKey), 0);
        assertEq(resolver.roles(ENSName.textResource("org.blackout.manifest"), webKey), 0);
        assertEq(resolver.roles(0, webKey), 0);
    }

    function test_universalResolverReturnsRecords() public view {
        assertEq(_resolveText("org.blackout.release"), RELEASE_V1);
        assertEq(_resolveText("org.blackout.manifest"), MANIFEST);
        assertEq(_resolveText("url"), "https://demoswap.example");
    }
}
