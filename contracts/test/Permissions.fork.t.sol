// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BlackoutForkFixture} from "./SetupName.fork.t.sol";
import {SafeExec} from "../script/lib/SafeExec.sol";
import {
    IEnhancedAccessControl,
    IPermissionedRegistry,
    IPermissionedResolver,
    ENSName,
    ENSv2Roles,
    IUniversalResolverV2
} from "../src/interfaces/IENSv2.sol";

/// The spec's must-revert checks: a stolen website key can write `url` and nothing else.
contract PermissionsForkTest is BlackoutForkFixture {
    string internal constant RELEASE_V2 = "sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd;v=2";

    function test_webKey_cannotWriteRelease() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.blackout.release", RELEASE_V2);
    }

    function test_webKey_cannotWriteManifest() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.blackout.manifest", "{}");
    }

    function test_webKey_cannotSwapResolver() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        IPermissionedRegistry(c.registry).setResolver(tokenId, webKey);
    }

    function test_webKey_cannotUpgradeResolver() public {
        vm.prank(webKey);
        vm.expectRevert(
            abi.encodeWithSelector(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector, 0, ENSv2Roles.ROLE_UPGRADE, webKey)
        );
        resolver.upgradeToAndCall(c.resolverImpl, "");
    }

    function test_webKey_cannotGrantItselfReleaseRole() public {
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "org.blackout.release", ""));
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        resolver.grantSetterRoles(setter, webKey);
    }

    function test_webKey_cannotGrantItselfRootRoles() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        resolver.grantRootRoles(ENSv2Roles.ROLE_SET_TEXT, webKey);
    }

    // Positive controls: the same calls succeed for the Safe, so the reverts above are about authority, not encoding.
    function test_control_safe_canGrantSetterRole() public {
        address other = makeAddr("other");
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "org.blackout.release", ""));
        bytes memory call_ = abi.encodeCall(IPermissionedResolver.grantSetterRoles, (setter, other));
        assertTrue(SafeExec.exec(safe, address(resolver), call_, ownerKeys));
        assertEq(resolver.roles(ENSName.textResource("org.blackout.release"), other), ENSv2Roles.ROLE_SET_TEXT);
    }

    function test_control_safe_canGrantRootRole() public {
        address other = makeAddr("other");
        bytes memory call_ = abi.encodeCall(IEnhancedAccessControl.grantRootRoles, (ENSv2Roles.ROLE_SET_TEXT, other));
        assertTrue(SafeExec.exec(safe, address(resolver), call_, ownerKeys));
        assertTrue(resolver.hasRootRoles(ENSv2Roles.ROLE_SET_TEXT, other));
    }

    function test_webKey_canWriteUrl() public {
        vm.prank(webKey);
        resolver.setText(ENSName.dnsEncodeEth(label), "url", "https://new.demoswap.example");
        assertEq(_resolveText("url"), "https://new.demoswap.example");
        assertEq(_resolveText("org.blackout.release"), RELEASE_V1, "release unchanged");
    }

    function test_safe_updatesRelease_kitSeesNewVersion() public {
        safeSetText(safe, resolver, label, "org.blackout.release", RELEASE_V2, ownerKeys);
        assertEq(_resolveText("org.blackout.release"), RELEASE_V2);
    }

    function test_singleOwnerSignature_cannotUpdateRelease() public {
        uint256[] memory one = new uint256[](1);
        one[0] = ownerKeys[0];
        vm.expectRevert();
        this.safeSetTextExternal(one);
    }

    function safeSetTextExternal(uint256[] memory keys) external {
        safeSetText(safe, resolver, label, "org.blackout.release", RELEASE_V2, keys);
    }

    // The kit on IPFS: its CIDv1 (raw) is multihash(sha256 of the kit), so contenthash = 0xe301 01551220 <sha256>.
    bytes internal constant KIT_CONTENTHASH = hex"e30101551220cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";

    function test_safe_setsContenthash_readableThroughUniversalResolver() public {
        safeSetContenthash(safe, resolver, label, KIT_CONTENTHASH, ownerKeys);
        bytes memory inner = abi.encodeWithSignature("contenthash(bytes32)", node);
        (bytes memory out,) = IUniversalResolverV2(c.universalResolver).resolve(ENSName.dnsEncodeEth(label), inner);
        assertEq(abi.decode(out, (bytes)), KIT_CONTENTHASH);
    }

    function test_webKey_cannotWriteContenthash() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setContenthash(ENSName.dnsEncodeEth(label), KIT_CONTENTHASH);
    }
}
