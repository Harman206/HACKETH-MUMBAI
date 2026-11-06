// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CopeybaraForkFixture} from "./SetupName.fork.t.sol";
import {IEnhancedAccessControl, IPermissionedResolver, ENSName, ENSv2Roles} from "../src/interfaces/IENSv2.sol";

/// Live revocation demo: the Safe takes the watcher's two setter roles away (and gives them back).
contract WatcherRoleForkTest is CopeybaraForkFixture {
    address internal watcher = address(0xA7C4);

    function setUp() public override {
        super.setUp();
        grantWatcherRoles(safe, resolver, label, watcher, ownerKeys);
    }

    function _write(string memory key, string memory value) internal {
        vm.prank(watcher);
        resolver.setText(ENSName.dnsEncodeEth(label), key, value);
    }

    function test_revoke_thenWatcherWritesRevert_thenRegrant_succeeds() public {
        _write(KEY_STATUS, "v=1;state=ok;at=1");
        (bool s, bool b) = watcherCanWrite(resolver, watcher);
        assertTrue(s && b);

        revokeWatcherRoles(safe, resolver, watcher, ownerKeys);
        (s, b) = watcherCanWrite(resolver, watcher);
        assertFalse(s || b);
        assertEq(resolver.roles(ENSName.textResource(KEY_STATUS), watcher), 0);
        vm.prank(watcher);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector,
                ENSName.textResource(KEY_STATUS),
                ENSv2Roles.ROLE_SET_TEXT,
                watcher
            )
        );
        resolver.setText(ENSName.dnsEncodeEth(label), KEY_STATUS, "v=1;state=compromised;at=2");
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        resolver.setText(ENSName.dnsEncodeEth(label), KEY_BLOCKLIST, '{"v":1,"domains":["x.example"]}');
        assertEq(_resolveText(KEY_STATUS), "v=1;state=ok;at=1", "status unchanged after revoke");

        grantWatcherRoles(safe, resolver, label, watcher, ownerKeys);
        _write(KEY_STATUS, "v=1;state=compromised;at=3");
        _write(KEY_BLOCKLIST, '{"v":1,"domains":["x.example"]}');
        assertEq(_resolveText(KEY_STATUS), "v=1;state=compromised;at=3");
    }

    function test_revoke_isOneSafeTransaction() public {
        uint256 nonce = safe.nonce();
        revokeWatcherRoles(safe, resolver, watcher, ownerKeys);
        assertEq(safe.nonce(), nonce + 1);
    }

    function test_revoke_leavesWebKeyAlone() public {
        revokeWatcherRoles(safe, resolver, watcher, ownerKeys);
        vm.prank(webKey);
        resolver.setText(ENSName.dnsEncodeEth(label), "url", "https://still.works");
        assertEq(_resolveText("url"), "https://still.works");
    }

    function test_revokedWatcher_cannotRegrantItself() public {
        revokeWatcherRoles(safe, resolver, watcher, ownerKeys);
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (ENSName.dnsEncodeEth(label), KEY_STATUS, ""));
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        resolver.grantSetterRoles(setter, watcher);
    }

    function test_watcher_cannotRevokeOthers() public {
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotRevokeRoles.selector);
        resolver.revokeRoles(ENSName.textResource("url"), ENSv2Roles.ROLE_SET_TEXT, webKey);
    }

    function test_singleOwnerSignature_cannotRevoke() public {
        uint256[] memory one = new uint256[](1);
        one[0] = ownerKeys[0];
        vm.expectRevert();
        this.revokeExternal(one);
        (bool s,) = watcherCanWrite(resolver, watcher);
        assertTrue(s);
    }

    function revokeExternal(uint256[] memory keys) external {
        revokeWatcherRoles(safe, resolver, watcher, keys);
    }
}
