import { afterEach, describe, expect, test } from 'vitest';
import { createQuorum, QuorumError, CallRevertedError } from '../src';
import { fakeRpc, type Fake } from './fake-rpc';

let fakes: Fake[] = [];
const three = async (opts: Parameters<typeof fakeRpc>[0][] = [{}, {}, {}]) => {
  fakes = await Promise.all(opts.map((o) => fakeRpc(o)));
  return fakes;
};
afterEach(async () => {
  await Promise.all(fakes.map((f) => f.close()));
  fakes = [];
});
const TO = '0x1111111111111111111111111111111111111111' as const;
const fast = { timeoutMs: 300, retries: 2 };

describe('quorum', () => {
  test('all honest → returns the agreed value', async () => {
    const f = await three();
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    expect(await q.chainId()).toBe(11155111);
    expect(await q.call({ to: TO, data: '0x' }, 100n)).toBe('0x01');
  });

  test('one path down → still answers, status shows it down', async () => {
    const f = await three();
    const q = createQuorum({ urls: [f[0]!.url, f[1]!.url, 'http://127.0.0.1:1'], ...fast });
    expect(await q.call({ to: TO, data: '0x' }, 100n)).toBe('0x01');
    const s = q.status();
    expect(s.filter((x) => x.up)).toHaveLength(2);
    expect(s[2]!.up).toBe(false);
  });

  test('two paths down → TOO_FEW', async () => {
    const f = await three();
    const q = createQuorum({ urls: [f[0]!.url, 'http://127.0.0.1:1', 'http://127.0.0.1:2'], ...fast });
    await expect(q.call({ to: TO, data: '0x' }, 100n)).rejects.toMatchObject({ kind: 'TOO_FEW' });
  });

  test('one path lying on eth_call → DISAGREE', async () => {
    const f = await three([{}, {}, { callResult: '0x02' }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    const err = await q.call({ to: TO, data: '0x' }, 100n).catch((e) => e);
    expect(err).toBeInstanceOf(QuorumError);
    expect(err.kind).toBe('DISAGREE');
  });

  test('a path on a different chain → CHAIN_MISMATCH, and nothing else is read', async () => {
    const f = await three([{}, {}, { chainId: 1 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    await expect(q.pinBlock()).rejects.toMatchObject({ kind: 'CHAIN_MISMATCH' });
    await expect(q.call({ to: TO, data: '0x' }, 1n)).rejects.toMatchObject({ kind: 'CHAIN_MISMATCH' });
    expect(f[0]!.calls.some((c) => c.method === 'eth_call')).toBe(false);
  });

  test('different heights → pins the minimum and reads at that block', async () => {
    const f = await three([{ block: 100 }, { block: 101 }, { block: 103 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    const b = await q.pinBlock();
    expect(b).toBe(100n);
    await q.call({ to: TO, data: '0x' }, b);
    for (const x of f) {
      const call = x.calls.find((c) => c.method === 'eth_call')!;
      expect(call.params[1]).toBe('0x64');
    }
  });

  test('slow path is retried 3 times then marked down', async () => {
    const f = await three([{}, {}, { delayMs: 1000 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    expect(await q.call({ to: TO, data: '0x' }, 100n)).toBe('0x01');
    // 1 try + 2 retries on the first request (eth_chainId), then marked down and skipped during cooldown
    expect(f[2]!.calls).toHaveLength(3);
    expect(f[2]!.calls.every((c) => c.method === 'eth_chainId')).toBe(true);
    expect(q.status()[2]!.up).toBe(false);
    expect(q.status()[2]!.lastError).toMatch(/timeout/);
  });

  test('HTTP 429 counts as a failure, not an answer', async () => {
    const f = await three([{}, {}, { status: 429 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    expect(await q.call({ to: TO, data: '0x' }, 100n)).toBe('0x01');
    expect(q.status()[2]!.up).toBe(false);
  });

  test('agreed revert surfaces as CallRevertedError', async () => {
    const rev = { code: 3, message: 'execution reverted', data: '0x08c379a0' };
    const f = await three([{ callError: rev }, { callError: rev }, { callError: rev }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    await expect(q.call({ to: TO, data: '0x' }, 100n)).rejects.toBeInstanceOf(CallRevertedError);
  });

  test('revert on one path, success on others → DISAGREE', async () => {
    const f = await three([{}, {}, { callError: { code: 3, message: 'execution reverted' } }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    await expect(q.call({ to: TO, data: '0x' }, 100n)).rejects.toMatchObject({ kind: 'DISAGREE' });
  });

  test('receipt: agreement on status and blockHash', async () => {
    const r = { status: '0x1', blockNumber: '0x65', blockHash: '0xaa', gasUsed: '0x5208', transactionHash: '0xbb' };
    const f = await three([{ receipt: r }, { receipt: r }, { receipt: null }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    expect(await q.getReceipt('0xbb')).toEqual({ status: 'success', blockNumber: 101n, blockHash: '0xaa', gasUsed: 21000n, transactionHash: '0xbb' });
    f[1]!.set({ receipt: { ...r, blockHash: '0xcc' } });
    await expect(q.getReceipt('0xbb')).rejects.toMatchObject({ kind: 'DISAGREE' });
    f[1]!.set({ receipt: null });
    expect(await q.getReceipt('0xbb')).toBeNull();
  });

  test('getBalance and read() decode through the quorum', async () => {
    const f = await three([{ balance: '0x10', callResult: `0x${'00'.repeat(31)}2a` }, { balance: '0x10', callResult: `0x${'00'.repeat(31)}2a` }, { balance: '0x10', callResult: `0x${'00'.repeat(31)}2a` }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    expect(await q.getBalance(TO, 100n)).toBe(16n);
    const v = await q.read({ address: TO, abi: [{ type: 'function', name: 'x', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'x' }, 100n);
    expect(v).toBe(42n);
  });

  test('review I2: one path reporting an ancient block is dropped from the pin (no rollback to old state)', async () => {
    const f = await three([{ block: 1000 }, { block: 1001 }, { block: 1 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    expect(await q.pinBlock()).toBe(1000n);
  });

  test('review I2: when no two paths are within the lag bound → refuse', async () => {
    const f = await three([{ block: 1000 }, { block: 500 }, { block: 1 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    await expect(q.pinBlock()).rejects.toMatchObject({ kind: 'DISAGREE' });
  });

  test('expected chain ID: all agree on the wrong chain → CHAIN_MISMATCH', async () => {
    const f = await three([{ chainId: 1 }, { chainId: 1 }, { chainId: 1 }]);
    const q = createQuorum({ urls: f.map((x) => x.url), expectedChainId: 11155111, ...fast });
    await expect(q.pinBlock()).rejects.toMatchObject({ kind: 'CHAIN_MISMATCH' });
  });

  test('receipt: a path lying about blockNumber → DISAGREE', async () => {
    const r = { status: '0x1', blockNumber: '0x65', blockHash: '0xaa', gasUsed: '0x5208', transactionHash: '0xbb' };
    const f = await three([{ receipt: r }, { receipt: { ...r, blockNumber: '0x10' } }, { receipt: r }]);
    const q = createQuorum({ urls: f.map((x) => x.url), ...fast });
    await expect(q.getReceipt('0xbb')).rejects.toMatchObject({ kind: 'DISAGREE' });
  });
});
