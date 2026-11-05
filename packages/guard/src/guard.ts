import { BANNED_SELECTORS, type Address, type Hex, type Manifest, type TargetEntry, type TxRequest } from '@blackout/core';
import { decodeCall, DecodeError, type Decoded } from './decode';

export interface GuardCtx {
  account: Address;
  chainId: number;
  manifest: Manifest;
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

function findTarget(m: Manifest, chainId: number, to: Address): TargetEntry | undefined {
  const cm = m.chains[String(chainId)];
  if (!cm) return undefined;
  for (const targets of Object.values(cm)) {
    for (const t of Object.values(targets ?? {})) {
      if (eq(t.address, to) && t.selectors.length > 0) return t;
    }
  }
  return undefined;
}

/**
 * Static policy check. Rejects anything that is not a known exit paying the connected account.
 * Fails closed on anything it cannot decode. Simulation and receipt checks live in @blackout/exec.
 */
export function guard(tx: TxRequest, ctx: GuardCtx): GuardResult {
  const reasons: GuardReason[] = [];

  let decoded: Decoded;
  try {
    decoded = decodeCall(tx.data);
  } catch (e) {
    const detail = e instanceof DecodeError ? e.message : 'calldata could not be decoded';
    return { ok: false, reasons: [{ code: 'DECODE', detail }] };
  }
  const calls = flatten(decoded);

  // 1. Chain
  if (tx.chainId !== ctx.chainId) {
    reasons.push({ code: 'CHAIN', detail: `transaction is for chain ${tx.chainId} but the wallet is on chain ${ctx.chainId}` });
  } else if (!ctx.manifest.chains[String(tx.chainId)]) {
    reasons.push({ code: 'CHAIN', detail: `chain ${tx.chainId} is not listed in the exit manifest` });
  }

  // 2. Target
  const target = findTarget(ctx.manifest, tx.chainId, tx.to);
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

  // 6. Always banned
  for (const c of calls) {
    if (BANNED_SELECTORS.has(c.selector)) {
      reasons.push({ code: 'BANNED', detail: `${c.name} is never part of an exit`, subject: c.counterparty });
    }
  }

  // 7. No ETH sent
  if (tx.value !== 0n) reasons.push({ code: 'VALUE', detail: `transaction sends ${tx.value} wei; exits never send ETH` });

  return { ok: reasons.length === 0, reasons };
}
