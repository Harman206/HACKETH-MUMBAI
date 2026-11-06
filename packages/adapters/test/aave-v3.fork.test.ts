import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { maxUint256, parseAbi, parseEther, type Address } from 'viem';
import { erc20Abi, SEL } from '@copeybara/core';
import { guard } from '@copeybara/guard';
import { createQuorum } from '@copeybara/quorum';
import { ANVIL_ACCOUNTS, repoManifest, setErc20Balance, startFork, type Fork } from '@copeybara/testkit';
import { aaveV3, type Ctx } from '../src';

const POOL: Address = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const DAI: Address = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const SUPPLIER = ANVIL_ACCOUNTS[1]!;
const BORROWER = ANVIL_ACCOUNTS[2]!;

const testAbi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function deposit() payable',
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
]);

let f: Fork;
const ctxFor = async (account: Address): Promise<Ctx> => {
  const q = createQuorum({ urls: [f.url, f.url], timeoutMs: 60_000 }); // anvil fetches cold fork state lazily
  return { q, chainId: 1, manifest: repoManifest(), block: await q.pinBlock(), account, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
};
const write = async (from: Address, address: Address, functionName: string, args: unknown[], value?: bigint) => {
  const hash = await f.wallet(from).writeContract({ address, abi: testAbi, functionName, args, value, chain: f.chain, account: from, gas: 2_000_000n } as never);
  const r = await f.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} reverted`);
};

beforeAll(async () => {
  f = await startFork({ chainId: 1 });
  await setErc20Balance(f, DAI, SUPPLIER, 2n, parseEther('10000'));
  await write(SUPPLIER, DAI, 'approve', [POOL, maxUint256]);
  await write(SUPPLIER, POOL, 'supply', [DAI, parseEther('10000'), SUPPLIER, 0]);

  await write(BORROWER, WETH, 'deposit', [], parseEther('10'));
  await write(BORROWER, WETH, 'approve', [POOL, maxUint256]);
  await write(BORROWER, POOL, 'supply', [WETH, parseEther('10'), BORROWER, 0]);
  await write(BORROWER, POOL, 'borrow', [DAI, parseEther('1000'), 2n, 0, BORROWER]);
}, 300_000);

afterAll(async () => f?.stop());

describe('aave-v3 adapter on a mainnet fork', () => {
  test('supply-only user: discover → withdraw(max, to self) passes the guard, lands, DAI rises', async () => {
    const ctx = await ctxFor(SUPPLIER);
    const ps = await aaveV3.discover(SUPPLIER, ctx);
    const dai = ps.find((p) => p.tokens[0] === DAI)!;
    expect(dai).toBeDefined();
    expect(dai.manual).toBeUndefined();
    expect(dai.label).toMatch(/DAI/);

    const plan = await aaveV3.buildExit(dai, ctx);
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0]!.data.slice(0, 10)).toBe(SEL.aaveWithdraw);
    expect(plan.expected).toEqual([{ token: DAI, min: expect.any(BigInt) }]);
    expect(plan.expected[0]!.min).toBeGreaterThan(parseEther('9900'));
    expect(guard(plan.calls[0]!, { account: SUPPLIER, chainId: 1, manifest: ctx.manifest }).ok).toBe(true);

    const before = await f.publicClient.readContract({ address: DAI, abi: erc20Abi, functionName: 'balanceOf', args: [SUPPLIER] });
    const hash = await f.wallet(SUPPLIER).sendTransaction({ to: plan.calls[0]!.to, data: plan.calls[0]!.data, chain: f.chain, account: SUPPLIER, gas: 2_000_000n });
    expect((await f.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
    const after = await f.publicClient.readContract({ address: DAI, abi: erc20Abi, functionName: 'balanceOf', args: [SUPPLIER] });
    expect(after - before).toBeGreaterThanOrEqual(plan.expected[0]!.min);
  });

  test('borrower: positions flagged manual with no exit calls', async () => {
    const ctx = await ctxFor(BORROWER);
    const ps = await aaveV3.discover(BORROWER, ctx);
    const weth = ps.find((p) => p.tokens[0] === WETH)!;
    expect(weth.manual).toMatch(/debt/i);
    const plan = await aaveV3.buildExit(weth, ctx);
    expect(plan.calls).toEqual([]);
  });

  test('no Aave entry for the chain → no positions', async () => {
    const ctx = await ctxFor(SUPPLIER);
    expect(await aaveV3.discover(SUPPLIER, { ...ctx, chainId: 11155111 })).toEqual([]);
  });
});
