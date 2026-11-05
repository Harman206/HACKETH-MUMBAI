// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {DemoToken} from "../src/DemoToken.sol";

interface INPM {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);
    function mint(MintParams calldata p) external payable returns (uint256 tokenId, uint128, uint256, uint256);
    function decreaseLiquidity(DecreaseLiquidityParams calldata p) external payable returns (uint256, uint256);
    function positions(uint256)
        external
        view
        returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128);
}

/// Seeds the demo wallet with three Uniswap v3 positions on Sepolia (Task 5.1):
/// in-range, out-of-range (one token) and owed-only (liquidity 0).
///   TEST_WALLET_KEY=0x… forge script script/SeedPositions.s.sol --rpc-url sepolia --broadcast
/// Writes deployments/sepolia-positions.json (or $POSITIONS_FILE).
contract SeedPositions is Script {
    INPM constant NPM = INPM(0x1238536071E1c677A632429e3655c799b22cDA52);
    uint24 constant FEE = 3000; // tick spacing 60
    uint160 constant PRICE_1_TO_1 = 79228162514264337593543950336; // sqrt(1) * 2^96

    function run() external {
        uint256 key = vm.envUint("TEST_WALLET_KEY");
        address user = vm.addr(key);
        vm.startBroadcast(key);
        DemoToken a = new DemoToken("Demo Dollar", "DUSD", 1e27, user);
        DemoToken b = new DemoToken("Demo Ether", "DETH", 1e27, user);
        (address t0, address t1) = address(a) < address(b) ? (address(a), address(b)) : (address(b), address(a));
        NPM.createAndInitializePoolIfNecessary(t0, t1, FEE, PRICE_1_TO_1);
        DemoToken(t0).approve(address(NPM), type(uint256).max);
        DemoToken(t1).approve(address(NPM), type(uint256).max);

        uint256 inRange = _mint(t0, t1, -6000, 6000, user);
        uint256 outOfRange = _mint(t0, t1, 600, 1200, user); // above price 1.0 → token0 only
        uint256 owedOnly = _mint(t0, t1, -6000, 6000, user);
        (,,,,,,, uint128 liq,,,,) = NPM.positions(owedOnly);
        NPM.decreaseLiquidity(INPM.DecreaseLiquidityParams(owedOnly, liq, 0, 0, block.timestamp + 3600));
        vm.stopBroadcast();

        string memory o = "positions";
        vm.serializeAddress(o, "wallet", user);
        vm.serializeAddress(o, "token0", t0);
        vm.serializeAddress(o, "token1", t1);
        vm.serializeUint(o, "inRange", inRange);
        vm.serializeUint(o, "outOfRange", outOfRange);
        string memory json = vm.serializeUint(o, "owedOnly", owedOnly);
        vm.writeJson(json, vm.envOr("POSITIONS_FILE", string("deployments/sepolia-positions.json")));
        console.log("seeded positions", inRange, outOfRange, owedOnly);
    }

    function _mint(address t0, address t1, int24 lo, int24 hi, address to) internal returns (uint256 id) {
        (id,,,) = NPM.mint(
            INPM.MintParams(t0, t1, FEE, lo, hi, 1000e18, 1000e18, 0, 0, to, block.timestamp + 3600)
        );
    }
}
