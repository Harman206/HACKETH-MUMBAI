import { describe, expect, test } from 'vitest';
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { amountsForDecrease, decodePositionInfo, feesOwed, poolIdOf, sqrtPriceAtTick, MAX_TICK, MIN_TICK } from '../src/v4-math';

const Q96 = 2n ** 96n;

describe('Uniswap v4 math (ported from v4-core; checked against its published constants)', () => {
  test('sqrtPriceAtTick: tick 0 = 2^96, and the MIN/MAX_SQRT_PRICE constants at the tick bounds', () => {
    expect(sqrtPriceAtTick(0)).toBe(Q96);
    expect(sqrtPriceAtTick(MIN_TICK)).toBe(4295128739n);
    expect(sqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n);
    expect(() => sqrtPriceAtTick(MAX_TICK + 1)).toThrow(/tick/);
  });

  test('sqrtPriceAtTick is strictly increasing and symmetric around 0 (p(t)·p(−t) ≈ 2^192)', () => {
    for (const t of [1, 60, 600, 887, 50_000, 400_000]) {
      expect(sqrtPriceAtTick(t)).toBeGreaterThan(sqrtPriceAtTick(t - 1));
      const prod = sqrtPriceAtTick(t) * sqrtPriceAtTick(-t);
      const rel = Number(((prod > Q96 * Q96 ? prod - Q96 * Q96 : Q96 * Q96 - prod) * 10n ** 12n) / (Q96 * Q96));
      expect(rel).toBeLessThan(1); // < 1e-12 relative
    }
  });

  test('decrease amounts: below range → only token0; above → only token1; in range → both (rounded down)', () => {
    const L = 10n ** 21n;
    const below = amountsForDecrease({ sqrtPriceX96: sqrtPriceAtTick(-1200), tick: -1200, tickLower: -600, tickUpper: 600, liquidity: L });
    expect(below.amount0).toBeGreaterThan(0n);
    expect(below.amount1).toBe(0n);
    const above = amountsForDecrease({ sqrtPriceX96: sqrtPriceAtTick(1200), tick: 1200, tickLower: -600, tickUpper: 600, liquidity: L });
    expect(above.amount0).toBe(0n);
    expect(above.amount1).toBeGreaterThan(0n);
    const mid = amountsForDecrease({ sqrtPriceX96: Q96, tick: 0, tickLower: -600, tickUpper: 600, liquidity: L });
    // symmetric range at price 1 → equal amounts (to within rounding)
    expect(mid.amount0 - mid.amount1 <= 1n && mid.amount1 - mid.amount0 <= 1n).toBe(true);
    // L·(√pU − √p)/(√pU·√p)·2^96, floor — a hand-computed reference
    const sU = sqrtPriceAtTick(600);
    expect(mid.amount0).toBe((((L << 96n) * (sU - Q96)) / sU) / Q96);
  });

  test('fees owed: (growthInside − last)·L / 2^128, with uint256 wrap-around', () => {
    const Q128 = 2n ** 128n;
    expect(feesOwed(5n * Q128, 2n * Q128, 7n)).toBe(21n);
    expect(feesOwed(1n * Q128, 2n ** 256n - 1n * Q128, 3n)).toBe(6n); // wrapped
  });

  test('position info: ticks at bits 8 and 32, sign-extended', () => {
    const enc = (lower: number, upper: number) =>
      (0xabcdefn << 56n) | ((BigInt(upper) & 0xffffffn) << 32n) | ((BigInt(lower) & 0xffffffn) << 8n) | 1n;
    expect(decodePositionInfo(enc(-600, 600))).toEqual({ tickLower: -600, tickUpper: 600, hasSubscriber: true });
    expect(decodePositionInfo(enc(-887220, -60))).toMatchObject({ tickLower: -887220, tickUpper: -60 });
  });

  test('poolId = keccak256(abi.encode(PoolKey))', () => {
    const key = { currency0: '0x00000000000000000000000000000000000000a0', currency1: '0x00000000000000000000000000000000000000a1', fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' } as const;
    expect(poolIdOf(key)).toBe(keccak256(encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [key.currency0, key.currency1, 3000, 60, key.hooks])));
  });
});
