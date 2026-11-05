// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BlackoutForkFixture} from "./SetupName.fork.t.sol";
import {
    IEnhancedAccessControl,
    IPermissionedRegistry,
    IPermissionedResolver,
    ENSName,
    ENSv2Roles
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
        vm.expectRevert();
        resolver.upgradeToAndCall(c.resolverImpl, "");
    }

    function test_webKey_cannotGrantItselfReleaseRole() public {
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "org.blackout.release", ""));
        vm.prank(webKey);
        vm.expectRevert();
        resolver.grantSetterRoles(setter, webKey);
    }

    function test_webKey_cannotGrantItselfRootRoles() public {
        vm.prank(webKey);
        vm.expectRevert();
        resolver.grantRootRoles(ENSv2Roles.ROLE_SET_TEXT, webKey);
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
}
