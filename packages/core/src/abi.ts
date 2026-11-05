import { parseAbi } from 'viem';

/** Uniswap v3 NonfungiblePositionManager (subset). */
export const npmAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'struct DecreaseLiquidityParams { uint256 tokenId; uint128 liquidity; uint256 amount0Min; uint256 amount1Min; uint256 deadline; }',
  'function decreaseLiquidity(DecreaseLiquidityParams params) payable returns (uint256 amount0, uint256 amount1)',
  'struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }',
  'function collect(CollectParams params) payable returns (uint256 amount0, uint256 amount1)',
]);

/** Aave v3 Pool (subset). getReserveData returns the v3 ReserveData struct layout. */
export const aavePoolAbi = parseAbi([
  'function getReservesList() view returns (address[])',
  'struct ReserveConfigurationMap { uint256 data; }',
  'struct ReserveData { ReserveConfigurationMap configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }',
  'function getReserveData(address asset) view returns (ReserveData)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
]);

/** Curve 3pool (subset). The Vyper 3pool's remove_liquidity returns nothing; outputs are computed from balances. */
export const curve3poolAbi = parseAbi([
  'function coins(uint256 i) view returns (address)',
  'function balances(uint256 i) view returns (uint256)',
  'function remove_liquidity(uint256 _amount, uint256[3] min_amounts)',
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

/** ENSv2 UniversalResolver: resolve(dnsEncodedName, calldata) → (result, resolver). Verified in Task 4.1. */
export const universalResolverAbi = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes, address)',
]);

/** Resolver text(node, key) — the calldata passed into UniversalResolver.resolve. */
export const textResolverAbi = parseAbi([
  'function text(bytes32 node, string key) view returns (string)',
]);
