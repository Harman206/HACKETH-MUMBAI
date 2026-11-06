// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Min {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address from, address to, uint256 v) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Minimal ERC-4626 vault for the protocol SDK drill: the sample protocol is described to the kit only by the
/// declarative exit spec (org.copeybara.exits), with no adapter code. Shares are 1:1 plus a fixed yield so the
/// payout differs from the share amount. `paused` lets the drill prove a refused exit becomes "manual".
contract SampleVault {
    string public constant name = "Sample Vault Share";
    string public constant symbol = "svDEMO";
    uint8 public constant decimals = 18;
    address public immutable asset;
    address public immutable admin;
    bool public paused;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);

    constructor(address asset_) {
        asset = asset_;
        admin = msg.sender;
    }

    function setPaused(bool p) external {
        require(msg.sender == admin, "admin");
        paused = p;
    }

    function totalAssets() public view returns (uint256) {
        return IERC20Min(asset).balanceOf(address(this));
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return totalSupply == 0 ? shares : (shares * totalAssets()) / totalSupply;
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    function maxRedeem(address owner) external view returns (uint256) {
        return paused ? 0 : balanceOf[owner];
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(!paused, "paused");
        shares = totalSupply == 0 ? assets : (assets * totalSupply) / totalAssets();
        IERC20Min(asset).transferFrom(msg.sender, address(this), assets);
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Transfer(address(0), receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(!paused, "paused");
        if (msg.sender != owner) {
            uint256 a = allowance[owner][msg.sender];
            if (a != type(uint256).max) allowance[owner][msg.sender] = a - shares;
        }
        assets = convertToAssets(shares);
        balanceOf[owner] -= shares;
        totalSupply -= shares;
        IERC20Min(asset).transfer(receiver, assets);
        emit Transfer(owner, address(0), shares);
        emit Withdraw(msg.sender, receiver, owner, assets, shares);
    }
}
