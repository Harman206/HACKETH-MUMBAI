import type { Address, AdapterId, Position } from '@copeybara/core';
import type { Ctx, ExitAdapter } from '@copeybara/adapters';
import { normaliseName, readCopeybaraRecords, type CopeybaraRecords } from '@copeybara/ens';
import { buildReport, tallyVerdicts, runExit as defaultRunExit, type ExitProgress, type ExitReport, type ExitResult, type Sender } from '@copeybara/exec';
import type { Quorum } from '@copeybara/quorum';
import type { Settings } from './settings';
import { maxSeenVersion, recordSeenVersion } from './storage';
import { store, type Store } from './store';
import { COPY } from './copy';
import { tokenMeta, type TokenMeta } from './tokens';

export type FlowState =
  | { step: 'setup' }
  | { step: 'loading'; what: string; stage: 1 | 2 | 3; /** The wallet already had a connect request open: the kit is waiting for the user to approve it there. */ pending?: boolean }
  | {
      step: 'positions';
      records: CopeybaraRecords;
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
      /** Simulated payout per position id (display), and token symbols/decimals. */
      previews: Record<string, { token: Address; amount: bigint }[]>;
      meta: TokenMeta;
      /** Live stage of the exit in flight, by position id. Cleared when its result lands. */
      progress: Record<string, ExitProgress>;
      /** "Exit all" counter while it runs. */
      batch: { done: number; total: number } | null;
      /** The wallet's native balance for network fees, when the RPCs could read it. */
      fees: { balance: bigint; low: boolean } | null;
      /** Adapters that can add a position by ID (listed on this chain and not fully discoverable). */
      addable: AdapterId[];
      /** Calm, non-blocking notes (e.g. manifest protocols this kit version does not know). */
      notes: string[];
    }
  | { step: 'error'; message: string; stage?: 1 | 2 | 3 };

/** Below this (0.001 ETH) an exit may not be able to pay its network fee. */
export const LOW_FEE_BALANCE = 10n ** 15n;

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
    connect(opts?: { onPending(): void; signal: AbortSignal }): Promise<{ account: Address; chainId: number }>;
    ensureChain(chainId: number): Promise<void>;
    sender(account: Address): Sender;
  };
  now(): number;
  readRecords?: typeof readCopeybaraRecords;
  runExit?: typeof defaultRunExit;
  /** Drill mode only: failure timestamps from the Fire Drill control page. */
  drillFailures?: () => Promise<{ kind: string; at: number }[]>;
  /** Drill mode only: receives the report after every exit (posted to the control page). */
  onReport?: (r: ExitReport) => void;
}

export interface Flow {
  state: Store<FlowState>;
  start(s: Settings): Promise<void>;
  /** Stop waiting for the wallet (while connecting) and go back to the form. */
  cancel(): void;
  exit(id: string): Promise<void>;
  exitAll(): Promise<void>;
  /** Add a position the scan could not find. Resolves to null on success, or a plain error message. */
  addById(adapter: AdapterId, id: string): Promise<string | null>;
  report(): ExitReport;
}

/** Wallets often throw plain objects ({ code, message }), not Errors. */
const message = (e: unknown) =>
  e instanceof Error ? e.message : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : String(e);

export function createFlow(deps: FlowDeps): Flow {
  const state = store<FlowState>({ step: 'setup' });
  const readRecords = deps.readRecords ?? readCopeybaraRecords;
  const run = deps.runExit ?? defaultRunExit;
  let ctx: Ctx | null = null;
  let startedAt = 0;
  let failures: { kind: string; at: number }[] = [];

  let stage: 1 | 2 | 3 = 1;
  let connecting: AbortController | null = null;
  const fail = (m: string) => state.set({ step: 'error', message: m, stage });

  function cancel() {
    if (!connecting) return;
    connecting.abort();
    connecting = null;
    state.set({ step: 'setup' });
  }

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
    let records: CopeybaraRecords;
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
    const ac = new AbortController();
    connecting = ac;
    try {
      const w = await deps.wallet.connect({
        signal: ac.signal,
        onPending: () => {
          if (!ac.signal.aborted) state.set({ step: 'loading', what: COPY.connectPending, stage, pending: true });
        },
      });
      if (ac.signal.aborted) return;
      account = w.account;
      if (w.chainId !== s.targetChainId) await deps.wallet.ensureChain(s.targetChainId);
    } catch (e) {
      if (ac.signal.aborted) return; // cancelled: the form is already back
      return fail(message(e));
    } finally {
      if (connecting === ac) connecting = null;
    }

    stage = 3;
    state.set({ step: 'loading', what: COPY.findingPositions, stage });
    try {
      const q = deps.quorumFor(s.targetChainId);
      ctx = {
        q,
        chainId: s.targetChainId,
        manifest: records.manifest,
        exitSpec: records.exitSpec ?? null,
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
      const previews: Record<string, { token: Address; amount: bigint }[]> = {};
      await Promise.all(
        positions
          .filter((p) => !p.manual)
          .map(async (p) => {
            const a = deps.adapters.find((x) => x.id === p.adapter)!;
            previews[p.id] = (await a.buildExit(p, ctx!).catch(() => null))?.preview ?? [];
          }),
      );
      const meta = typeof q.read === 'function' ? await tokenMeta(q, positions.flatMap((p) => p.tokens), ctx.block).catch(() => ({})) : {};
      const balance = typeof q.getBalance === 'function' ? await q.getBalance(account, ctx.block).catch(() => null) : null;
      const fees = balance === null ? null : { balance, low: balance < LOW_FEE_BALANCE };
      const listed = records.manifest.chains[String(s.targetChainId)] ?? {};
      const addable = deps.adapters.filter((a) => a.byId && listed[a.id]).map((a) => a.id);
      const notes = (records.manifest.unknown ?? []).map((u) => `The protocol also lists exits for ${u}, which this kit version does not support. A newer kit release may.`);
      state.set({ step: 'positions', records, rollbackWarning, account, chainId: s.targetChainId, positions, results: {}, busy: null, discoveryErrors, facts, previews, meta, progress: {}, batch: null, fees, addable, notes });
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
    const onProgress = (p: ExitProgress) => {
      const cur = state.get();
      if (cur.step === 'positions') state.set({ ...cur, progress: { ...cur.progress, [id]: p } });
    };
    let result: ExitResult;
    try {
      // The user may have switched networks in the wallet since connecting.
      await deps.wallet.ensureChain(s.chainId);
      const fresh = { ...ctx, block: await ctx.q.pinBlock() };
      const plan = await adapter.buildExit(pos, fresh);
      result = await run(plan, deps.wallet.sender(s.account), { ...fresh, onProgress });
    } catch (e) {
      result = { positionId: id, status: 'unsimulated', reasons: [message(e)], txHashes: [], before: {}, after: {}, gasUsed: 0n, deltas: [] };
    }
    if (deps.drillFailures) failures = await deps.drillFailures().catch(() => failures);
    const cur = state.get();
    if (cur.step === 'positions') {
      const { [id]: _done, ...progress } = cur.progress;
      state.set({ ...cur, busy: null, progress, results: { ...cur.results, [id]: result } });
    }
    if (deps.onReport) deps.onReport(report());
  }

  async function exitAll() {
    const s = state.get();
    if (s.step !== 'positions' || s.busy) return;
    // Skip anything recovered, and anything whose transaction was already sent: re-sending would ask the wallet
    // again for a tx that may still be pending. The user follows the explorer link instead.
    const todo = s.positions.filter((p) => !p.manual && s.results[p.id]?.status !== 'recovered' && !(s.results[p.id]?.txHashes.length));
    const setBatch = (batch: { done: number; total: number } | null) => {
      const cur = state.get();
      if (cur.step === 'positions') state.set({ ...cur, batch });
    };
    for (const [i, p] of todo.entries()) {
      setBatch({ done: i, total: todo.length });
      await exit(p.id);
    }
    setBatch(null);
  }

  async function addById(adapterId: AdapterId, id: string): Promise<string | null> {
    const s = state.get();
    if (s.step !== 'positions' || !ctx) return 'Find your positions first.';
    const adapter = deps.adapters.find((a) => a.id === adapterId);
    if (!adapter?.byId || !s.addable.includes(adapterId)) return 'This protocol does not support adding a position by ID.';
    try {
      const fresh = { ...ctx, block: await ctx.q.pinBlock() };
      const p = await adapter.byId(id, s.account, fresh);
      const cur0 = state.get();
      if (cur0.step === 'positions' && cur0.positions.some((x) => x.adapter === p.adapter && x.id === p.id)) return `${p.label} is already listed.`;
      const preview = p.manual ? [] : ((await adapter.buildExit(p, fresh).catch(() => null))?.preview ?? []);
      const extra = typeof fresh.q.read === 'function' ? await tokenMeta(fresh.q, p.tokens, fresh.block).catch(() => ({})) : {};
      const cur = state.get();
      if (cur.step !== 'positions') return null;
      // Keep the "N more not found" row last.
      const rest = cur.positions.filter((x) => !x.manual || x.raw !== null);
      const tail = cur.positions.filter((x) => x.manual && x.raw === null);
      state.set({ ...cur, positions: [...rest, p, ...tail], previews: { ...cur.previews, [p.id]: preview }, meta: { ...cur.meta, ...extra } });
      return null;
    } catch (e) {
      return message(e);
    }
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

  return { state, start, cancel, exit, exitAll, addById, report };
}
