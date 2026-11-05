// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {ISafe} from "../../src/interfaces/ISafe.sol";

/// Executes a Safe transaction signed by owner keys held locally (testnet only).
library SafeExec {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function exec(ISafe safe, address to, bytes memory data, uint256[] memory ownerKeys) internal returns (bool) {
        bytes32 h = safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), safe.nonce());
        bytes memory sigs = sign(h, ownerKeys);
        return safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sigs);
    }

    /// Safe requires signatures sorted by signer address, ascending.
    function sign(bytes32 h, uint256[] memory keys) internal pure returns (bytes memory sigs) {
        uint256 n = keys.length;
        address[] memory signers = new address[](n);
        for (uint256 i; i < n; ++i) signers[i] = vm.addr(keys[i]);
        for (uint256 i; i < n; ++i) {
            for (uint256 j = i + 1; j < n; ++j) {
                if (signers[j] < signers[i]) {
                    (signers[i], signers[j]) = (signers[j], signers[i]);
                    (keys[i], keys[j]) = (keys[j], keys[i]);
                }
            }
        }
        for (uint256 i; i < n; ++i) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], h);
            sigs = abi.encodePacked(sigs, r, s, v);
        }
    }
}
