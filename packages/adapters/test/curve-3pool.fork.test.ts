import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { maxUint256, parseAbi, parseEther, type Address } from 'viem';
import { erc20Abi, SEL } from '@copeybara/core';
import { guard } from '@copeybara/guard';
import { createQuorum } from '@copeybara/quorum';
import { ANVIL_ACCOUNTS, repoManifest, setErc20Balance, startFork, type Fork } from '@copeybara/testkit';
import { curve3pool, type Ctx } from '../src';

const POOL: Address = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
const LP: Address = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490';
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT: Address = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const LP_USER = ANVIL_ACCOUNTS[0]!;
const testAbi = parseAbi(['function approve(address,uint256) returns (bool)', 'function add_liquidity(uint256[3] amounts, uint256 min_mint_amount)']);

let f: Fork;
let ctx: Ctx;
const bal = (t: Address) => f.publicClient.readContract({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [LP_USER] });

beforeAll(async () => {
  f = await startFork({ chainId: 1 });
  await setErc20Balance(f, DAI, LP_USER, 2n, parseEther('50000'));
  const w = f.wallet(LP_USER);
  for (const [fn, args] of [['approve', [POOL, maxUint256]], ['add_liquidity', [[parseEther('50000'), 0n, 0n], 0n]]] as const) {
    const hash = await w.writeContract({ address: fn === 'approve' ? DAI : POOL, abi: testAbi, functionName: fn, args, chain: f.chain, account: LP_USER, gas: 2_000_000n } as never);
    expect((await f.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
  }
  const q = createQuorum({ urls: [f.url, f.url], timeoutMs: 60_000 });
  ctx = { q, chainId: 1, manifest: repoManifest(), block: await q.pinBlock(), account: LP_USER, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
}, 300_000);

afterAll(async () => f?.stop());

describe('curve-3pool adapter on a mainnet fork', () => {
  test('discover finds the 3CRV balance', async () => {
    const [p] = await curve3pool.discover(LP_USER, ctx);
    expect(p!.tokens).toEqual([DAI, USDC, USDT]);
    expect(p!.label).toMatch(/Curve 3pool/);
  });

  test('remove_liquidity exit passes the guard, lands, and all three coins rise', async () => {
    const [p] = await curve3pool.discover(LP_USER, ctx);
    const plan = await curve3pool.buildExit(p!, ctx);
    expect(plan.calls[0]!.to).toBe(POOL);
    expect(plan.calls[0]!.data.slice(0, 10)).toBe(SEL.curveRemoveLiquidity);
    expect(plan.expected.map((e) => e.token)).toEqual([DAI, USDC, USDT]);
    expect(guard(plan.calls[0]!, { account: LP_USER, chainId: 1, manifest: ctx.manifest }).ok).toBe(true);

    const before = await Promise.all([DAI, USDC, USDT].map(bal));
    const hash = await f.wallet(LP_USER).sendTransaction({ to: POOL, data: plan.calls[0]!.data, chain: f.chain, account: LP_USER, gas: 2_000_000n });
    expect((await f.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
    const after = await Promise.all([DAI, USDC, USDT].map(bal));
    plan.expected.forEach((e, i) => expect(after[i]! - before[i]!).toBeGreaterThanOrEqual(e.min));
    expect(await bal(LP)).toBe(0n);
  });

  test('no LP balance → no positions', async () => {
    expect(await curve3pool.discover(ANVIL_ACCOUNTS[2]!, { ...ctx, account: ANVIL_ACCOUNTS[2]! })).toEqual([]);
  });
});
