// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BlackoutSetup} from "./lib/BlackoutSetup.sol";
import {ISafe} from "../src/interfaces/ISafe.sol";
import {IPermissionedResolver} from "../src/interfaces/IENSv2.sol";

/// Safe (2-of-3) updates the release and/or manifest records.
///   RELEASE="sha256:<hex>;v=<n>" MANIFEST_FILE=path forge script script/WriteRecords.s.sol --rpc-url sepolia --broadcast
/// Either env var may be omitted. SITE_HASH (optional) writes org.blackout.site; CONTENTHASH (optional, 0x…) the ENSIP-7 contenthash.
contract WriteRecords is BlackoutSetup {
    function run() external {
        string memory j = vm.readFile(vm.envOr("DEPLOYMENTS_FILE", string("deployments/sepolia.json")));
        string memory label = vm.parseJsonString(j, ".label");
        ISafe safe = ISafe(vm.parseJsonAddress(j, ".safe"));
        IPermissionedResolver resolver = IPermissionedResolver(vm.parseJsonAddress(j, ".resolver"));
        uint256[] memory keys = new uint256[](2);
        keys[0] = vm.envUint("OWNER_KEY_1");
        keys[1] = vm.envUint("OWNER_KEY_2");

        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        string memory release = vm.envOr("RELEASE", string(""));
        if (bytes(release).length > 0) safeSetText(safe, resolver, label, "org.blackout.release", release, keys);
        string memory mf = vm.envOr("MANIFEST_FILE", string(""));
        if (bytes(mf).length > 0) safeSetText(safe, resolver, label, "org.blackout.manifest", vm.readFile(mf), keys);
        string memory site = vm.envOr("SITE_HASH", string(""));
        if (bytes(site).length > 0) safeSetText(safe, resolver, label, "org.blackout.site", site, keys);
        bytes memory ch = vm.envOr("CONTENTHASH", bytes(""));
        if (ch.length > 0) safeSetContenthash(safe, resolver, label, ch, keys);
        vm.stopBroadcast();
    }
}
