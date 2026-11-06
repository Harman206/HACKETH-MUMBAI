import type { Address, Position } from '@blackout/core';
import type { Ctx, ExitAdapter } from '@blackout/adapters';
import { normaliseName, readBlackoutRecords, type BlackoutRecords } from '@blackout/ens';
import { buildReport, tallyVerdicts, runExit as defaultRunExit, type ExitReport, type ExitResult, type Sender } from '@blackout/exec';
import type { Quorum } from '@blackout/quorum';
import type { Settings } from './settings';
import { maxSeenVersion, recordSeenVersion } from './storage';
import { store, type Store } from './store';
import { COPY } from './copy';

export type FlowState =
  | { step: 'setup' }
  | { step: 'loading'; what: string; stage: 1 | 2 | 3 }
  | {
      step: 'positions';
      records: BlackoutRecords;
      rollbackWarning: boolean;
      account: Address;
      chainId: number;
      positions: Position[];
      results: Record<string, ExitResult>;
      busy: string | null;
      /** Adapters whose discovery failed; their positions are unknown, the others stay exitable. */
      discoveryErrors: string[];
      /** Plain-language facts the UI shows under "What's happening". */
      facts: { label: string; value: string }[];
    }
  | { step: 'error'; message: string; stage?: 1 | 2 | 3 };

/** Stepper position: 1 Verify, 2 Connect, 3 Positions, 4 Exit. */
export function stepOf(s: FlowState): 1 | 2 | 3 | 4 {
  switch (s.step) {
    case 'setup':
      return 1;
    case 'loading':
      return s.stage;
    case 'error':
      return s.stage ?? 1;
    case 'positions':
      return Object.keys(s.results).length > 0 ? 4 : 3;
  }
}

export interface FlowDeps {
  quorumFor(chainId: number): Quorum;
  ens: { chainId: number; universalResolver: Address };
  adapters: ExitAdapter[];
  wallet: {
    connect(): Promise<{ account: Address; chainId: number }>;
    ensureChain(chainId: number): Promise<void>;
    sender(account: Address): Sender;
  };
  now(): number;
  readRecords?: typeof readBlackoutRecords;
  runExit?: typeof defaultRunExit;
  /** Drill mode only: failure timestamps from the Fire Drill control page. */
  drillFailures?: () => Promise<{ kind: string; at: number }[]>;
  /** Drill mode only: receives the report after every exit (posted to the control page). */
  onReport?: (r: ExitReport) => void;
}

export interface Flow {
  state: Store<FlowState>;
  start(s: Settings): Promise<void>;
  exit(id: string): Promise<void>;
  exitAll(): Promise<void>;
  report(): ExitReport;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createFlow(deps: FlowDeps): Flow {
  const state = store<FlowState>({ step: 'setup' });
  const readRecords = deps.readRecords ?? readBlackoutRecords;
  const run = deps.runExit ?? defaultRunExit;
  let ctx: Ctx | null = null;
  let startedAt = 0;
  let failures: { kind: string; at: number }[] = [];

  let stage: 1 | 2 | 3 = 1;
  const fail = (m: string) => state.set({ step: 'error', message: m, stage });

  async function start(s: Settings) {
    startedAt = deps.now();
    if (!s.ensName.trim()) return fail(COPY.needName);
    let name: string;
    try {
      name = normaliseName(s.ensName);
    } catch (e) {
      return fail(message(e));
    }

    stage = 1;
    state.set({ step: 'loading', what: COPY.loadingRecords(name), stage });
    const ensQ = deps.quorumFor(deps.ens.chainId);
    let records: BlackoutRecords;
    try {
      records = await readRecords(name, ensQ, { universalResolver: deps.ens.universalResolver });
    } catch (e) {
      return fail(message(e));
    }
    const rollbackWarning = maxSeenVersion(name) > records.release.version;
    recordSeenVersion(name, records.release.version);

    if (!records.manifest.chains[String(s.targetChainId)]) return fail(COPY.noExitsOnChain(s.targetChainId));

    stage = 2;
    state.set({ step: 'loading', what: COPY.connecting, stage });
    let account: Address;
    try {
      const w = await deps.wallet.connect();
      account = w.account;
      if (w.chainId !== s.targetChainId) await deps.wallet.ensureChain(s.targetChainId);
    } catch (e) {
      return fail(message(e));
    }

    stage = 3;
    state.set({ step: 'loading', what: COPY.findingPositions, stage });
    try {
      const q = deps.quorumFor(s.targetChainId);
      ctx = {
        q,
        chainId: s.targetChainId,
        manifest: records.manifest,
        block: await q.pinBlock(),
        account,
        slippageBps: s.slippageBps,
        nowSec: () => Math.floor(deps.now() / 1000),
      };
      const settled = await Promise.allSettled(deps.adapters.map((a) => a.discover(account, ctx!)));
      const positions = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const discoveryErrors = settled.flatMap((r, i) => (r.status === 'rejected' ? [`Could not check ${deps.adapters[i]!.id}: ${message(r.reason)}`] : []));
      if (discoveryErrors.length === deps.adapters.length && deps.adapters.length > 0) return fail(discoveryErrors.join(' '));
      const st = typeof ensQ.status === 'function' ? ensQ.status() : [];
      const facts = [
        { label: 'Release', value: `v${records.release.version}` },
        { label: 'Kit fingerprint (sha256)', value: records.release.sha256 },
        { label: 'Read from ENS at block', value: records.block.toString() },
        { label: 'RPC providers in agreement', value: `${st.filter((p) => p.up).length} of ${st.length}` },
        { label: 'Exit contracts published for this network', value: String(Object.values(records.manifest.chains[String(s.targetChainId)] ?? {}).reduce((n, roles) => n + Object.keys(roles ?? {}).length, 0)) },
      ];
      state.set({ step: 'positions', records, rollbackWarning, account, chainId: s.targetChainId, positions, results: {}, busy: null, discoveryErrors, facts });
    } catch (e) {
      return fail(message(e));
    }
  }

  async function exit(id: string) {
    const s = state.get();
    if (s.step !== 'positions' || !ctx || s.busy) return;
    const pos = s.positions.find((p) => p.id === id);
    if (!pos || pos.manual) return;
    const adapter = deps.adapters.find((a) => a.id === pos.adapter)!;
    state.set({ ...s, busy: id });
    let result: ExitResult;
    try {
      const fresh = { ...ctx, block: await ctx.q.pinBlock() };
      const plan = await adapter.buildExit(pos, fresh);
      result = await run(plan, deps.wallet.sender(s.account), fresh);
    } catch (e) {
      result = { positionId: id, status: 'unsimulated', reasons: [message(e)], txHashes: [], before: {}, after: {}, gasUsed: 0n, deltas: [] };
    }
    if (deps.drillFailures) failures = await deps.drillFailures().catch(() => failures);
    const cur = state.get();
    if (cur.step === 'positions') state.set({ ...cur, busy: null, results: { ...cur.results, [id]: result } });
    if (deps.onReport) deps.onReport(report());
  }

  async function exitAll() {
    const s = state.get();
    if (s.step !== 'positions') return;
    for (const p of s.positions) if (!p.manual) await exit(p.id);
  }

  function report(): ExitReport {
    const s = state.get();
    if (s.step !== 'positions') throw new Error('No exits yet.');
    const results = Object.values(s.results);
    const confirmed = results.map((r) => r.confirmedAt).filter((x): x is number => typeof x === 'number');
    const firstFailureAt = failures.length ? Math.min(...failures.map((f) => f.at)) : undefined;
    return buildReport({
      kit: { version: s.records.release.version, sha256: s.records.release.sha256 },
      ensName: s.records.name,
      startedAt,
      failures,
      results,
      guardVerdicts: tallyVerdicts(results),
      firstFailureAt,
      lastReceiptAt: confirmed.length ? Math.max(...confirmed) : undefined,
    });
  }

  return { state, start, exit, exitAll, report };
}
