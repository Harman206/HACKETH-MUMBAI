import { erc20Abi, type Address, type ExitPlan, type Hex, type TxRequest } from '@copeybara/core';
import { explain, guard } from '@copeybara/guard';
import { CallRevertedError, QuorumError, type Quorum, type Receipt } from '@copeybara/quorum';
import type { Ctx } from '@copeybara/adapters';

/** The wallet side. The kit wraps EIP-1193 eth_sendTransaction; it never signs typed data. */
export interface Sender {
  sendTransaction(tx: TxRequest): Promise<Hex>;
}

/** rejected = the Exit Guard blocked it; unsimulated = nothing sent because the dry run failed or RPCs disagreed. */
export type ExitStatus = 'recovered' | 'not-recovered' | 'rejected' | 'unsimulated';

export interface TokenDelta {
  token: Address;
  before: bigint;
  after: bigint;
  min: bigint;
}

export interface ExitResult {
  positionId: string;
  status: ExitStatus;
  reasons: string[];
  txHashes: Hex[];
  before: Record<Address, bigint>;
  after: Record<Address, bigint>;
  gasUsed: bigint;
  /** Per expected token: balance before/after and the plan's minimum. Empty until balances are read. */
  deltas: TokenDelta[];
  /** ms timestamp of the last confirmed receipt, for time-to-exit. */
  confirmedAt?: number;
}

/** Live stages of one exit, for the UI. The final outcome is the ExitResult, not a stage. */
export type ExitStage = 'checking' | 'simulating' | 'wallet' | 'confirming' | 'balances';

export interface ExitProgress {
  stage: ExitStage;
  /** ms timestamp the stage began. */
  at: number;
  /** 1-based index of the call being sent, and how many calls the plan has. */
  call: number;
  calls: number;
  /** Set once the wallet returned a hash (stage 'confirming'). */
  txHash?: Hex;
}

export type RunCtx = Ctx & { pollMs?: number; timeoutMs?: number; now?: () => number; balanceRetries?: number; onProgress?: (p: ExitProgress) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function balances(q: Quorum, tokens: Address[], account: Address, block: bigint) {
  const out: Record<Address, bigint> = {};
  for (const t of tokens) out[t] = await q.read({ address: t, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, block);
  return out;
}

async function waitReceipt(q: Quorum, hash: Hex, pollMs: number, timeoutMs: number, now: () => number): Promise<Receipt | null> {
  const end = now() + timeoutMs;
  while (now() <= end) {
    const r = await q.getReceipt(hash).catch((e) => {
      if (e instanceof QuorumError && e.kind === 'DISAGREE') throw e;
      return null;
    });
    if (r) return r;
    await sleep(pollMs);
  }
  return null;
}

function walletMessage(e: unknown): string {
  const err = e as { code?: number; message?: string };
  if (err?.code === 4001 || /reject|denied/i.test(err?.message ?? '')) return 'You rejected the transaction in your wallet.';
  return `The wallet could not send the transaction: ${err?.message ?? String(e)}`;
}

/**
 * Guard → simulate (quorum, pinned block) → balances before → send → receipt (quorum) → balances after.
 * "recovered" only with status 1 and a positive delta for every expected token.
 */
export async function runExit(plan: ExitPlan, sender: Sender, ctx: RunCtx): Promise<ExitResult> {
  const now = ctx.now ?? Date.now;
  const tokens = plan.expected.map((e) => e.token);
  const res: ExitResult = { positionId: plan.position.id, status: 'rejected', reasons: [], txHashes: [], before: {}, after: {}, gasUsed: 0n, deltas: [] };

  if (plan.calls.length === 0) return { ...res, reasons: [plan.position.manual ?? 'Nothing to send for this position.'] };
  if (tokens.length === 0) return { ...res, reasons: ['The simulation shows nothing to recover from this position.'] };

  const calls = plan.calls.length;
  const progress = (stage: ExitStage, call = 1, txHash?: Hex) => {
    try {
      ctx.onProgress?.({ stage, at: now(), call, calls, ...(txHash ? { txHash } : {}) });
    } catch {
      // a UI listener must never change the outcome of an exit
    }
  };

  // 1. Guard every call
  progress('checking');
  for (const c of plan.calls) {
    const g = guard(c, { account: ctx.account, chainId: ctx.chainId, manifest: ctx.manifest });
    if (!g.ok) return { ...res, reasons: explain(g) };
  }

  // 2. Simulate through the quorum at a freshly pinned block
  let block: bigint;
  progress('simulating');
  try {
    block = await ctx.q.pinBlock();
    for (const c of plan.calls) await ctx.q.call({ to: c.to, data: c.data, from: c.from }, block);
  } catch (e) {
    if (e instanceof CallRevertedError) return { ...res, status: 'unsimulated', reasons: [`Simulation failed: ${e.message}`] };
    if (e instanceof QuorumError) return { ...res, status: 'unsimulated', reasons: [e.message] };
    throw e;
  }

  // 3. Balances before
  res.before = await balances(ctx.q, tokens, ctx.account, block);

  // 4–5. Send each call, wait for a quorum-confirmed receipt. From here on, a sent tx is never reported as "blocked".
  let last: Receipt | null = null;
  for (const [i, c] of plan.calls.entries()) {
    let hash: Hex;
    progress('wallet', i + 1);
    try {
      hash = await sender.sendTransaction(c);
    } catch (e) {
      return { ...res, status: 'not-recovered', reasons: [walletMessage(e)] };
    }
    res.txHashes.push(hash);
    progress('confirming', i + 1, hash);
    let r: Receipt | null;
    try {
      r = await waitReceipt(ctx.q, hash, ctx.pollMs ?? 2000, ctx.timeoutMs ?? 120_000, now);
    } catch (e) {
      return { ...res, status: 'not-recovered', reasons: [`${(e as Error).message} Check ${hash} in your wallet or an explorer.`] };
    }
    if (!r) return { ...res, status: 'not-recovered', reasons: [`no confirmed receipt for ${hash} yet; check it in your wallet before retrying`] };
    res.gasUsed += r.gasUsed;
    if (r.status !== 'success') return { ...res, status: 'not-recovered', reasons: ['transaction reverted'] };
    last = r;
  }
  res.confirmedAt = now();
  progress('balances', calls);

  // 6–7. Balances after, at the receipt block. Lagging paths may not have that block yet: retry a few times.
  const attempts = ctx.balanceRetries ?? 5;
  for (let i = 0; ; i++) {
    try {
      res.after = await balances(ctx.q, tokens, ctx.account, last!.blockNumber);
      break;
    } catch (e) {
      if (i + 1 >= attempts) {
        return { ...res, status: 'not-recovered', reasons: [`The transaction confirmed, but the kit could not confirm balances: ${(e as Error).message}`] };
      }
      await sleep(ctx.pollMs ?? 2000);
    }
  }
  res.deltas = plan.expected.map((e) => ({ token: e.token, before: res.before[e.token]!, after: res.after[e.token]!, min: e.min }));
  const missing = tokens.filter((t) => !(res.after[t]! > res.before[t]!));
  if (missing.length) {
    return { ...res, status: 'not-recovered', reasons: missing.map((t) => `no balance increase for ${t}`) };
  }
  const short = res.deltas.filter((d) => d.after - d.before < d.min);
  if (short.length) {
    return { ...res, status: 'not-recovered', reasons: short.map((d) => `received less than the minimum for ${d.token} (${d.after - d.before} < ${d.min})`) };
  }
  return { ...res, status: 'recovered' };
}
