// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CopeybaraSetup} from "./lib/CopeybaraSetup.sol";
import {ISafe} from "../src/interfaces/ISafe.sol";
import {IPermissionedRegistry, IPermissionedResolver, IUserRegistry} from "../src/interfaces/IENSv2.sol";

/// Give the watcher agent an ENSv2 identity: watcher.<label>.eth, a subname token owned by the Safe in a Safe-owned
/// UserRegistry, resolved by its own Safe-only PermissionedResolver (addr = the watcher key + description,
/// org.copeybara.agent, url). The watcher key gets no role on any of it. Proven in test/AgentIdentity.fork.t.sol.
/// Env (all optional except the keys):
///   DEPLOYMENTS_FILE   default deployments/sepolia.json (label, safe, copeybara.watcher)
///   AGENT_FILE         output, default deployments/sepolia-agent.json
///   WATCHER_ADDR       default .copeybara.watcher
///   AGENT_SUB          default "watcher"
///   AGENT_DESCRIPTION / AGENT_URL / AGENT_JSON   override the records
///   SUBREGISTRY        reuse an existing UserRegistry (default: the one already set on the name, else deploy)
///   DEPLOYER_KEY (pays gas, deploys the proxies, gets no roles), OWNER_KEY_1, OWNER_KEY_2 (Safe signers)
contract RegisterAgent is CopeybaraSetup {
    function run() external {
        Cfg memory c = loadCfg();
        string memory j = vm.readFile(vm.envOr("DEPLOYMENTS_FILE", string("deployments/sepolia.json")));
        string memory label = vm.parseJsonString(j, ".label");
        string memory parentName = string.concat(label, ".eth");
        ISafe safe = ISafe(vm.parseJsonAddress(j, ".safe"));
        address watcher = vm.envOr("WATCHER_ADDR", address(0));
        if (watcher == address(0)) watcher = vm.parseJsonAddress(j, ".copeybara.watcher");
        Agent memory a = Agent({
            sub: vm.envOr("AGENT_SUB", string("watcher")),
            addr: watcher,
            description: vm.envOr(
                "AGENT_DESCRIPTION",
                string.concat(
                    "Copeybara watcher agent for ", parentName,
                    ": fingerprints the official site and probes look-alike domains. It may only raise or clear the warning (org.copeybara.status) and add look-alikes (org.copeybara.blocklist). The Safe can revoke it."
                )
            ),
            json: vm.envOr("AGENT_JSON", watcherAgentJson(parentName, address(safe))),
            url: vm.envOr("AGENT_URL", string("https://github.com/Harman206/HACKETH-MUMBAI/tree/main/apps/watcher"))
        });
        uint256[] memory keys = new uint256[](2);
        keys[0] = vm.envUint("OWNER_KEY_1");
        keys[1] = vm.envUint("OWNER_KEY_2");

        address existing = vm.envOr("SUBREGISTRY", IPermissionedRegistry(c.registry).getSubregistry(label));
        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        IUserRegistry subs = existing != address(0) ? IUserRegistry(existing) : deployUserRegistry(c, address(safe), label);
        IPermissionedResolver agentResolver = deployAgentResolver(c, address(safe), label, a);
        attachSubname(safe, c, label, subs, a.sub, address(agentResolver), keys);
        vm.stopBroadcast();

        string memory o = "agent";
        vm.serializeString(o, "name", string.concat(a.sub, ".", parentName));
        vm.serializeAddress(o, "addr", watcher);
        vm.serializeAddress(o, "subregistry", address(subs));
        vm.serializeAddress(o, "resolver", address(agentResolver));
        vm.serializeAddress(o, "operator", address(safe));
        vm.serializeString(o, "description", a.description);
        vm.serializeString(o, "url", a.url);
        string memory out = vm.serializeString(o, "org.copeybara.agent", a.json);
        vm.writeJson(out, vm.envOr("AGENT_FILE", string("deployments/sepolia-agent.json")));
    }
}
