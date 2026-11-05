// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console} from "forge-std/Test.sol";
import {ReplayBase, IERC20} from "./Replay.base.sol";

/// R1 — Curve DNS hijack, 9 Aug 2022. [mainnet fork]
contract R1Test is ReplayBase {
    address victim;
    address drainer;
    IERC20 usdc;

    function setUp() public {
        load("R1");
        forkAtFixture();
        victim = addr(".victim");
        drainer = addr(".drainer");
        usdc = IERC20(addr(".approveTarget"));
    }

    /// As it happened: the victim signs the approval on the fake site, then the drainer pulls the USDC.
    function test_asItHappened_victimLosesUSDC() public {
        uint256 before = usdc.balanceOf(victim);
        assertTrue(tryTransact(b32(".approveTx")), "approve replay failed");
        assertGt(usdc.allowance(victim, drainer), 0, "approval not set");
        assertTrue(tryTransact(b32(".drainTx")), "drain replay failed");
        uint256 lost = before - usdc.balanceOf(victim);
        console.log("[mainnet fork] R1 as it happened: victim lost USDC (6dp):", lost);
        assertEq(lost, vm.parseJsonUint(fx, ".lossObserved.amount"));
    }

    /// Counterfactual: the victim used BLACKOUT, whose Guard never produces an approval. Same drain tx: nothing moves.
    function test_counterfactual_noApproval_drainMovesNothing() public {
        uint256 before = usdc.balanceOf(victim);
        assertEq(usdc.allowance(victim, drainer), 0, "no allowance before the approve");
        bool ok = tryTransact(b32(".drainTx"));
        uint256 lost = before - usdc.balanceOf(victim);
        console.log("[mainnet fork][counterfactual] drain tx executed without revert:", ok);
        console.log("[mainnet fork][counterfactual] victim lost USDC (6dp):", lost);
        assertEq(lost, 0);
    }
}
