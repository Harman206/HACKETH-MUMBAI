import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from 'viem';
import type { Address, PositionBadge } from '@copeybara/core';

/**
 * Uniswap v4 math, ported to bigint from v4-core (TickMath.getSqrtPriceAtTick, SqrtPriceMath.getAmount{0,1}Delta,
 * Pool.modifyLiquidity, Position.update). Used only for the preview and slippage minimums; the transaction is
 * still simulated through the RPC quorum, and "Recovered" still needs real balance increases.
 */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const Q96 = 2n ** 96n;
const Q128 = 2n ** 128n;
const U256 = 2n ** 256n;

const RATIOS: [number, bigint][] = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
];

/** sqrt(1.0001^tick) · 2^96, rounded up exactly as TickMath does. */
export function sqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new RangeError(`tick ${tick} out of range`);
  const abs = Math.abs(tick);
  let ratio = abs & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  for (const [bit, m] of RATIOS) if (abs & bit) ratio = (ratio * m) >> 128n;
  if (tick > 0) ratio = (U256 - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/** SqrtPriceMath.getAmount0Delta(a, b, L, roundUp = false). */
function amount0Down(a: bigint, b: bigint, liquidity: bigint): bigint {
  if (a > b) [a, b] = [b, a];
  return ((liquidity << 96n) * (b - a)) / b / a;
}

/** SqrtPriceMath.getAmount1Delta(a, b, L, roundUp = false). */
function amount1Down(a: bigint, b: bigint, liquidity: bigint): bigint {
  const d = a > b ? a - b : b - a;
  return (liquidity * d) / Q96;
}

/** What removing `liquidity` pays out (principal only, rounded down), per Pool.modifyLiquidity. */
export function amountsForDecrease(p: { sqrtPriceX96: bigint; tick: number; tickLower: number; tickUpper: number; liquidity: bigint }): {
  amount0: bigint;
  amount1: bigint;
} {
  const lo = sqrtPriceAtTick(p.tickLower);
  const hi = sqrtPriceAtTick(p.tickUpper);
  if (p.liquidity === 0n) return { amount0: 0n, amount1: 0n };
  if (p.tick < p.tickLower) return { amount0: amount0Down(lo, hi, p.liquidity), amount1: 0n };
  if (p.tick < p.tickUpper) return { amount0: amount0Down(p.sqrtPriceX96, hi, p.liquidity), amount1: amount1Down(lo, p.sqrtPriceX96, p.liquidity) };
  return { amount0: 0n, amount1: amount1Down(lo, hi, p.liquidity) };
}

/** Position.update: mulDiv(feeGrowthInside − last (uint256 wrap), liquidity, 2^128). */
export function feesOwed(growthInsideX128: bigint, lastX128: bigint, liquidity: bigint): bigint {
  return ((((growthInsideX128 - lastX128) % U256) + U256) % U256) * liquidity / Q128;
}

const signed24 = (x: bigint) => {
  const v = Number(x & 0xffffffn);
  return v >= 0x800000 ? v - 0x1000000 : v;
};

/** PositionInfo: 200 bits poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber. */
export function decodePositionInfo(info: bigint): { tickLower: number; tickUpper: number; hasSubscriber: boolean } {
  return { tickLower: signed24(info >> 8n), tickUpper: signed24(info >> 32n), hasSubscriber: (info & 0xffn) !== 0n };
}

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function poolIdOf(k: PoolKey): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
}

/**
 * Hook permissions live in the hook's address: v4-core Hooks.sol reads the low 14 bits as flags
 * (BEFORE_INITIALIZE_FLAG = 1 << 13 … AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 0).
 */
export const HOOK_FLAGS = {
  BEFORE_INITIALIZE: 1 << 13,
  AFTER_INITIALIZE: 1 << 12,
  BEFORE_ADD_LIQUIDITY: 1 << 11,
  AFTER_ADD_LIQUIDITY: 1 << 10,
  BEFORE_REMOVE_LIQUIDITY: 1 << 9,
  AFTER_REMOVE_LIQUIDITY: 1 << 8,
  BEFORE_SWAP: 1 << 7,
  AFTER_SWAP: 1 << 6,
  BEFORE_DONATE: 1 << 5,
  AFTER_DONATE: 1 << 4,
  BEFORE_SWAP_RETURNS_DELTA: 1 << 3,
  AFTER_SWAP_RETURNS_DELTA: 1 << 2,
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1 << 1,
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 1 << 0,
} as const;
export type HookFlag = keyof typeof HOOK_FLAGS;
const ALL_HOOK_MASK = (1 << 14) - 1;

/** Names of the permission flags set in a hook address (highest bit first). */
export function hookFlags(hooks: Address): HookFlag[] {
  const bits = Number(BigInt(hooks) & BigInt(ALL_HOOK_MASK));
  return (Object.keys(HOOK_FLAGS) as HookFlag[]).filter((k) => (bits & HOOK_FLAGS[k]) !== 0);
}

/** Badges for a v4 position's pool hook: none without a hook, an info badge with its address, warnings for withdrawal hooks. */
export function hookBadges(hooks: Address): PositionBadge[] {
  if (BigInt(hooks) === 0n) return [];
  const f = new Set(hookFlags(hooks));
  const out: PositionBadge[] = [{ tone: 'info', text: `Hook ${hooks.slice(0, 6)}…${hooks.slice(-4)}` }];
  if (f.has('BEFORE_REMOVE_LIQUIDITY') || f.has('AFTER_REMOVE_LIQUIDITY')) {
    out.push({ tone: 'warn', text: "This pool's hook runs when you withdraw and can block or delay exits" });
  }
  if (f.has('AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA')) {
    out.push({ tone: 'warn', text: "This pool's hook can change how much you receive when you withdraw" });
  }
  return out;
}
