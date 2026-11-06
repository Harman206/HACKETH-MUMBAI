import { BANNED_SELECTORS, type AdapterId, type Address, type ExitSpec, type Hex, type Manifest, type TargetEntry, type TxRequest } from '@copeybara/core';
import { decodeCall, DecodeError, decodeSpecCall, type Decoded } from './decode';

export interface GuardCtx {
  account: Address;
  chainId: number;
  manifest: Manifest;
  /** org.copeybara.exits, as checked against the manifest by readCopeybaraRecords. */
  exitSpec?: ExitSpec | null;
}

export type GuardCode = 'CHAIN' | 'TARGET' | 'SELECTOR' | 'BANNED' | 'RECIPIENT' | 'CALLER' | 'VALUE' | 'DECODE';

export interface GuardReason {
  code: GuardCode;
  detail: string;
  /** Address the reason is about (spender, recipient, target), for explanations. */
  subject?: Address;
}

export interface GuardResult {
  ok: boolean;
  reasons: GuardReason[];
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function flatten(d: Decoded): Decoded[] {
  return [d, ...d.nested.flatMap(flatten)];
}

interface Target {
  entry: TargetEntry;
  adapter: AdapterId;
  role: string;
}

function findTarget(m: Manifest, chainId: number, to: Address): Target | undefined {
  const cm = m.chains[String(chainId)];
  if (!cm) return undefined;
  for (const [adapter, targets] of Object.entries(cm)) {
    for (const [role, t] of Object.entries(targets ?? {})) {
      if (eq(t.address, to) && t.selectors.length > 0) return { entry: t, adapter: adapter as AdapterId, role };
    }
  }
  return undefined;
}

/**
 * Static policy check. Rejects anything that is not a known exit paying the connected account.
 * Fails closed on anything it cannot decode. Simulation and receipt checks live in @copeybara/exec.
 * A contract listed under `spec` is decoded only with its own exit kind from org.copeybara.exits; without that kind
 * nothing sent to it can pass.
 */
export function guard(tx: TxRequest, ctx: GuardCtx): GuardResult {
  const reasons: GuardReason[] = [];
  const found = findTarget(ctx.manifest, tx.chainId, tx.to);

  let decoded: Decoded;
  try {
    if (found?.adapter === 'spec') {
      const kind = ctx.exitSpec?.kinds[found.role];
      if (!kind) throw new DecodeError(`no published exit description (org.copeybara.exits) for ${found.role}`);
      decoded = decodeSpecCall(tx.data, kind);
    } else decoded = decodeCall(tx.data);
  } catch (e) {
    const detail = e instanceof DecodeError ? e.message : 'calldata could not be decoded';
    const extra: GuardReason[] = tx.value !== 0n ? [{ code: 'VALUE', detail: `transaction sends ${tx.value} wei; exits never send ETH` }] : [];
    return { ok: false, reasons: [{ code: 'DECODE', detail }, ...extra] };
  }
  const calls = flatten(decoded);

  // 1. Chain
  if (tx.chainId !== ctx.chainId) {
    reasons.push({ code: 'CHAIN', detail: `transaction is for chain ${tx.chainId} but the wallet is on chain ${ctx.chainId}` });
  } else if (!ctx.manifest.chains[String(tx.chainId)]) {
    reasons.push({ code: 'CHAIN', detail: `chain ${tx.chainId} is not listed in the exit manifest` });
  }

  // 2. Target
  const target = found?.entry;
  if (!target) reasons.push({ code: 'TARGET', detail: `${tx.to} is not an exit contract in the manifest`, subject: tx.to });

  // 3. Selector (outer + nested), only meaningful with a known target
  if (target) {
    const allowed = new Set<Hex>(target.selectors.map((s) => s.toLowerCase() as Hex));
    for (const c of calls) {
      if (!allowed.has(c.selector)) {
        reasons.push({ code: 'SELECTOR', detail: `${c.name} (${c.selector}) is not an allowed exit on ${tx.to}` });
      }
    }
  }

  // 4. Recipient pinned
  for (const c of calls) {
    for (const r of c.recipients) {
      if (!eq(r, ctx.account)) {
        reasons.push({ code: 'RECIPIENT', detail: `${c.name} pays ${r}, not ${ctx.account}`, subject: r });
      }
    }
  }

  // 5. Caller pinned for pay-the-caller pools
  if (calls.some((c) => c.paysCaller) && !eq(tx.from, ctx.account)) {
    reasons.push({ code: 'CALLER', detail: `this pool pays the sender ${tx.from}, not ${ctx.account}`, subject: tx.from });
  }

  // 6. Always banned (selectors, and forbidden steps inside a call such as v4 SETTLE/SWEEP)
  for (const c of calls) {
    if (BANNED_SELECTORS.has(c.selector)) {
      reasons.push({ code: 'BANNED', detail: `${c.name} is never part of an exit`, subject: c.counterparty });
    } else if (c.forbidden) {
      reasons.push({ code: 'BANNED', detail: c.forbidden });
    }
  }

  // 7. No ETH sent
  if (tx.value !== 0n) reasons.push({ code: 'VALUE', detail: `transaction sends ${tx.value} wei; exits never send ETH` });

  return { ok: reasons.length === 0, reasons };
}
