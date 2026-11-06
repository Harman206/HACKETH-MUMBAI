import { describe, expect, test, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { createTheater, type TheaterDeps } from '../services/theater';
import type { DrainRecord } from '../services/drainer-bot';

const V1: Address = '0x1111111111111111111111111111111111111111';
const drain: DrainRecord = { victim: V1, token: '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA', amount: 10_000n, approveTx: '0xaa', drainTx: '0xd1', at: 1 };

function deps(over: Partial<TheaterDeps> = {}) {
  let drains: DrainRecord[] = [];
  let sw = { site: 'up' as 'up' | 'down', rpc: 'up' as 'up' | 'down', hijack: false };
  let rescue: unknown = null;
  const d: TheaterDeps = {
    network: 'sepolia',
    prepareVictim: vi.fn(async () => ['0x01', '0x02', '0x03'] as Hex[]),
    readVictim: vi.fn(async () => ({ dusd: '10000', positions: ['234200'] })),
    verifyKits: vi.fn(async () => ({ real: 'MATCH v=3 abc', tampered: 'MISMATCH expected abc got def' })),
    drains: () => drains,
    switches: () => sw,
    rescue: () => rescue,
    ...over,
  };
  return { d, setDrains: (x: DrainRecord[]) => (drains = x), setSw: (x: typeof sw) => (sw = x), setRescue: (x: unknown) => (rescue = x) };
}

describe('theater', () => {
  test('prepare is idempotent per victim', async () => {
    const { d } = deps();
    const t = createTheater(d);
    expect(await t.prepare(V1)).toEqual({ txs: ['0x01', '0x02', '0x03'] });
    expect(await t.prepare(V1)).toEqual({ txs: ['0x01', '0x02', '0x03'] });
    expect(d.prepareVictim).toHaveBeenCalledTimes(1);
  });

  test('a 4th victim is refused: demo cap reached', async () => {
    const t = createTheater(deps().d);
    for (const v of ['0x01', '0x02', '0x03']) await t.prepare(v.padEnd(42, '0') as Address);
    await expect(t.prepare('0x0400000000000000000000000000000000000000')).rejects.toThrow(/demo cap reached/);
  });

  test('rejects a non-address victim', async () => {
    await expect(createTheater(deps().d).prepare('nope' as Address)).rejects.toThrow(/address/);
  });

  test('chapters: 1 → 2 (drained) → 3 (site+rpc down) → 4 (rescue recovered)', async () => {
    const w = deps();
    const t = createTheater(w.d);
    await t.prepare(V1);
    expect((await t.state()).chapter).toBe(1);
    w.setDrains([drain]);
    expect((await t.state()).chapter).toBe(2);
    w.setSw({ site: 'down', rpc: 'down', hijack: true });
    expect((await t.state()).chapter).toBe(3);
    w.setRescue({ results: [{ status: 'recovered' }] });
    const s = await t.state();
    expect(s.chapter).toBe(4);
    expect(s.victim).toBe(V1);
    expect(s.victimDusd).toBe('10000');
    expect(s.drains).toEqual([{ ...drain, amount: '10000' }]);
  });

  test('out of order: a rescue posted before any drain does not jump to chapter 4', async () => {
    const w = deps();
    w.setRescue({ results: [{ status: 'recovered' }] });
    w.setSw({ site: 'down', rpc: 'down', hijack: true });
    expect((await createTheater(w.d).state()).chapter).toBe(1);
  });

  test('verify returns both verifier outputs', async () => {
    const t = createTheater(deps().d);
    expect(await t.verify()).toEqual({ real: 'MATCH v=3 abc', tampered: 'MISMATCH expected abc got def' });
    expect((await t.state()).verify).toEqual({ real: 'MATCH v=3 abc', tampered: 'MISMATCH expected abc got def' });
  });

  test('local fork network is reported for the LOCAL FORK banner', async () => {
    expect((await createTheater(deps({ network: 'local-fork' }).d).state()).network).toBe('local-fork');
  });
});
