// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {DemoDrainer} from "../src/DemoDrainer.sol";
import {DemoToken} from "../src/DemoToken.sol";

/// Deploys the demo drainer (testnet). Env: DEPLOYER_KEY, ATTACKER_KEY.
/// Writes deployments/sepolia-attack.json (or $ATTACK_FILE) with the drainer, attacker and demo tokens.
contract DeployAttack is Script {
    function run() external {
        address attacker = vm.addr(vm.envUint("ATTACKER_KEY"));
        string memory pos = vm.readFile(vm.envOr("POSITIONS_FILE", string("deployments/sepolia-positions.json")));
        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        DemoDrainer d = new DemoDrainer(attacker);
        vm.stopBroadcast();

        string memory o = "attack";
        vm.serializeAddress(o, "drainer", address(d));
        vm.serializeAddress(o, "attacker", attacker);
        // Identify the tokens by symbol (pool token order is by address, not by name).
        address t0 = vm.parseJsonAddress(pos, ".token0");
        address t1 = vm.parseJsonAddress(pos, ".token1");
        bool t0IsDusd = keccak256(bytes(DemoToken(t0).symbol())) == keccak256("DUSD");
        vm.serializeAddress(o, "DUSD", t0IsDusd ? t0 : t1);
        string memory json = vm.serializeAddress(o, "DETH", t0IsDusd ? t1 : t0);
        vm.writeJson(json, vm.envOr("ATTACK_FILE", string("deployments/sepolia-attack.json")));
    }
}
