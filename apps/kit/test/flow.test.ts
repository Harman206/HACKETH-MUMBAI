// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Address, ExitPlan, Manifest, Position } from '@blackout/core';
import type { ExitAdapter } from '@blackout/adapters';
import type { BlackoutRecords } from '@blackout/ens';
import { RecordsError } from '@blackout/ens';
import type { Quorum } from '@blackout/quorum';
import type { ExitResult } from '@blackout/exec';
import { createFlow, type FlowDeps } from '../src/flow';
import { WrongChainError } from '../src/wallet';
import { recordSeenVersion } from '../src/storage';
import { DEFAULT_SETTINGS } from '../src/settings';

const ACC: Address = '0x1111111111111111111111111111111111111111';
const NPM: Address = '0x1238536071E1c677A632429e3655c799b22cDA52';
const manifest: Manifest = { v: 1, chains: { '11155111': { 'uniswap-v3': { positionManager: { address: NPM, selectors: ['0xac9650d8'] } } } } };
const records = (over: Partial<BlackoutRecords> = {}): BlackoutRecords => ({
  name: 'demoswap-blackout.eth', url: null, release: { sha256: 'ab'.repeat(32), version: 3 }, manifest, site: null, block: 9n,
  resolver: '0x2222222222222222222222222222222222222222', ...over,
});
const pos: Position = { adapter: 'uniswap-v3', id: '7', label: 'Uniswap v3 #7', tokens: [], raw: {} };

function deps(over: Partial<FlowDeps> = {}) {
  const adapter: ExitAdapter = {
    id: 'uniswap-v3',
    discover: vi.fn(async () => [pos]),
    buildExit: vi.fn(async (p) => ({ position: p, calls: [], expected: [], preview: [{ token: '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA', amount: 5n * 10n ** 18n }] }) as ExitPlan),
  };
  const result: ExitResult = { positionId: '7', status: 'recovered', reasons: [], txHashes: ['0xaa'], before: {}, after: {}, gasUsed: 1n, confirmedAt: 5_000, deltas: [] };
  const d: FlowDeps = {
    quorumFor: () => ({ pinBlock: async () => 10n, status: () => [{ url: 'a', up: true }, { url: 'b', up: true }, { url: 'c', up: false }] }) as unknown as Quorum,
    ens: { chainId: 11155111, universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' },
    adapters: [adapter],
    readRecords: vi.fn(async () => records()),
    wallet: {
      connect: vi.fn(async () => ({ account: ACC, chainId: 11155111 })),
      ensureChain: vi.fn(async () => {}),
      sender: () => ({ sendTransaction: async () => '0xaa' }),
    },
    runExit: vi.fn(async () => result),
    now: () => 1_000,
    ...over,
  };
  return { d, adapter };
}

const settings = { ...DEFAULT_SETTINGS, ensName: 'demoswap-blackout.eth' };
beforeEach(() => localStorage.clear());

describe('exit flow', () => {
  test('happy path: records → positions → exit → report', async () => {
    const { d } = deps();
    const f = createFlow(d);
    await f.start(settings);
    const s = f.state.get();
    expect(s.step).toBe('positions');
    if (s.step !== 'positions') return;
    expect(s.positions).toEqual([pos]);
    expect(s.previews['7']).toEqual([{ token: '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA', amount: 5n * 10n ** 18n }]);
    expect(s.rollbackWarning).toBe(false);
    const facts = Object.fromEntries(s.facts.map((x) => [x.label, x.value]));
    expect(facts['Release']).toBe('v3');
    expect(facts['Kit fingerprint (sha256)']).toBe('ab'.repeat(32));
    expect(facts['Read from ENS at block']).toBe('9');
    expect(facts['RPC providers in agreement']).toMatch(/^\d+ of \d+$/);
    await f.exit('7');
    const after = f.state.get();
    expect(after.step === 'positions' && after.results['7']?.status).toBe('recovered');
    const report = f.report();
    expect(report.ensName).toBe('demoswap-blackout.eth');
    expect(report.kit).toEqual({ version: 3, sha256: 'ab'.repeat(32) });
    expect(report.guardVerdicts).toEqual({ accepted: 1, rejected: 0, unsimulated: 0, reasons: [] });
  });

  test('empty ENS name → error, nothing read', async () => {
    const { d } = deps();
    const f = createFlow(d);
    await f.start({ ...settings, ensName: '' });
    expect(f.state.get()).toMatchObject({ step: 'error', message: expect.stringMatching(/protocol's docs/) });
    expect(d.readRecords).not.toHaveBeenCalled();
  });

  test('wrong-chain wallet → error, adapters never called', async () => {
    const { d, adapter } = deps({
      wallet: {
        connect: async () => ({ account: ACC, chainId: 1 }),
        ensureChain: async () => { throw new WrongChainError(11155111, 1); },
        sender: () => ({ sendTransaction: async () => '0xaa' }),
      },
    });
    const f = createFlow(d);
    await f.start(settings);
    expect(f.state.get()).toMatchObject({ step: 'error', message: expect.stringMatching(/Switch your wallet to chain 11155111/) });
    expect(adapter.discover).not.toHaveBeenCalled();
  });

  test('malformed manifest → error carries the plain message', async () => {
    const { d } = deps({ readRecords: async () => { throw new RecordsError('org.blackout.manifest', 'The exit manifest on x.eth is unusable: not valid JSON.'); } });
    const f = createFlow(d);
    await f.start(settings);
    expect(f.state.get()).toMatchObject({ step: 'error', message: expect.stringMatching(/unusable: not valid JSON/) });
  });

  test('target chain missing from the manifest → error', async () => {
    const { d, adapter } = deps();
    const f = createFlow(d);
    await f.start({ ...settings, targetChainId: 10 });
    expect(f.state.get()).toMatchObject({ step: 'error', message: 'This protocol has no exits listed for chain 10.' });
    expect(adapter.discover).not.toHaveBeenCalled();
  });

  test('release older than one seen before → rollback warning', async () => {
    recordSeenVersion('demoswap-blackout.eth', 5);
    const { d } = deps();
    const f = createFlow(d);
    await f.start(settings);
    expect(f.state.get()).toMatchObject({ step: 'positions', rollbackWarning: true });
  });

  test('exitAll runs every non-manual position once, in order', async () => {
    const manual: Position = { ...pos, id: '8', manual: 'Has debt' };
    const { d, adapter } = deps();
    (adapter.discover as ReturnType<typeof vi.fn>).mockResolvedValue([pos, manual]);
    const f = createFlow(d);
    await f.start(settings);
    await f.exitAll();
    expect(d.runExit).toHaveBeenCalledTimes(1);
  });

  test('time to exit uses drill failure timestamps when present', async () => {
    const { d } = deps({ drillFailures: async () => [{ kind: 'site-down', at: 1_000 }] });
    const f = createFlow(d);
    await f.start(settings);
    await f.exit('7');
    expect(f.report().timeToExitSec).toBe(4);
  });

  test('drill mode: the report is handed to onReport after every exit', async () => {
    const onReport = vi.fn();
    const { d } = deps({ onReport, drillFailures: async () => [{ kind: 'rpc-down', at: 2_000 }] });
    const f = createFlow(d);
    await f.start(settings);
    await f.exit('7');
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport.mock.calls[0]![0].failures).toEqual([{ kind: 'rpc-down', at: 2_000 }]);
  });

  test('review I5: one adapter failing discovery does not hide the others', async () => {
    const broken: ExitAdapter = { id: 'aave-v3', discover: async () => { throw new Error('Only 1 of 3 RPC paths answered eth_call; need 2.'); }, buildExit: vi.fn() };
    const { d, adapter } = deps();
    const f = createFlow({ ...d, adapters: [adapter, broken] });
    await f.start(settings);
    const s = f.state.get();
    expect(s.step).toBe('positions');
    if (s.step !== 'positions') return;
    expect(s.positions).toEqual([pos]);
    expect(s.discoveryErrors).toEqual([expect.stringMatching(/aave-v3.*Only 1 of 3/)]);
  });
});
