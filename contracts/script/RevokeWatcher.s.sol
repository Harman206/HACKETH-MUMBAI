// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/console2.sol";
import {CopeybaraSetup} from "./lib/CopeybaraSetup.sol";
import {ISafe} from "../src/interfaces/ISafe.sol";
import {IPermissionedResolver} from "../src/interfaces/IENSv2.sol";

/// The Safe revokes (or re-grants) the watcher key's two setter roles on the protocol's resolver.
///   WATCHER_ROLE=revoke|grant   (required)
///   WATCHER_ADDR                default .copeybara.watcher of DEPLOYMENTS_FILE (default deployments/sepolia.json)
///   DEPLOYER_KEY, OWNER_KEY_1, OWNER_KEY_2
/// revoke = one Safe tx (resolver multicall of two revokeRoles); grant = two Safe txs (grantSetterRoles per key).
/// Proven in test/WatcherRole.fork.t.sol; wrapped by script/watcher-role.sh.
contract RevokeWatcher is CopeybaraSetup {
    function run() external {
        string memory j = vm.readFile(vm.envOr("DEPLOYMENTS_FILE", string("deployments/sepolia.json")));
        string memory label = vm.parseJsonString(j, ".label");
        ISafe safe = ISafe(vm.parseJsonAddress(j, ".safe"));
        IPermissionedResolver resolver = IPermissionedResolver(vm.parseJsonAddress(j, ".resolver"));
        address watcher = vm.envOr("WATCHER_ADDR", address(0));
        if (watcher == address(0)) watcher = vm.parseJsonAddress(j, ".copeybara.watcher");
        bytes32 mode = keccak256(bytes(vm.envString("WATCHER_ROLE")));
        require(mode == keccak256("revoke") || mode == keccak256("grant"), "WATCHER_ROLE must be revoke or grant");
        uint256[] memory keys = new uint256[](2);
        keys[0] = vm.envUint("OWNER_KEY_1");
        keys[1] = vm.envUint("OWNER_KEY_2");

        (bool s0, bool b0) = watcherCanWrite(resolver, watcher);
        console2.log("before: watcher may write status=%s blocklist=%s", s0, b0);
        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        if (mode == keccak256("revoke")) {
            require(s0 || b0, "watcher holds no role to revoke");
            revokeWatcherRoles(safe, resolver, watcher, keys);
        } else {
            grantWatcherRoles(safe, resolver, label, watcher, keys);
        }
        vm.stopBroadcast();
        (bool s1, bool b1) = watcherCanWrite(resolver, watcher);
        console2.log("after:  watcher may write status=%s blocklist=%s", s1, b1);
        if (mode == keccak256("revoke")) require(!s1 && !b1, "revoke did not take");
        else require(s1 && b1, "grant did not take");
    }
}
