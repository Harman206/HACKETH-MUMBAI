import { describe, expect, test } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, getAddress, pad, parseAbiParameters, toHex, type Hex } from 'viem';
import { EXIT_SELECTORS, V4_ACTIONS, v4PosmAbi, type Address, type Manifest } from '@blackout/core';
import { guard } from '@blackout/guard';
import { QuorumError, type Quorum } from '@blackout/quorum';
import { uniswapV4 } from '../src/uniswap-v4';
import { amountsForDecrease, sqrtPriceAtTick } from '../src/v4-math';
import type { Ctx } from '../src/types';

const USER: Address = '0x1111111111111111111111111111111111111111';
const OTHER: Address = '0x2222222222222222222222222222222222222222';
const POSM: Address = '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4';
const SV: Address = '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C';
const T0: Address = getAddress('0x00000000000000000000000000000000000000a0');
const T1: Address = getAddress('0x00000000000000000000000000000000000000a1');
const ZERO: Address = '0x0000000000000000000000000000000000000000';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const manifest: Manifest = {
  v: 1,
  chains: { '11155111': { 'uniswap-v4': { positionManager: { address: POSM, selectors: [...EXIT_SELECTORS['uniswap-v4'].positionManager] }, stateView: { address: SV, selectors: [] } } } },
};

const info = (lower: number, upper: number) => ((BigInt(upper) & 0xffffffn) << 32n) | ((BigInt(lower) & 0xffffffn) << 8n);
const Q128 = 2n ** 128n;

interface Pos { owner: Address; liquidity: bigint; c0?: Address; lower?: number; upper?: number }

function stub(o: { balance: bigint; positions: Record<string, Pos>; logIds: bigint[]; logsFailBefore?: bigint; tick?: number }) {
  const calls: string[] = [];
  const tick = o.tick ?? 0;
  const q = {
    read: async (p: { functionName: string; args?: readonly unknown[] }) => {
      calls.push(p.functionName);
      const id = String(p.args?.[0]);
      switch (p.functionName) {
        case 'balanceOf': return o.balance;
        case 'ownerOf': if (!o.positions[id]) throw new Error('NOT_MINTED'); return o.positions[id]!.owner;
        case 'getPositionLiquidity': return o.positions[id]?.liquidity ?? 0n;
        case 'getPoolAndPositionInfo': {
          const x = o.positions[id];
          if (!x) return [{ currency0: ZERO, currency1: ZERO, fee: 0, tickSpacing: 0, hooks: ZERO }, 0n];
          return [{ currency0: x.c0 ?? T0, currency1: T1, fee: 3000, tickSpacing: 60, hooks: ZERO }, info(x.lower ?? -600, x.upper ?? 600)];
        }
        case 'symbol': return 'TKN';
        case 'getSlot0': return [sqrtPriceAtTick(tick), tick, 0, 3000];
        case 'getFeeGrowthInside': return [5n * Q128, 9n * Q128];
        case 'getPositionInfo': return [0n, 2n * Q128, 4n * Q128];
      }
      throw new Error(`unexpected read ${p.functionName}`);
    },
    getLogs: async (f: { topics?: (Hex | null)[] }, from: bigint, to: bigint) => {
      calls.push(`getLogs ${from}-${to}`);
      expect(f.topics?.[0]).toBe(TRANSFER);
      expect(f.topics?.[2]).toBe(pad(USER));
      if (o.logsFailBefore !== undefined && from < o.logsFailBefore) throw new QuorumError('TOO_FEW', 'Only 1 of 3 RPC paths answered eth_getLogs; need 2.');
      return o.logIds.map((id) => ({ address: POSM, topics: [TRANSFER, pad(OTHER), pad(USER), pad(toHex(id))], data: '0x', blockNumber: toHex(to), transactionHash: '0x', logIndex: '0x0' }));
    },
  } as unknown as Quorum;
  const ctx: Ctx = { q, chainId: 11155111, manifest, block: 1_000_000n, account: USER, slippageBps: 50, nowSec: () => 1_800_000_000 };
  return { ctx, calls };
}

describe('Uniswap v4 adapter', () => {
  test('discover: positions from recent Transfer logs, kept only if the user still owns them and they hold liquidity', async () => {
    const { ctx } = stub({
      balance: 2n,
      logIds: [7n, 8n, 9n],
      positions: { '7': { owner: USER, liquidity: 10n ** 18n }, '8': { owner: OTHER, liquidity: 1n }, '9': { owner: USER, liquidity: 0n } },
    });
    const ps = await uniswapV4.discover(USER, ctx);
    expect(ps.map((p) => p.id)).toEqual(['v4:7']); // v3 and v4 NFT ids are separate counters: never let them collide
    expect(ps[0]!.label).toBe('Uniswap v4 #7 TKN/TKN 0.3%');
    expect(ps[0]!.tokens).toEqual([T0, T1]);
  });

  test('discover: owning more than the scan found → one manual row that says how many and what to do', async () => {
    const { ctx } = stub({ balance: 3n, logIds: [7n], positions: { '7': { owner: USER, liquidity: 10n ** 18n } } });
    const ps = await uniswapV4.discover(USER, ctx);
    expect(ps).toHaveLength(2);
    expect(ps[1]).toMatchObject({ id: 'uniswap-v4:not-found', manual: expect.stringMatching(/2 more Uniswap v4 positions.*Enter the position ID/) });
  });

  test('discover: scans backwards in 10k-block chunks; one failed chunk is skipped, two in a row end the scan (results kept)', async () => {
    const { ctx, calls } = stub({ balance: 1n, logIds: [7n], logsFailBefore: 980_000n, positions: { '7': { owner: USER, liquidity: 1n } } });
    const ps = await uniswapV4.discover(USER, ctx);
    expect(ps.map((p) => p.id)).toEqual(['v4:7']);
    expect(calls.filter((c) => c.startsWith('getLogs'))).toEqual(['getLogs 990001-1000000', 'getLogs 980001-990000', 'getLogs 970001-980000', 'getLogs 960001-970000']);
  });

  test('discover: a wallet with no v4 NFTs does no log scan', async () => {
    const { ctx, calls } = stub({ balance: 0n, logIds: [], positions: {} });
    expect(await uniswapV4.discover(USER, ctx)).toEqual([]);
    expect(calls).toEqual(['balanceOf']);
  });

  test('native-ETH pools are listed as manual (this kit exits ERC-20 pairs only)', async () => {
    const { ctx } = stub({ balance: 1n, logIds: [7n], positions: { '7': { owner: USER, liquidity: 1n, c0: ZERO } } });
    const [p] = await uniswapV4.discover(USER, ctx);
    expect(p!.manual).toMatch(/native ETH/);
  });

  test('byId: adds a position the scan missed, but only if this wallet owns it', async () => {
    const { ctx } = stub({ balance: 1n, logIds: [], positions: { '41': { owner: USER, liquidity: 5n }, '42': { owner: OTHER, liquidity: 5n } } });
    expect((await uniswapV4.byId!('41', USER, ctx)).id).toBe('v4:41');
    expect((await uniswapV4.byId!('#41', USER, ctx)).id).toBe('v4:41'); // as shown in labels
    await expect(uniswapV4.byId!('42', USER, ctx)).rejects.toThrow(/owned by 0x2222…2222, not your wallet/);
    await expect(uniswapV4.byId!('99', USER, ctx)).rejects.toThrow(/does not exist/);
    await expect(uniswapV4.byId!('abc', USER, ctx)).rejects.toThrow(/number/);
  });

  test('buildExit: DECREASE_LIQUIDITY(all, mins = math − slippage) + TAKE_PAIR(user); the Guard accepts it', async () => {
    const L = 10n ** 21n;
    const { ctx } = stub({ balance: 1n, logIds: [7n], positions: { '7': { owner: USER, liquidity: L } } });
    const [pos] = await uniswapV4.discover(USER, ctx);
    const plan = await uniswapV4.buildExit(pos!, ctx);
    expect(plan.calls).toHaveLength(1);
    const call = plan.calls[0]!;
    expect(call).toMatchObject({ to: POSM, from: USER, value: 0n, chainId: 11155111 });
    expect(guard(call, { account: USER, chainId: 11155111, manifest })).toEqual({ ok: true, reasons: [] });

    const { args } = decodeFunctionData({ abi: v4PosmAbi, data: call.data });
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes, bytes[]'), args![0] as Hex);
    expect(actions).toBe(toHex(Uint8Array.from([V4_ACTIONS.DECREASE_LIQUIDITY, V4_ACTIONS.TAKE_PAIR])));
    const [id, liq, min0, min1] = decodeAbiParameters(parseAbiParameters('uint256, uint256, uint128, uint128, bytes'), params[0]!);
    const principal = amountsForDecrease({ sqrtPriceX96: sqrtPriceAtTick(0), tick: 0, tickLower: -600, tickUpper: 600, liquidity: L });
    expect([id, liq]).toEqual([7n, L]);
    expect(min0).toBe((principal.amount0 * 9_950n) / 10_000n);
    expect(min1).toBe((principal.amount1 * 9_950n) / 10_000n);
    expect(decodeAbiParameters(parseAbiParameters('address, address, address'), params[1]!)).toEqual([T0, T1, USER]);

    // preview = principal + fees ((5−2)·L and (9−4)·L for the stubbed fee growth)
    expect(plan.preview).toEqual([
      { token: T0, amount: principal.amount0 + 3n * L },
      { token: T1, amount: principal.amount1 + 5n * L },
    ]);
    expect(plan.expected.map((e) => e.token)).toEqual([T0, T1]);
  });

  test('buildExit: out of range below → only token0 is expected', async () => {
    const { ctx } = stub({ balance: 1n, logIds: [7n], tick: -1200, positions: { '7': { owner: USER, liquidity: 10n ** 18n } } });
    const [pos] = await uniswapV4.discover(USER, ctx);
    const q = ctx.q as unknown as { read: (p: { functionName: string }) => Promise<unknown> };
    const orig = q.read;
    q.read = async (p) => (p.functionName === 'getFeeGrowthInside' || p.functionName === 'getPositionInfo' ? [0n, 0n, 0n] : orig(p));
    const plan = await uniswapV4.buildExit(pos!, ctx);
    expect(plan.expected.map((e) => e.token)).toEqual([T0]);
  });

  test('review M9: a dynamic-fee pool is labelled as such, not as 838.8608%', async () => {
    const { ctx } = stub({ balance: 1n, logIds: [7n], positions: { '7': { owner: USER, liquidity: 1n } } });
    const q = ctx.q as unknown as { read: (p: { functionName: string; args?: readonly unknown[] }) => Promise<unknown> };
    const orig = q.read;
    q.read = async (p) => {
      const r = await orig(p);
      return p.functionName === 'getPoolAndPositionInfo' ? [{ ...(r as [Record<string, unknown>])[0], fee: 0x800000 }, (r as unknown[])[1]] : r;
    };
    const [p] = await uniswapV4.discover(USER, ctx);
    expect(p!.label).toBe('Uniswap v4 #7 TKN/TKN dynamic fee');
  });
});

