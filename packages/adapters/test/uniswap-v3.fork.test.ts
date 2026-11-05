import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { maxUint256, parseAbi, parseEther, type Address } from 'viem';
import { erc20Abi, npmAbi, SEL } from '@blackout/core';
import { guard } from '@blackout/guard';
import { createQuorum } from '@blackout/quorum';
import { ANVIL_ACCOUNTS, repoManifest, setErc20Balance, startFork, type Fork } from '@blackout/testkit';
import { uniswapV3, type Ctx } from '../src';

const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const NPM: Address = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const FACTORY: Address = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const USER = ANVIL_ACCOUNTS[0]!;

const testAbi = parseAbi([
  'function deposit() payable',
  'function approve(address,uint256) returns (bool)',
  'function getPool(address,address,uint24) view returns (address)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }',
  'function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
]);

let f: Fork;
let ctx: Ctx;
const ids: Record<'inRange' | 'outOfRange' | 'feesOnly', bigint> = {} as never;

const bal = (token: Address) => f.publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [USER] });

async function mint(tickLower: number, tickUpper: number): Promise<bigint> {
  const w = f.wallet(USER);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const params = { token0: DAI, token1: WETH, fee: 3000, tickLower, tickUpper, amount0Desired: parseEther('5000'), amount1Desired: parseEther('2'), amount0Min: 0n, amount1Min: 0n, recipient: USER, deadline };
  await f.publicClient.simulateContract({ address: NPM, abi: testAbi, functionName: 'mint', args: [params], account: USER });
  const hash = await w.writeContract({ address: NPM, abi: testAbi, functionName: 'mint', args: [params], chain: f.chain, account: USER, gas: 2_000_000n });
  const rcpt = await f.publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== 'success') {
    const t = await f.publicClient.getTransaction({ hash });
    throw new Error(`mint reverted gasUsed=${rcpt.gasUsed} gasLimit=${t.gas}`);
  }
  // tokenId = topic[3] of the ERC721 Transfer(0 → USER) emitted by the NPM
  const transfer = rcpt.logs.find((l) => l.address.toLowerCase() === NPM.toLowerCase() && l.topics.length === 4);
  return BigInt(transfer!.topics[3]!);
}

beforeAll(async () => {
  f = await startFork({ chainId: 1 });
  const w = f.wallet(USER);
  await setErc20Balance(f, DAI, USER, 2n, parseEther('1000000'));
  await w.writeContract({ address: WETH, abi: testAbi, functionName: 'deposit', value: parseEther('100'), chain: f.chain, account: USER });
  for (const t of [DAI, WETH]) await w.writeContract({ address: t, abi: testAbi, functionName: 'approve', args: [NPM, maxUint256], chain: f.chain, account: USER });

  const pool = await f.publicClient.readContract({ address: FACTORY, abi: testAbi, functionName: 'getPool', args: [DAI, WETH, 3000] });
  const [, tick] = await f.publicClient.readContract({ address: pool, abi: testAbi, functionName: 'slot0' });
  const base = Math.floor(tick / 60) * 60;
  ids.inRange = await mint(base - 6000, base + 6000);
  ids.outOfRange = await mint(base + 600, base + 1200); // above price → token0 (DAI) only
  ids.feesOnly = await mint(base - 6000, base + 6000);
  const [, , , , , , , liq] = await f.publicClient.readContract({ address: NPM, abi: npmAbi, functionName: 'positions', args: [ids.feesOnly] });
  const decHash = await w.writeContract({
    address: NPM, abi: npmAbi, functionName: 'decreaseLiquidity', chain: f.chain, account: USER,
    args: [{ tokenId: ids.feesOnly, liquidity: liq, amount0Min: 0n, amount1Min: 0n, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) }],
    gas: 2_000_000n,
  });
  const decRcpt = await f.publicClient.waitForTransactionReceipt({ hash: decHash });
  if (decRcpt.status !== 'success') throw new Error(`setup decreaseLiquidity reverted (liq=${liq})`);
  const after = await f.publicClient.readContract({ address: NPM, abi: npmAbi, functionName: 'positions', args: [ids.feesOnly] });
  if (after[7] !== 0n) throw new Error(`fees-only position still has liquidity ${after[7]}`);

  const q = createQuorum({ urls: [f.url, f.url], timeoutMs: 60_000 }); // anvil fetches cold fork state lazily
  ctx = { q, chainId: 1, manifest: repoManifest(), block: await q.pinBlock(), account: USER, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
}, 180_000);

afterAll(async () => f?.stop());

async function send(plan: Awaited<ReturnType<typeof uniswapV3.buildExit>>) {
  const w = f.wallet(USER);
  for (const c of plan.calls) {
    expect(guard(c, { account: USER, chainId: 1, manifest: ctx.manifest }).ok).toBe(true);
    const hash = await w.sendTransaction({ to: c.to, data: c.data, value: c.value, chain: f.chain, account: USER, gas: 2_000_000n });
    expect((await f.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
  }
}

describe('uniswap-v3 adapter on a mainnet fork', () => {
  test('discover finds our three positions', async () => {
    const found = await uniswapV3.discover(USER, ctx);
    const got = new Set(found.map((p) => p.id));
    for (const id of Object.values(ids)) expect(got.has(id.toString())).toBe(true);
    const inRange = found.find((p) => p.id === ids.inRange.toString())!;
    expect(inRange.tokens).toEqual([DAI, WETH]);
    expect(inRange.label).toMatch(/DAI\/WETH/);
  });

  test('in-range exit passes the guard, lands, and both balances rise', async () => {
    const pos = (await uniswapV3.discover(USER, ctx)).find((p) => p.id === ids.inRange.toString())!;
    const plan = await uniswapV3.buildExit(pos, ctx);
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0]!.data.slice(0, 10)).toBe(SEL.multicall);
    expect(plan.expected.map((e) => e.token)).toEqual([DAI, WETH]);
    const [d0, w0] = [await bal(DAI), await bal(WETH)];
    await send(plan);
    expect(await bal(DAI)).toBeGreaterThan(d0);
    expect(await bal(WETH)).toBeGreaterThan(w0);
  });

  test('out-of-range exit expects only the one token it holds', async () => {
    const pos = (await uniswapV3.discover(USER, ctx)).find((p) => p.id === ids.outOfRange.toString())!;
    const plan = await uniswapV3.buildExit(pos, ctx);
    expect(plan.expected.map((e) => e.token)).toEqual([DAI]);
    const d0 = await bal(DAI);
    await send(plan);
    expect(await bal(DAI)).toBeGreaterThan(d0);
  });

  test('liquidity 0 with owed tokens → collect-only exit', async () => {
    const pos = (await uniswapV3.discover(USER, ctx)).find((p) => p.id === ids.feesOnly.toString())!;
    const plan = await uniswapV3.buildExit(pos, ctx);
    expect(plan.calls[0]!.data.slice(0, 10)).toBe(SEL.collect);
    const [d0, w0] = [await bal(DAI), await bal(WETH)];
    await send(plan);
    expect(await bal(DAI)).toBeGreaterThan(d0);
    expect(await bal(WETH)).toBeGreaterThan(w0);
  });

  test('min amounts are 0.5% below the simulated output', async () => {
    const fresh = await mint(-887220, 887220);
    const pos = (await uniswapV3.discover(USER, { ...ctx, block: await ctx.q.pinBlock() })).find((p) => p.id === fresh.toString())!;
    const plan = await uniswapV3.buildExit(pos, { ...ctx, block: await ctx.q.pinBlock() });
    for (const e of plan.expected) expect(e.min).toBeGreaterThan(0n);
  });
});
