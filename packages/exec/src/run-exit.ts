import { erc20Abi, type Address, type ExitPlan, type Hex, type TxRequest } from '@blackout/core';
import { explain, guard } from '@blackout/guard';
import { CallRevertedError, QuorumError, type Quorum, type Receipt } from '@blackout/quorum';
import type { Ctx } from '@blackout/adapters';

/** The wallet side. The kit wraps EIP-1193 eth_sendTransaction; it never signs typed data. */
export interface Sender {
  sendTransaction(tx: TxRequest): Promise<Hex>;
}

export type ExitStatus = 'recovered' | 'not-recovered' | 'rejected';

export interface ExitResult {
  positionId: string;
  status: ExitStatus;
  reasons: string[];
  txHashes: Hex[];
  before: Record<Address, bigint>;
  after: Record<Address, bigint>;
  gasUsed: bigint;
  /** ms timestamp of the last confirmed receipt, for time-to-exit. */
  confirmedAt?: number;
}

export type RunCtx = Ctx & { pollMs?: number; timeoutMs?: number; now?: () => number; balanceRetries?: number };

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
  const res: ExitResult = { positionId: plan.position.id, status: 'rejected', reasons: [], txHashes: [], before: {}, after: {}, gasUsed: 0n };

  if (plan.calls.length === 0) return { ...res, reasons: [plan.position.manual ?? 'Nothing to send for this position.'] };
  if (tokens.length === 0) return { ...res, reasons: ['The simulation shows nothing to recover from this position.'] };

  // 1. Guard every call
  for (const c of plan.calls) {
    const g = guard(c, { account: ctx.account, chainId: ctx.chainId, manifest: ctx.manifest });
    if (!g.ok) return { ...res, reasons: explain(g) };
  }

  // 2. Simulate through the quorum at a freshly pinned block
  let block: bigint;
  try {
    block = await ctx.q.pinBlock();
    for (const c of plan.calls) await ctx.q.call({ to: c.to, data: c.data, from: c.from }, block);
  } catch (e) {
    if (e instanceof CallRevertedError) return { ...res, reasons: [`Simulation failed: ${e.message}`] };
    if (e instanceof QuorumError) return { ...res, reasons: [e.message] };
    throw e;
  }

  // 3. Balances before
  res.before = await balances(ctx.q, tokens, ctx.account, block);

  // 4–5. Send each call, wait for a quorum-confirmed receipt. From here on, a sent tx is never reported as "blocked".
  let last: Receipt | null = null;
  for (const c of plan.calls) {
    let hash: Hex;
    try {
      hash = await sender.sendTransaction(c);
    } catch (e) {
      return { ...res, status: 'not-recovered', reasons: [walletMessage(e)] };
    }
    res.txHashes.push(hash);
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
  const missing = tokens.filter((t) => !(res.after[t]! > res.before[t]!));
  if (missing.length) {
    return { ...res, status: 'not-recovered', reasons: missing.map((t) => `no balance increase for ${t}`) };
  }
  return { ...res, status: 'recovered' };
}
