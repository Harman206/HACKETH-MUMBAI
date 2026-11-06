// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DemoToken} from "../src/DemoToken.sol";
import {DemoDrainer} from "../src/DemoDrainer.sol";

contract DemoDrainerTest is Test {
    DemoToken dusd;
    DemoDrainer drainer;
    address attacker = makeAddr("attacker");
    address victim = makeAddr("victim");

    event Drained(address indexed token, address indexed victim, uint256 amount);

    function setUp() public {
        dusd = new DemoToken("Demo Dollar", "DUSD", 100, victim);
        drainer = new DemoDrainer(attacker);
    }

    function test_drainsUpToTheAllowance() public {
        vm.prank(victim);
        dusd.approve(address(drainer), 50);
        vm.expectEmit(true, true, false, true);
        emit Drained(address(dusd), victim, 50);
        assertEq(drainer.drain(address(dusd), victim), 50);
        assertEq(dusd.balanceOf(attacker), 50);
        assertEq(dusd.balanceOf(victim), 50);
    }

    function test_noAllowance_drainsNothing_noRevert() public {
        assertEq(drainer.drain(address(dusd), victim), 0);
        assertEq(dusd.balanceOf(victim), 100);
    }

    function test_unlimitedAllowance_drainsTheWholeBalance() public {
        vm.prank(victim);
        dusd.approve(address(drainer), type(uint256).max);
        assertEq(drainer.drain(address(dusd), victim), 100);
        assertEq(dusd.balanceOf(attacker), 100);
    }

    function test_paysOnlyTheAttacker_anyoneCanTrigger() public {
        vm.prank(victim);
        dusd.approve(address(drainer), 30);
        vm.prank(makeAddr("random caller"));
        drainer.drain(address(dusd), victim);
        assertEq(dusd.balanceOf(attacker), 30);
        assertEq(drainer.attacker(), attacker);
    }
}
