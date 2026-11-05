// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
}

/// Labels on every result: "mainnet fork", "impersonated account" (where used), "counterfactual".
abstract contract ReplayBase is Test {
    string internal fx;

    function archiveRpc() internal view returns (string memory) {
        return vm.envOr("ARCHIVE_RPC", string("https://gateway.tenderly.co/public/mainnet"));
    }

    function load(string memory id) internal {
        fx = vm.readFile(string.concat(vm.projectRoot(), "/fixtures/", id, ".json"));
    }

    function addr(string memory key) internal view returns (address) {
        return vm.parseJsonAddress(fx, key);
    }

    function b32(string memory key) internal view returns (bytes32) {
        return vm.parseJsonBytes32(fx, key);
    }

    function forkAtFixture() internal {
        vm.createSelectFork(archiveRpc(), vm.parseJsonUint(fx, ".forkBlock"));
    }

    /// vm.transact through a low-level call so a reverting historical tx is observable, not fatal.
    function tryTransact(bytes32 txHash) internal returns (bool ok) {
        (ok,) = address(vm).call(abi.encodeWithSignature("transact(bytes32)", txHash));
    }
}
