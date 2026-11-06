// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BlackoutSetup} from "./lib/BlackoutSetup.sol";
import {ISafe} from "../src/interfaces/ISafe.sol";
import {IPermissionedResolver, IETHRegistrar} from "../src/interfaces/IENSv2.sol";

/// Live Sepolia setup in two stages (the registrar needs ≥60 s between commit and register):
///   forge script script/SetupName.s.sol --sig "commit()"  --rpc-url sepolia --broadcast
///   (wait ≥ 60 s)
///   forge script script/SetupName.s.sol --sig "finish()"  --rpc-url sepolia --broadcast
/// Env: DEPLOYER_KEY, OWNER_KEY_1, OWNER_KEY_2, OWNER_KEY_3, WEB_KEY_ADDR, LABEL,
///      SITE_URL, RELEASE, MANIFEST_FILE (path to compact manifest JSON)
contract SetupName is BlackoutSetup {
    function _out() internal view returns (string memory) {
        return vm.envOr("DEPLOYMENTS_FILE", string("deployments/sepolia.json"));
    }

    function _ownerKeys() internal view returns (uint256[] memory k) {
        k = new uint256[](2);
        k[0] = vm.envUint("OWNER_KEY_1");
        k[1] = vm.envUint("OWNER_KEY_2");
    }

    function commit() external {
        Cfg memory c = loadCfg();
        string memory label = vm.envString("LABEL");
        uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);
        require(IETHRegistrar(c.registrar).isAvailable(label), "label not available");

        address[] memory owners = new address[](3);
        owners[0] = vm.addr(vm.envUint("OWNER_KEY_1"));
        owners[1] = vm.addr(vm.envUint("OWNER_KEY_2"));
        owners[2] = vm.addr(vm.envUint("OWNER_KEY_3"));

        // MANIFEST2_FILE (optional): the full exit list in org.blackout.manifest2; org.blackout.manifest stays
        // readable by older kits (see packages/ens/src/records.ts).
        string memory m2 = vm.envOr("MANIFEST2_FILE", string(""));
        uint256 n = bytes(m2).length > 0 ? 4 : 3;
        string[] memory keys = new string[](n);
        string[] memory vals = new string[](n);
        (keys[0], vals[0]) = ("url", vm.envString("SITE_URL"));
        (keys[1], vals[1]) = ("org.blackout.release", vm.envString("RELEASE"));
        (keys[2], vals[2]) = ("org.blackout.manifest", vm.readFile(vm.envString("MANIFEST_FILE")));
        if (n == 4) (keys[3], vals[3]) = ("org.blackout.manifest2", vm.readFile(m2));
        bytes32 secret = keccak256(abi.encodePacked(deployerKey, label, block.timestamp));

        vm.startBroadcast(deployerKey);
        ISafe safe = deploySafe(c, owners, 2, uint256(keccak256(bytes(label))));
        IPermissionedResolver resolver = deployResolver(c, address(safe), label, keys, vals);
        payAndCommit(c, label, address(safe), address(resolver), secret, deployer);
        vm.stopBroadcast();

        string memory o = "setup";
        vm.serializeString(o, "name", string.concat(label, ".eth"));
        vm.serializeString(o, "label", label);
        vm.serializeAddress(o, "safe", address(safe));
        vm.serializeAddress(o, "resolver", address(resolver));
        vm.serializeAddress(o, "webKey", vm.envAddress("WEB_KEY_ADDR"));
        vm.serializeAddress(o, "deployer", deployer);
        string memory json = vm.serializeBytes32(o, "secret", secret);
        vm.writeJson(json, _out());
    }

    function finish() external {
        Cfg memory c = loadCfg();
        string memory j = vm.readFile(_out());
        string memory label = vm.parseJsonString(j, ".label");
        ISafe safe = ISafe(vm.parseJsonAddress(j, ".safe"));
        IPermissionedResolver resolver = IPermissionedResolver(vm.parseJsonAddress(j, ".resolver"));
        bytes32 secret = vm.parseJsonBytes32(j, ".secret");

        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        uint256 tokenId = register(c, label, address(safe), address(resolver), secret);
        grantUrlRole(safe, resolver, label, vm.envAddress("WEB_KEY_ADDR"), _ownerKeys());
        vm.stopBroadcast();

        vm.writeJson(vm.toString(tokenId), _out(), ".tokenId");
    }
}
