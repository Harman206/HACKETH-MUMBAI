// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CopeybaraSetup} from "./lib/CopeybaraSetup.sol";
import {ISafe} from "../src/interfaces/ISafe.sol";
import {IPermissionedResolver} from "../src/interfaces/IENSv2.sol";

/// The Safe (2-of-3) writes org.copeybara.* records. Every env var is optional; only the ones set are written.
///   RELEASE="sha256:<hex>;v=<n>"      → org.copeybara.release   (kit)
///   MANIFEST_FILE=path                → org.copeybara.manifest  (full exit list)
///   SITE="v=2;sha256=<h>,…"           → org.copeybara.site      (apps/watcher/src/fingerprint.ts)
///   EXTENSION_RELEASE="sha256:…;v=<n>"→ org.copeybara.extension (extension zip)
///   STATUS="v=1;state=…"              → org.copeybara.status
///   BLOCKLIST='{"v":1,"domains":[…]}' → org.copeybara.blocklist
///   CONTENTHASH=0x…                   → ENSIP-7 contenthash
///   WATCHER_ADDR=0x…                  → grant the watcher key status + blocklist only
contract WriteRecords is CopeybaraSetup {
    function run() external {
        string memory j = vm.readFile(vm.envOr("DEPLOYMENTS_FILE", string("deployments/sepolia.json")));
        string memory label = vm.parseJsonString(j, ".label");
        ISafe safe = ISafe(vm.parseJsonAddress(j, ".safe"));
        IPermissionedResolver resolver = IPermissionedResolver(vm.parseJsonAddress(j, ".resolver"));
        uint256[] memory keys = new uint256[](2);
        keys[0] = vm.envUint("OWNER_KEY_1");
        keys[1] = vm.envUint("OWNER_KEY_2");

        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        _text(safe, resolver, label, "org.copeybara.release", vm.envOr("RELEASE", string("")), keys);
        string memory mf = vm.envOr("MANIFEST_FILE", string(""));
        if (bytes(mf).length > 0) safeSetText(safe, resolver, label, "org.copeybara.manifest", vm.readFile(mf), keys);
        _text(safe, resolver, label, "org.copeybara.site", vm.envOr("SITE", string("")), keys);
        _text(safe, resolver, label, "org.copeybara.extension", vm.envOr("EXTENSION_RELEASE", string("")), keys);
        _text(safe, resolver, label, "org.copeybara.status", vm.envOr("STATUS", string("")), keys);
        _text(safe, resolver, label, "org.copeybara.blocklist", vm.envOr("BLOCKLIST", string("")), keys);
        bytes memory ch = vm.envOr("CONTENTHASH", bytes(""));
        if (ch.length > 0) safeSetContenthash(safe, resolver, label, ch, keys);
        address watcher = vm.envOr("WATCHER_ADDR", address(0));
        if (watcher != address(0)) grantWatcherRoles(safe, resolver, label, watcher, keys);
        vm.stopBroadcast();
    }

    function _text(ISafe safe, IPermissionedResolver resolver, string memory label, string memory key, string memory value, uint256[] memory keys)
        internal
    {
        if (bytes(value).length > 0) safeSetText(safe, resolver, label, key, value, keys);
    }
}
