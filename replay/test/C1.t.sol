// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console} from "forge-std/Test.sol";
import {ReplayBase, IERC20} from "./Replay.base.sol";

interface IEToken {
    function balanceOfUnderlying(address) external view returns (uint256);
    function withdraw(uint256 subAccountId, uint256 amount) external;
}

/// C1 — CONTROL, out of scope: Euler 2023 smart-contract exploit. BLACKOUT cannot stop this.
/// It shows only why time-to-exit matters: a supplier who exited before the exploit block keeps funds.
/// [mainnet fork] [impersonated account] [counterfactual]
contract C1Test is ReplayBase {
    address holder;
    IEToken eDai;
    IERC20 dai;

    function setUp() public {
        load("C1");
        forkAtFixture();
        holder = addr(".victim");
        eDai = IEToken(addr(".eToken"));
        dai = IERC20(vm.parseJsonAddress(fx, ".tokens[0]"));
    }

    function test_exitedBeforeExploit_keepsFunds() public {
        uint256 owed = eDai.balanceOfUnderlying(holder);
        uint256 before = dai.balanceOf(holder);
        vm.prank(holder);
        eDai.withdraw(0, type(uint256).max);
        assertTrue(tryTransact(b32(".drainTx")), "exploit replay failed");
        uint256 got = dai.balanceOf(holder) - before;
        console.log("[mainnet fork][impersonated account] exited before exploit, DAI kept:", got / 1e18);
        assertGe(got, owed - 1e18);
    }

    function test_didNotExit_loses() public {
        uint256 owed = eDai.balanceOfUnderlying(holder);
        assertTrue(tryTransact(b32(".drainTx")), "exploit replay failed");
        uint256 before = dai.balanceOf(holder);
        vm.prank(holder);
        (bool ok,) = address(eDai).call(abi.encodeCall(IEToken.withdraw, (0, type(uint256).max)));
        uint256 got = dai.balanceOf(holder) - before;
        console.log("[mainnet fork][counterfactual] did not exit; withdraw after exploit succeeded:", ok);
        console.log("[mainnet fork][counterfactual] DAI recovered after exploit / owed:", got / 1e18, owed / 1e18);
        assertLt(got, owed / 2, "after the exploit most of the position is gone");
    }
}
