import { describe, expect, test, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, maxUint128, type Hex } from 'viem';
import { erc20Abi, EXIT_SELECTORS, npmAbi, type Address, type ExitPlan, type Manifest, type TxRequest } from '@blackout/core';
import { CallRevertedError, QuorumError, type Quorum, type Receipt } from '@blackout/quorum';
import type { Ctx } from '@blackout/adapters';
import { buildReport, reportToHtml, reportToJson, runExit, type Sender } from '../src';

const USER: Address = '0x1111111111111111111111111111111111111111';
const NPM: Address = '0x1238536071E1c677A632429e3655c799b22cDA52';
const T0: Address = '0x00000000000000000000000000000000000000a0';
const T1: Address = '0x00000000000000000000000000000000000000a1';
const ATTACKER: Address = '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0';
const manifest: Manifest = {
  v: 1,
  chains: { '11155111': { 'uniswap-v3': { positionManager: { address: NPM, selectors: [...EXIT_SELECTORS['uniswap-v3'].positionManager] } } } },
};

const collect = (recipient: Address): Hex =>
  encodeFunctionData({ abi: npmAbi, functionName: 'collect', args: [{ tokenId: 7n, recipient, amount0Max: maxUint128, amount1Max: maxUint128 }] });

const plan = (opts: { recipient?: Address; expected?: Address[] } = {}): ExitPlan => ({
  position: { adapter: 'uniswap-v3', id: '7', label: 'Uniswap v3 #7', tokens: [T0, T1], raw: {} },
  calls: [{ chainId: 11155111, from: USER, to: NPM, data: collect(opts.recipient ?? USER), value: 0n } satisfies TxRequest],
  expected: (opts.expected ?? [T0, T1]).map((token) => ({ token, min: 1n })),
});

interface StubOpts {
  balances?: { before: Record<Address, bigint>; after: Record<Address, bigint> };
  receipt?: Partial<Receipt> | null;
  simRevert?: boolean;
  disagree?: boolean;
}

function stub(o: StubOpts = {}) {
  const balances = o.balances ?? { before: { [T0]: 10n, [T1]: 5n }, after: { [T0]: 20n, [T1]: 9n } };
  let sent = false;
  const q = {
    pinBlock: async () => 100n,
    call: async ({ to, data }: { to: Address; data: Hex }, block: bigint) => {
      if (o.disagree) throw new QuorumError('DISAGREE', 'RPC paths disagree on eth_call; refusing to continue.');
      if (to === NPM) {
        if (o.simRevert) throw new CallRevertedError('execution reverted: Not approved');
        return '0x';
      }
      decodeFunctionData({ abi: erc20Abi, data });
      const map = block >= 101n ? balances.after : balances.before;
      return encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: map[to] ?? 0n });
    },
    read: undefined as never,
    getReceipt: async (hash: Hex) =>
      !sent ? null : o.receipt === null ? null : { status: 'success', blockNumber: 101n, blockHash: '0xbb', gasUsed: 90_000n, transactionHash: hash, ...o.receipt },
  };
  // read() via call() to share the balance map
  (q as unknown as Quorum).read = (async (p: Parameters<Quorum['read']>[0], b: bigint) => {
    const data = encodeFunctionData({ abi: p.abi, functionName: p.functionName, args: p.args } as never);
    const out = await q.call({ to: p.address, data }, b);
    return (await import('viem')).decodeFunctionResult({ abi: p.abi, functionName: p.functionName, data: out } as never);
  }) as never;
  const sender: Sender = { sendTransaction: vi.fn(async () => { sent = true; return '0xaa' as Hex; }) };
  const ctx: Ctx & { pollMs: number; timeoutMs: number } = {
    q: q as unknown as Quorum, chainId: 11155111, manifest, block: 100n, account: USER, slippageBps: 50, nowSec: () => 1_800_000_000, pollMs: 1, timeoutMs: 50,
  };
  return { sender, ctx };
}

describe('runExit', () => {
  test('happy path → recovered with deltas, hashes and gas', async () => {
    const { sender, ctx } = stub();
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('recovered');
    expect(r.txHashes).toEqual(['0xaa']);
    expect(r.before[T0]).toBe(10n);
    expect(r.after[T0]).toBe(20n);
    expect(r.gasUsed).toBe(90_000n);
  });

  test('guard rejection never reaches the wallet', async () => {
    const { sender, ctx } = stub();
    const r = await runExit(plan({ recipient: ATTACKER }), sender, ctx);
    expect(r.status).toBe('rejected');
    expect(r.reasons.join(' ')).toMatch(/not your connected account/);
    expect(sender.sendTransaction).not.toHaveBeenCalled();
  });

  test('simulation revert → rejected, nothing sent', async () => {
    const { sender, ctx } = stub({ simRevert: true });
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('rejected');
    expect(r.reasons[0]).toMatch(/Simulation failed/);
    expect(sender.sendTransaction).not.toHaveBeenCalled();
  });

  test('quorum disagreement → rejected, nothing sent', async () => {
    const { sender, ctx } = stub({ disagree: true });
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('rejected');
    expect(r.reasons[0]).toMatch(/disagree/);
    expect(sender.sendTransaction).not.toHaveBeenCalled();
  });

  test('receipt status 0 → not recovered: transaction reverted', async () => {
    const { sender, ctx } = stub({ receipt: { status: 'reverted' } });
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('not-recovered');
    expect(r.reasons).toContain('transaction reverted');
  });

  test('status 1 but balance unchanged → not recovered, names the token', async () => {
    const { sender, ctx } = stub({ balances: { before: { [T0]: 10n, [T1]: 5n }, after: { [T0]: 20n, [T1]: 5n } } });
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('not-recovered');
    expect(r.reasons.join(' ')).toMatch(new RegExp(`no balance increase for ${T1}`, 'i'));
  });

  test('single expected token (out-of-range position) is enough', async () => {
    const { sender, ctx } = stub({ balances: { before: { [T0]: 10n, [T1]: 5n }, after: { [T0]: 11n, [T1]: 5n } } });
    expect((await runExit(plan({ expected: [T0] }), sender, ctx)).status).toBe('recovered');
  });

  test('no receipt before timeout → not recovered', async () => {
    const { sender, ctx } = stub({ receipt: null });
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('not-recovered');
    expect(r.reasons[0]).toMatch(/no confirmed receipt/);
  });

  test('wallet rejection → not recovered with a plain reason', async () => {
    const { ctx } = stub();
    const sender: Sender = { sendTransaction: async () => { throw Object.assign(new Error('User rejected the request.'), { code: 4001 }); } };
    const r = await runExit(plan(), sender, ctx);
    expect(r.status).toBe('not-recovered');
    expect(r.reasons[0]).toMatch(/rejected the transaction in your wallet/);
  });
});

describe('report', () => {
  const base = {
    kit: { version: 2, sha256: 'ab'.repeat(32) },
    ensName: 'demoswap-blackout.eth',
    startedAt: 1_000_000,
    failures: [{ kind: 'site-down', at: 1_000_000 }],
    results: [],
    guardVerdicts: { accepted: 1, rejected: 1, reasons: ['approve is never part of an exit'] },
  };
  test('timeToExitSec = (lastReceiptAt − firstFailureAt)/1000', () => {
    const r = buildReport({ ...base, firstFailureAt: 1_000_000, lastReceiptAt: 1_042_500 });
    expect(r.timeToExitSec).toBe(42.5);
  });
  test('timeToExitSec is null without both timestamps', () => {
    expect(buildReport(base).timeToExitSec).toBeNull();
  });
  test('html escapes and contains the hashes', () => {
    const r = buildReport({
      ...base,
      ensName: '<script>x</script>.eth',
      results: [{ positionId: '7', status: 'recovered', reasons: [], txHashes: ['0xaa'], before: { [T0]: 1n }, after: { [T0]: 2n }, gasUsed: 1n }],
    });
    const html = reportToHtml(r);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('0xaa');
    expect(html).toContain('Recovered');
  });
  test('report JSON-serialises bigints as strings', () => {
    const r = buildReport({ ...base, results: [{ positionId: '7', status: 'recovered', reasons: [], txHashes: [], before: { [T0]: 1n }, after: { [T0]: 2n }, gasUsed: 3n }] });
    const j = JSON.parse(reportToJson(r));
    expect(j.results[0].gasUsed).toBe('3');
  });
});
