// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Address, ExitPlan, Manifest, Position } from '@copeybara/core';
import type { ExitAdapter } from '@copeybara/adapters';
import type { CopeybaraRecords } from '@copeybara/ens';
import { RecordsError } from '@copeybara/ens';
import type { Quorum } from '@copeybara/quorum';
import type { ExitResult } from '@copeybara/exec';
import { createFlow, type FlowDeps } from '../src/flow';
import { WrongChainError } from '../src/wallet';
import { recordSeenVersion } from '../src/storage';
import { DEFAULT_SETTINGS } from '../src/settings';

const ACC: Address = '0x1111111111111111111111111111111111111111';
const NPM: Address = '0x1238536071E1c677A632429e3655c799b22cDA52';
const manifest: Manifest = { v: 1, chains: { '11155111': { 'uniswap-v3': { positionManager: { address: NPM, selectors: ['0xac9650d8'] } } } } };
const records = (over: Partial<CopeybaraRecords> = {}): CopeybaraRecords => ({
  name: 'demoswap-blackout.eth', url: null, release: { sha256: 'ab'.repeat(32), version: 3 }, manifest, site: null, extension: null, status: { state: 'ok' }, blocklist: [], problems: [], block: 9n,
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
    expect(f.state.get()).toMatchObject({ step: 'error', message: expect.stringMatching(/Switch your wallet to Sepolia \(it is on Ethereum mainnet\)/) });
    expect(adapter.discover).not.toHaveBeenCalled();
  });

  test('malformed manifest → error carries the plain message', async () => {
    const { d } = deps({ readRecords: async () => { throw new RecordsError('org.copeybara.manifest', 'The exit manifest on x.eth is unusable: not valid JSON.'); } });
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

describe('exit flow: live status (usability)', () => {
  test('exit streams runExit progress into state, then clears it when the result lands', async () => {
    const seen: string[] = [];
    let f!: ReturnType<typeof createFlow>;
    const { d } = deps({
      runExit: vi.fn(async (_plan, _sender, ctx) => {
        ctx.onProgress?.({ stage: 'wallet', at: 1, call: 1, calls: 1 });
        const s = f.state.get();
        if (s.step === 'positions') seen.push(s.progress['7']?.stage ?? 'none');
        ctx.onProgress?.({ stage: 'confirming', at: 2, call: 1, calls: 1, txHash: '0xaa' });
        const t = f.state.get();
        if (t.step === 'positions') seen.push(`${t.progress['7']?.stage}:${t.progress['7']?.txHash}`);
        return { positionId: '7', status: 'recovered', reasons: [], txHashes: ['0xaa'], before: {}, after: {}, gasUsed: 1n, deltas: [] } as ExitResult;
      }),
    });
    f = createFlow(d);
    await f.start(settings);
    await f.exit('7');
    expect(seen).toEqual(['wallet', 'confirming:0xaa']);
    const s = f.state.get();
    expect(s.step === 'positions' && s.progress['7']).toBeUndefined();
  });

  test('exitAll exposes "n of total" while it runs and clears it after', async () => {
    const two: Position = { ...pos, id: '9', label: 'Uniswap v3 #9' };
    const batches: string[] = [];
    let f!: ReturnType<typeof createFlow>;
    const { d, adapter } = deps({
      runExit: vi.fn(async (plan) => {
        const s = f.state.get();
        if (s.step === 'positions') batches.push(`${s.batch?.done}/${s.batch?.total}`);
        return { positionId: plan.position.id, status: 'recovered', reasons: [], txHashes: [], before: {}, after: {}, gasUsed: 0n, deltas: [] } as ExitResult;
      }),
    });
    (adapter.discover as ReturnType<typeof vi.fn>).mockResolvedValue([pos, two]);
    f = createFlow(d);
    await f.start(settings);
    await f.exitAll();
    expect(batches).toEqual(['0/2', '1/2']);
    const s = f.state.get();
    expect(s.step === 'positions' && s.batch).toBeNull();
  });

  test('exit asks the wallet to switch back to the position\'s network first', async () => {
    const { d } = deps();
    const f = createFlow(d);
    await f.start(settings);
    (d.wallet.ensureChain as ReturnType<typeof vi.fn>).mockClear();
    await f.exit('7');
    expect(d.wallet.ensureChain).toHaveBeenCalledWith(11155111);
  });

  test('a refused network switch at exit time → a plain result, nothing run', async () => {
    const { d } = deps();
    const f = createFlow(d);
    await f.start(settings);
    (d.wallet.ensureChain as ReturnType<typeof vi.fn>).mockRejectedValue(new WrongChainError(11155111, 1));
    await f.exit('7');
    const s = f.state.get();
    expect(d.runExit).not.toHaveBeenCalled();
    expect(s.step === 'positions' && s.results['7']).toMatchObject({ status: 'unsimulated', reasons: [expect.stringMatching(/Switch your wallet to Sepolia/)] });
  });

  test('fee check: an empty wallet is flagged; a funded one is not', async () => {
    const q = (bal: bigint) => () => ({ pinBlock: async () => 10n, status: () => [], getBalance: async () => bal }) as unknown as Quorum;
    for (const [bal, low] of [[0n, true], [10n ** 18n, false]] as const) {
      const { d } = deps({ quorumFor: q(bal) });
      const f = createFlow(d);
      await f.start(settings);
      expect(f.state.get()).toMatchObject({ step: 'positions', fees: { balance: bal, low } });
    }
  });

  test('wallet errors that are plain objects keep their message', async () => {
    const { d } = deps({
      wallet: {
        connect: async () => { throw { code: 4001, message: 'User rejected the request.' }; },
        ensureChain: async () => {},
        sender: () => ({ sendTransaction: async () => '0xaa' }),
      },
    });
    const f = createFlow(d);
    await f.start(settings);
    expect(f.state.get()).toMatchObject({ step: 'error', message: 'User rejected the request.', stage: 2 });
  });
});

describe('exit flow: add a position by ID (Uniswap v4 NFTs are not enumerable)', () => {
  const v4pos: Position = { adapter: 'uniswap-v4', id: '41', label: 'Uniswap v4 #41', tokens: [], raw: {} };
  const v4manifest: Manifest = { v: 1, chains: { '11155111': { ...manifest.chains['11155111'], 'uniswap-v4': { positionManager: { address: NPM, selectors: ['0xdd46508f'] } } } } };
  const v4adapter = (byId: ExitAdapter['byId']): ExitAdapter => ({
    id: 'uniswap-v4',
    discover: async () => [],
    buildExit: vi.fn(async (p) => ({ position: p, calls: [], expected: [], preview: [{ token: '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA', amount: 7n }] }) as ExitPlan),
    byId,
  });

  test('offered only for adapters with byId that the manifest lists on this chain', async () => {
    const { d, adapter } = deps({ readRecords: vi.fn(async () => records({ manifest: v4manifest })) });
    const f = createFlow({ ...d, adapters: [adapter, v4adapter(async () => v4pos)] });
    await f.start(settings);
    expect(f.state.get()).toMatchObject({ step: 'positions', addable: ['uniswap-v4'] });
    const g = createFlow({ ...d, readRecords: vi.fn(async () => records()), adapters: [adapter, v4adapter(async () => v4pos)] });
    await g.start(settings);
    expect(g.state.get()).toMatchObject({ step: 'positions', addable: [] });
  });

  test('a found position joins the list with its preview; errors come back as plain text; duplicates are refused', async () => {
    const byId = vi.fn(async (id: string) => {
      if (id === '42') throw new Error('Uniswap v4 position #42 is owned by 0x2222…2222, not your wallet.');
      return v4pos;
    });
    const { d, adapter } = deps({ readRecords: vi.fn(async () => records({ manifest: v4manifest })) });
    const f = createFlow({ ...d, adapters: [adapter, v4adapter(byId)] });
    await f.start(settings);
    expect(await f.addById('uniswap-v4', '42')).toMatch(/not your wallet/);
    expect(await f.addById('uniswap-v4', '41')).toBeNull();
    const s = f.state.get();
    expect(s.step === 'positions' && s.positions.map((p) => p.id)).toEqual(['7', '41']);
    expect(s.step === 'positions' && s.previews['41']).toEqual([{ token: '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA', amount: 7n }]);
    expect(await f.addById('uniswap-v4', '41')).toMatch(/already listed/);
    expect(byId).toHaveBeenCalledWith('41', ACC, expect.objectContaining({ account: ACC }));
  });

  test('protocols the manifest lists but this kit does not know are shown as a calm note', async () => {
    const { d } = deps({ readRecords: vi.fn(async () => records({ manifest: { ...manifest, unknown: ['morpho-blue on chain 11155111'] } })) });
    const f = createFlow(d);
    await f.start(settings);
    expect(f.state.get()).toMatchObject({ step: 'positions', notes: [expect.stringMatching(/morpho-blue on chain 11155111.*newer kit/)] });
  });
});

test('review I3: Exit all never re-sends a position whose earlier transaction was already sent', async () => {
  const sent: ExitResult = { positionId: '7', status: 'not-recovered', reasons: ['no confirmed receipt for 0xaa yet'], txHashes: ['0xaa'], before: {}, after: {}, gasUsed: 0n, deltas: [] };
  const { d } = deps({ runExit: vi.fn(async () => sent) });
  const f = createFlow(d);
  await f.start(settings);
  await f.exit('7');
  await f.exitAll();
  expect(d.runExit).toHaveBeenCalledTimes(1);
});

