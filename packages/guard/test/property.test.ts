import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { encodeFunctionData, getAddress, maxUint128, type Hex } from 'viem';
import { BANNED_SELECTORS, npmAbi, SEL, type Address, type TxRequest } from '@blackout/core';
import { guard } from '../src';
import { aaveWithdrawData, approveData, curveRemoveData, multicallData, USER } from './helpers';
import { AAVE_POOL, CURVE_POOL, ctx1, NPM_MAINNET, tx } from './manifest-fixture';

const RUNS = 10_000;
const ALLOWED = new Set<string>([SEL.multicall, SEL.decreaseLiquidity, SEL.collect, SEL.aaveWithdraw, SEL.curveRemoveLiquidity]);
const MANIFEST_ADDRS = new Set([NPM_MAINNET, AAVE_POOL, CURVE_POOL].map((a) => a.toLowerCase()));

const u = (bits: number) => fc.bigInt({ min: 0n, max: 2n ** BigInt(bits) - 1n });
const addr = fc.uint8Array({ minLength: 20, maxLength: 20 }).map((b) => getAddress(`0x${Buffer.from(b).toString('hex')}`) as Address);
const otherAddr = addr.filter((a) => a.toLowerCase() !== USER.toLowerCase());

/** Arbitrary valid Uniswap exit: decrease + collect (or collect only), random ids/amounts/deadline. */
const uniExit = fc
  .record({ tokenId: u(64), liquidity: u(128), min0: u(128), min1: u(128), deadline: u(40), collectOnly: fc.boolean() })
  .map((p) => {
    const collect = encodeFunctionData({
      abi: npmAbi,
      functionName: 'collect',
      args: [{ tokenId: p.tokenId, recipient: USER, amount0Max: maxUint128, amount1Max: maxUint128 }],
    });
    if (p.collectOnly) return { calls: [collect], data: multicallData([collect]) };
    const dec = encodeFunctionData({
      abi: npmAbi,
      functionName: 'decreaseLiquidity',
      args: [{ tokenId: p.tokenId, liquidity: p.liquidity, amount0Min: p.min0, amount1Min: p.min1, deadline: p.deadline }],
    });
    return { calls: [dec, collect], data: multicallData([dec, collect]) };
  });

const validExit: fc.Arbitrary<TxRequest> = fc.oneof(
  uniExit.map((e) => tx(NPM_MAINNET, e.data)),
  fc.tuple(addr).map(([asset]) => tx(AAVE_POOL, aaveWithdrawData(USER, asset))),
  u(128).map((amt) => tx(CURVE_POOL, curveRemoveData(amt))),
);

describe('guard properties', () => {
  test('unmutated valid exits always pass', () => {
    fc.assert(fc.property(validExit, (t) => guard(t, ctx1).ok), { numRuns: RUNS });
  });

  test('recipient mutated to someone else always fails', () => {
    fc.assert(
      fc.property(fc.tuple(otherAddr, u(64)), ([evil, id]) => {
        const collect = encodeFunctionData({
          abi: npmAbi,
          functionName: 'collect',
          args: [{ tokenId: id, recipient: evil, amount0Max: maxUint128, amount1Max: maxUint128 }],
        });
        return !guard(tx(NPM_MAINNET, multicallData([collect])), ctx1).ok && !guard(tx(AAVE_POOL, aaveWithdrawData(evil)), ctx1).ok;
      }),
      { numRuns: RUNS },
    );
  });

  test('target mutated outside the manifest always fails', () => {
    fc.assert(
      fc.property(validExit, addr.filter((a) => !MANIFEST_ADDRS.has(a.toLowerCase())), (t, to) => !guard({ ...t, to }, ctx1).ok),
      { numRuns: RUNS },
    );
  });

  test('selector mutated to a non-allowlisted 4 bytes always fails', () => {
    const sel = fc
      .uint8Array({ minLength: 4, maxLength: 4 })
      .map((b) => `0x${Buffer.from(b).toString('hex')}` as Hex)
      .filter((s) => !ALLOWED.has(s));
    fc.assert(fc.property(validExit, sel, (t, s) => !guard({ ...t, data: `${s}${t.data.slice(10)}` as Hex }, ctx1).ok), {
      numRuns: RUNS,
    });
  });

  test('any positive value always fails', () => {
    fc.assert(fc.property(validExit, fc.bigInt({ min: 1n, max: 2n ** 128n }), (t, v) => !guard({ ...t, value: v }, ctx1).ok), {
      numRuns: RUNS,
    });
  });

  test('an approve injected at any index of a uniswap multicall always fails', () => {
    fc.assert(
      fc.property(uniExit, fc.nat(), otherAddr, (e, i, spender) => {
        const calls = [...e.calls];
        calls.splice(i % (calls.length + 1), 0, approveData(spender));
        return !guard(tx(NPM_MAINNET, multicallData(calls)), ctx1).ok;
      }),
      { numRuns: RUNS },
    );
  });

  test('sanity: banned set is disjoint from allowlist', () => {
    for (const s of ALLOWED) expect(BANNED_SELECTORS.has(s as Hex)).toBe(false);
  });
});
