// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CopeybaraForkFixture} from "./SetupName.fork.t.sol";
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
contract PermissionsForkTest is CopeybaraForkFixture {
    string internal constant RELEASE_V2 = "sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd;v=2";

    function test_webKey_cannotWriteRelease() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.copeybara.release", RELEASE_V2);
    }

    function test_webKey_cannotWriteManifest() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.copeybara.manifest", "{}");
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
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "org.copeybara.release", ""));
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
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "org.copeybara.release", ""));
        bytes memory call_ = abi.encodeCall(IPermissionedResolver.grantSetterRoles, (setter, other));
        assertTrue(SafeExec.exec(safe, address(resolver), call_, ownerKeys));
        assertEq(resolver.roles(ENSName.textResource("org.copeybara.release"), other), ENSv2Roles.ROLE_SET_TEXT);
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
        assertEq(_resolveText("org.copeybara.release"), RELEASE_V1, "release unchanged");
    }

    function test_safe_updatesRelease_kitSeesNewVersion() public {
        safeSetText(safe, resolver, label, "org.copeybara.release", RELEASE_V2, ownerKeys);
        assertEq(_resolveText("org.copeybara.release"), RELEASE_V2);
    }

    function test_singleOwnerSignature_cannotUpdateRelease() public {
        uint256[] memory one = new uint256[](1);
        one[0] = ownerKeys[0];
        vm.expectRevert();
        this.safeSetTextExternal(one);
    }

    function safeSetTextExternal(uint256[] memory keys) external {
        safeSetText(safe, resolver, label, "org.copeybara.release", RELEASE_V2, keys);
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

    // ---- watcher key: may raise/clear warnings (status, blocklist) and nothing else ----

    address internal watcher = address(0xA7C4);

    function _grantWatcher() internal {
        grantWatcherRoles(safe, resolver, label, watcher, ownerKeys);
    }

    function test_watcher_canWriteStatusAndBlocklist() public {
        _grantWatcher();
        vm.startPrank(watcher);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.copeybara.status", "v=1;state=compromised;at=1");
        resolver.setText(ENSName.dnsEncodeEth(label), "org.copeybara.blocklist", '{"v":1,"domains":["evil.example"]}');
        vm.stopPrank();
        assertEq(_resolveText("org.copeybara.status"), "v=1;state=compromised;at=1");
        assertEq(_resolveText("org.copeybara.blocklist"), '{"v":1,"domains":["evil.example"]}');
    }

    function test_watcher_cannotWriteTrustRecords() public {
        _grantWatcher();
        string[5] memory ks = ["org.copeybara.release", "org.copeybara.manifest", "org.copeybara.site", "org.copeybara.extension", "url"];
        for (uint256 i; i < ks.length; ++i) {
            vm.prank(watcher);
            vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
            resolver.setText(ENSName.dnsEncodeEth(label), ks[i], "x");
        }
    }

    function test_watcher_cannotGrantItselfReleaseRole() public {
        _grantWatcher();
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), "org.copeybara.release", ""));
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        resolver.grantSetterRoles(setter, watcher);
    }

    function test_watcher_cannotWriteContenthash() public {
        _grantWatcher();
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setContenthash(ENSName.dnsEncodeEth(label), KIT_CONTENTHASH);
    }

    function test_webKey_cannotWriteStatus() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.copeybara.status", "v=1;state=ok");
    }

    function test_ungranted_watcher_cannotWriteStatus() public {
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), "org.copeybara.status", "v=1;state=compromised");
    }
}
