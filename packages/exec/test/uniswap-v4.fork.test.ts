import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { encodeAbiParameters, encodeFunctionData, maxUint128, maxUint160, maxUint256, parseAbi, parseAbiParameters, parseEther, toHex, type Address, type Hex } from 'viem';
import { erc20Abi, V4_ACTIONS, v4PosmAbi, v4StateViewAbi, type TxRequest } from '@blackout/core';
import { guard } from '@blackout/guard';
import { createQuorum } from '@blackout/quorum';
import { ANVIL_ACCOUNTS, repoManifest, setErc20Balance, startFork, type Fork } from '@blackout/testkit';
import { poolIdOf, uniswapV4, type Ctx, type PoolKey } from '@blackout/adapters';
import { runExit } from '../src';

/**
 * Real Uniswap v4 on a Sepolia fork: mint through Permit2 + PositionManager, then discover (log scan),
 * build, Guard, simulate, send and verify through the same runExit the kit uses.
 */
const POSM: Address = '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4';
const POOL_MANAGER: Address = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';
const STATE_VIEW: Address = '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const DUSD: Address = '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA';
const DETH: Address = '0x62715d2762949Ab8Fb124eB01f78898Feb8a596A';
const USER = ANVIL_ACCOUNTS[1]!;
const DEMO_TOKEN_BALANCE_SLOT = 3n; // DemoToken: name, symbol, totalSupply, balanceOf

const KEY: PoolKey = {
  currency0: DETH.toLowerCase() < DUSD.toLowerCase() ? DETH : DUSD,
  currency1: DETH.toLowerCase() < DUSD.toLowerCase() ? DUSD : DETH,
  fee: 3000,
  tickSpacing: 60,
  hooks: '0x0000000000000000000000000000000000000000',
};

const tokenApproveAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
const setupAbi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24)',
]);

let f: Fork;
let ctx: Ctx;
const ids: { inRange?: bigint; outOfRange?: bigint } = {};

async function sendTx(to: Address, data: Hex) {
  const hash = await f.wallet(USER).sendTransaction({ to, data, chain: f.chain, account: USER, gas: 3_000_000n });
  const r = await f.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`setup tx to ${to} reverted`);
  return r;
}

async function mint(tickLower: number, tickUpper: number, liquidity: bigint): Promise<bigint> {
  const mintParams = encodeAbiParameters(parseAbiParameters('(address,address,uint24,int24,address), int24, int24, uint256, uint128, uint128, address, bytes'), [
    [KEY.currency0, KEY.currency1, KEY.fee, KEY.tickSpacing, KEY.hooks], tickLower, tickUpper, liquidity, maxUint128, maxUint128, USER, '0x',
  ]);
  const settle = encodeAbiParameters(parseAbiParameters('address, address'), [KEY.currency0, KEY.currency1]);
  const unlock = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [toHex(Uint8Array.from([V4_ACTIONS.MINT_POSITION, V4_ACTIONS.SETTLE_PAIR])), [mintParams, settle]]);
  const r = await sendTx(POSM, encodeFunctionData({ abi: v4PosmAbi, functionName: 'modifyLiquidities', args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] }));
  const t = r.logs.find((l) => l.address.toLowerCase() === POSM.toLowerCase() && l.topics.length === 4);
  return BigInt(t!.topics[3]!);
}

const bal = (token: Address) => f.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [USER] });

beforeAll(async () => {
  f = await startFork({ chainId: 11155111 });
  for (const t of [DUSD, DETH]) {
    await setErc20Balance(f, t, USER, DEMO_TOKEN_BALANCE_SLOT, parseEther('1000000'));
    await sendTx(t, encodeFunctionData({ abi: tokenApproveAbi, functionName: 'approve', args: [PERMIT2, maxUint256] }));
    await sendTx(PERMIT2, encodeFunctionData({ abi: setupAbi, functionName: 'approve', args: [t, POSM, maxUint160, 2 ** 48 - 1] }));
  }
  const [sqrt] = await f.publicClient.readContract({ address: STATE_VIEW, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolIdOf(KEY)] });
  if (sqrt === 0n) await sendTx(POOL_MANAGER, encodeFunctionData({ abi: setupAbi, functionName: 'initialize', args: [KEY, 2n ** 96n] }));
  const [, tick] = await f.publicClient.readContract({ address: STATE_VIEW, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolIdOf(KEY)] });
  const base = Math.floor(tick / 60) * 60;
  ids.inRange = await mint(base - 600, base + 600, 10n ** 21n);
  ids.outOfRange = await mint(base + 1200, base + 2400, 10n ** 21n); // above price → currency0 only

  const q = createQuorum({ urls: [f.url, f.url.replace('127.0.0.1', 'localhost')], timeoutMs: 60_000 });
  ctx = { q, chainId: 11155111, manifest: repoManifest(), block: await q.pinBlock(), account: USER, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
}, 240_000);

afterAll(async () => f?.stop());

const sender = {
  async sendTransaction(tx: TxRequest) {
    return f.wallet(USER).sendTransaction({ to: tx.to, data: tx.data, value: tx.value, chain: f.chain, account: USER, gas: 3_000_000n });
  },
};

describe('Uniswap v4 adapter on a Sepolia fork (real PoolManager / PositionManager / StateView)', () => {
  test('discover finds both freshly minted positions through the Transfer-log scan', async () => {
    const ps = await uniswapV4.discover(USER, ctx);
    const found = ps.filter((p) => !p.manual).map((p) => p.id);
    expect(found).toEqual(expect.arrayContaining([ids.inRange!.toString(), ids.outOfRange!.toString()]));
    expect(ps.find((p) => p.id === ids.inRange!.toString())!.label).toMatch(/^Uniswap v4 #\d+ (DETH\/DUSD|DUSD\/DETH) 0\.3%$/);
  });

  test('in-range exit: Guard ok → simulated → sent → Recovered, and the math preview equals what arrived', async () => {
    const [pos] = await Promise.all([uniswapV4.byId!(ids.inRange!.toString(), USER, ctx)]);
    const fresh = { ...ctx, block: await ctx.q.pinBlock() };
    const plan = await uniswapV4.buildExit(pos!, fresh);
    expect(guard(plan.calls[0]!, { account: USER, chainId: 11155111, manifest: ctx.manifest }).ok).toBe(true);
    expect(plan.preview!.map((x) => x.token).sort()).toEqual([DETH, DUSD].sort());
    const before = { [DUSD]: await bal(DUSD), [DETH]: await bal(DETH) };
    const res = await runExit(plan, sender, { ...fresh, pollMs: 200, timeoutMs: 60_000 });
    expect(res.reasons).toEqual([]);
    expect(res.status).toBe('recovered');
    for (const p of plan.preview!) expect((await bal(p.token)) - before[p.token]!).toBe(p.amount); // exact: no swaps, so no fees
    const left = await f.publicClient.readContract({ address: POSM, abi: v4PosmAbi, functionName: 'getPositionLiquidity', args: [ids.inRange!] });
    expect(left).toBe(0n);
  });

  test('out-of-range exit pays only currency0; an emptied position disappears from discovery', async () => {
    const fresh = { ...ctx, block: await ctx.q.pinBlock() };
    const pos = await uniswapV4.byId!(ids.outOfRange!.toString(), USER, fresh);
    const plan = await uniswapV4.buildExit(pos, fresh);
    expect(plan.expected.map((e) => e.token)).toEqual([KEY.currency0]);
    const res = await runExit(plan, sender, { ...fresh, pollMs: 200, timeoutMs: 60_000 });
    expect(res.status).toBe('recovered');
    const after = await uniswapV4.discover(USER, { ...ctx, block: await ctx.q.pinBlock() });
    expect(after.filter((p) => !p.manual).map((p) => p.id)).not.toContain(ids.inRange!.toString());
    expect(after.filter((p) => !p.manual).map((p) => p.id)).not.toContain(ids.outOfRange!.toString());
  });

  test('byId refuses a real position owned by another wallet (ownerOf on chain)', async () => {
    const fresh = { ...ctx, block: await ctx.q.pinBlock() };
    await expect(uniswapV4.byId!(ids.inRange!.toString(), ANVIL_ACCOUNTS[2]!, fresh)).rejects.toThrow(/not your wallet/);
  });
});
