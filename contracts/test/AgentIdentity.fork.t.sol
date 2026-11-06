// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CopeybaraForkFixture} from "./SetupName.fork.t.sol";
import {SafeExec} from "../script/lib/SafeExec.sol";
import {
    IEnhancedAccessControl,
    IPermissionedRegistry,
    IPermissionedResolver,
    IUserRegistry,
    IUniversalResolverV2,
    ENSName,
    ENSv2Roles
} from "../src/interfaces/IENSv2.sol";

/// The watcher agent's identity is an ENSv2 subname, watcher.<name>.eth: a token in a Safe-owned UserRegistry,
/// with its own Safe-only resolver (addr = the watcher key, text records = what it is and may write).
contract AgentIdentityForkTest is CopeybaraForkFixture {
    string internal constant SUB = "watcher";
    string internal constant DESCRIPTION =
        "Copeybara watcher agent: fingerprints the official site and probes look-alikes; may raise or clear a warning, nothing else.";
    string internal constant URL = "https://github.com/Harman206/HACKETH-MUMBAI/tree/main/apps/watcher";

    uint256 internal watcherPk = 0xA7C4;
    address internal watcher;
    IUserRegistry internal subs;
    IPermissionedResolver internal agentResolver;
    string internal agentJson;

    function setUp() public override {
        super.setUp();
        watcher = vm.addr(watcherPk);
        grantWatcherRoles(safe, resolver, label, watcher, ownerKeys);
        agentJson = watcherAgentJson(string.concat(label, ".eth"), address(safe));

        vm.startPrank(deployer);
        subs = deployUserRegistry(c, address(safe), label);
        agentResolver = deployAgentResolver(c, address(safe), label, Agent(SUB, watcher, DESCRIPTION, agentJson, URL));
        vm.stopPrank();
        attachSubname(safe, c, label, subs, SUB, address(agentResolver), ownerKeys);
    }

    function _subDns() internal view returns (bytes memory) {
        return ENSName.dnsEncodeSub(SUB, label);
    }

    function _resolveSub(bytes memory inner) internal view returns (bytes memory out, address r) {
        return IUniversalResolverV2(c.universalResolver).resolve(_subDns(), inner);
    }

    function _subText(string memory key) internal view returns (string memory) {
        (bytes memory out,) = _resolveSub(abi.encodeWithSignature("text(bytes32,string)", ENSName.namehashSub(SUB, label), key));
        return abi.decode(out, (string));
    }

    function test_identityRecords_readableThroughUniversalResolver() public view {
        assertEq(_subText("description"), DESCRIPTION);
        assertEq(_subText("url"), URL);
        assertEq(_subText(KEY_AGENT), agentJson);
        (, address r) = _resolveSub(abi.encodeWithSignature("text(bytes32,string)", ENSName.namehashSub(SUB, label), "url"));
        assertEq(r, address(agentResolver), "resolved by the agent resolver, not the parent's");
    }

    function test_agentJson_isExact() public view {
        assertEq(
            agentJson,
            string.concat(
                '{"role":"watcher","may_write":["org.copeybara.status","org.copeybara.blocklist"],"of":"',
                label,
                '.eth","operator":"',
                vm.toString(address(safe)),
                '","code":"apps/watcher","version":1}'
            )
        );
    }

    function test_addr_resolvesToWatcher() public view {
        (bytes memory out,) = _resolveSub(abi.encodeWithSignature("addr(bytes32)", ENSName.namehashSub(SUB, label)));
        assertEq(abi.decode(out, (address)), watcher);
        (bytes memory out60,) = _resolveSub(abi.encodeWithSignature("addr(bytes32,uint256)", ENSName.namehashSub(SUB, label), 60));
        assertEq(abi.decode(out60, (bytes)), abi.encodePacked(watcher));
    }

    function test_subname_isTokenOwnedBySafe_inSafeOwnedRegistry() public view {
        IPermissionedRegistry eth = IPermissionedRegistry(c.registry);
        assertEq(eth.getSubregistry(label), address(subs));
        assertEq(subs.getResolver(SUB), address(agentResolver));
        assertEq(subs.getOwner(uint256(keccak256(bytes(SUB)))), address(safe));
        assertEq(subs.getExpiry(uint256(keccak256(bytes(SUB)))), eth.getExpiry(uint256(keccak256(bytes(label)))));
        (address parent, string memory childLabel) = subs.getParent();
        assertEq(parent, c.registry);
        assertEq(childLabel, label);
        assertTrue(subs.hasRootRoles(ENSv2Roles.ALL_ROLES, address(safe)));
        assertEq(subs.roles(0, deployer), 0);
        assertTrue(agentResolver.hasRootRoles(ENSv2Roles.ALL_ROLES, address(safe)));
        assertEq(agentResolver.roles(0, deployer), 0);
    }

    function test_parentRecords_stillResolve() public view {
        assertEq(_resolveText("org.copeybara.release"), RELEASE_V1);
        assertEq(_resolveText("url"), "https://demoswap.example");
    }

    function test_watcher_cannotEditItsOwnIdentity() public {
        string[3] memory ks = ["description", "org.copeybara.agent", "url"];
        for (uint256 i; i < ks.length; ++i) {
            vm.prank(watcher);
            vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
            agentResolver.setText(_subDns(), ks[i], '{"role":"admin"}');
        }
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        agentResolver.setAddress(_subDns(), 60, abi.encodePacked(address(0xBAD)));
        // nor even its own status/blocklist keys there: the grants live on the parent's resolver only
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        agentResolver.setText(_subDns(), KEY_STATUS, "v=1;state=ok");
        assertEq(_subText(KEY_AGENT), agentJson);
    }

    function test_watcher_cannotGrantItselfIdentityRoles() public {
        bytes memory setter = abi.encodeCall(IPermissionedResolver.setText, (_subDns(), KEY_AGENT, ""));
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        agentResolver.grantSetterRoles(setter, watcher);
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACCannotGrantRoles.selector);
        agentResolver.grantRootRoles(ENSv2Roles.ROLE_SET_TEXT, watcher);
    }

    function test_watcher_cannotRepointItsName() public {
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        subs.setResolver(uint256(keccak256(bytes(SUB))), watcher);
        vm.prank(watcher);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        IPermissionedRegistry(c.registry).setSubregistry(uint256(keccak256(bytes(label))), watcher);
        vm.prank(watcher);
        vm.expectRevert();
        subs.register("watcher2", watcher, address(0), watcher, ENSv2Roles.ALL_ROLES, uint64(block.timestamp + 1 days));
    }

    function test_webKey_cannotEditAgentUrl() public {
        vm.prank(webKey);
        vm.expectPartialRevert(IEnhancedAccessControl.EACUnauthorizedAccountRoles.selector);
        agentResolver.setText(_subDns(), "url", "https://evil.example");
    }

    function test_safe_canUpdateIdentity() public {
        bytes memory call_ = abi.encodeCall(IPermissionedResolver.setText, (_subDns(), "description", "v2"));
        assertTrue(SafeExec.exec(safe, address(agentResolver), call_, ownerKeys));
        assertEq(_subText("description"), "v2");
    }

    function test_attachSubname_isIdempotentOnSubregistry() public {
        // a second agent under the same registry: setSubregistry/setParent are skipped, only register runs
        uint256 nonce = safe.nonce();
        attachSubname(safe, c, label, subs, "watcher-b", address(agentResolver), ownerKeys);
        assertEq(safe.nonce(), nonce + 1);
        assertEq(subs.getResolver("watcher-b"), address(agentResolver));
    }
}
