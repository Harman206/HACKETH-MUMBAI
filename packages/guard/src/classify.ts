/**
 * Classify any wallet request a web page makes (extension: every site, not only exits).
 *   pass      not a request that moves funds or grants permissions (or plain-text sign-in)
 *   exit      passes the fail-closed Exit Guard for a followed protocol
 *   known     targets a contract a followed protocol publishes
 *   unknown   an ordinary call to a contract no followed protocol lists (no prompt by itself)
 *   risky     needs a look: standing permission to a known contract, ETH to a stranger, unreadable request
 *   dangerous the drainer patterns: approvals/permits/transfers to strangers, eth_sign, raw-hash signatures
 * Approvals and permits to a well-known contract (the built-in table in @copeybara/core: Uniswap's Permit2, Universal
 * Router, routers and position managers) are 'known', so the normal Uniswap flow is not flagged as a drainer.
 * Plain-language reasons only; the extension's trusted UI shows them.
 */
import { getAddress, hexToBytes, isAddress, type Hex } from 'viem';
import { KNOWN_CONTRACTS, knownContract, type Address, type KnownContract, type KnownTable, type Manifest, type TxRequest } from '@copeybara/core';
import { decodeCall, type Decoded } from './decode';
import { guard } from './guard';

export type RequestVerdict = 'pass' | 'exit' | 'known' | 'unknown' | 'risky' | 'dangerous';
const ORDER: RequestVerdict[] = ['pass', 'exit', 'known', 'unknown', 'risky', 'dangerous'];

export interface FollowedManifest {
  name: string;
  manifest: Manifest;
}
export interface ClassifyCtx {
  account: Address | null;
  chainId: number;
  manifests: FollowedManifest[];
  /** Well-known contracts. Defaults to the built-in table (KNOWN_CONTRACTS); pass `{ v: 1, protocols: {} }` to turn it off. */
  known?: KnownTable;
}
export interface Classification {
  verdict: RequestVerdict;
  reasons: string[];
  method: string;
  counterparty?: Address;
  /** followed protocol the request belongs to (exit / known / known spender) */
  protocol?: string;
}

export const WATCHED_METHODS = [
  'eth_sendTransaction',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
  'wallet_sendCalls',
] as const;

export function worstVerdict(vs: RequestVerdict[]): RequestVerdict {
  return vs.reduce<RequestVerdict>((w, v) => (ORDER.indexOf(v) > ORDER.indexOf(w) ? v : w), 'pass');
}

const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const UNLIMITED = 2n ** 255n;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const wellKnown = (addr: string | undefined, chainId: number, ctx: ClassifyCtx): KnownContract | undefined =>
  addr ? knownContract(addr, chainId, ctx.known ?? KNOWN_CONTRACTS) : undefined;
const isPermit2At = (addr: unknown, chainId: number, ctx: ClassifyCtx) => typeof addr === 'string' && wellKnown(addr, chainId, ctx)?.role === 'permit2';
const NOT_UNISWAP = 'the most common way Uniswap users are drained';

/** Plain reason for a permission to a well-known contract. */
function knownSpenderReason(k: KnownContract, viaPermit2: boolean, scope: string): string {
  if (k.role === 'permit2') {
    return `Standard ${k.protocol} flow: lets Permit2, ${k.protocol}'s shared approval contract, manage this token. An app still needs a separate Permit2 signature from you before it can spend it.`;
  }
  if (viaPermit2) return `Standard ${k.protocol} flow: lets ${k.protocol}'s ${k.name} spend this token through Permit2.`;
  return `Standard ${k.protocol} flow: lets ${k.protocol}'s ${k.name} spend ${scope}. It only takes tokens from the wallet that calls it.`;
}

/** Which followed protocol publishes `addr` on `chainId` (any role: exit target, state view, LP token…). */
export function protocolOf(addr: string, chainId: number, ctx: ClassifyCtx): string | undefined {
  for (const { name, manifest } of ctx.manifests) {
    for (const targets of Object.values(manifest.chains[String(chainId)] ?? {})) {
      for (const t of Object.values(targets ?? {})) if (eq(t.address, addr)) return name;
    }
  }
  return undefined;
}

const unreadable = (method: string, what: string): Classification => ({
  verdict: 'risky',
  method,
  reasons: [`This ${what} could not be read, so Copeybara cannot tell what it does. Only continue if you started it yourself.`],
});

function toBig(v: unknown): bigint | null {
  if (v === undefined || v === null || v === '') return 0n;
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
    if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(v)) return BigInt(v);
  } catch {
    /* fall through */
  }
  return null;
}

const APPROVALS = new Set(['approve', 'increaseAllowance', 'permit', 'permit (DAI)', 'permit (NFT)', 'setApprovalForAll', 'Permit2 approve', 'Permit2 permit']);

function flatten(d: Decoded): Decoded[] {
  return [d, ...d.nested.flatMap(flatten)];
}

/** One call (a transaction, or one call of a wallet_sendCalls batch). */
function classifyCall(method: string, call: Record<string, unknown>, chainId: number, ctx: ClassifyCtx): Classification {
  const to = call.to;
  const data = (call.data ?? call.input ?? '0x') as unknown;
  const value = toBig(call.value);
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(data) || value === null) return unreadable(method, 'transaction');
  if (to === undefined || to === null || to === '') {
    return { verdict: 'risky', method, reasons: ['This creates a new contract. Websites almost never need you to do that.'] };
  }
  if (typeof to !== 'string' || !isAddress(to, { strict: false })) return unreadable(method, 'transaction');
  const target = getAddress(to);
  const protocol = protocolOf(target, chainId, ctx);

  // 1. A Copeybara exit for a followed protocol (the fail-closed Guard decides).
  if (ctx.account && protocol) {
    const tx: TxRequest = { chainId, from: ctx.account, to: target, data: data as Hex, value };
    for (const m of ctx.manifests) {
      if (guard(tx, { account: ctx.account, chainId, manifest: m.manifest }).ok) {
        return { verdict: 'exit', method, protocol: m.name, reasons: [`A withdrawal from ${m.name} that pays only your own address.`] };
      }
    }
  }

  // 2. The drainer patterns, anywhere in the call (including inside a multicall).
  let steps: Decoded[] = [];
  try {
    steps = flatten(decodeCall(data as Hex));
  } catch {
    steps = [];
  }
  const out: Classification[] = [];
  for (const s of steps) {
    if (!APPROVALS.has(s.name) && !/transfer/i.test(s.name)) continue;
    const who = s.counterparty;
    const whoProto = who ? protocolOf(who, chainId, ctx) : undefined;
    // A Permit2 approve / permit only means something when it is sent to the real Permit2.
    const viaPermit2 = s.name.startsWith('Permit2');
    const whoKnown = viaPermit2 && !isPermit2At(target, chainId, ctx) ? undefined : wellKnown(who, chainId, ctx);
    const whoText = who ? short(who) : 'an address that could not be read';
    if (APPROVALS.has(s.name)) {
      let amount: bigint | null = null;
      if (s.name === 'approve' || s.name === 'increaseAllowance') amount = toBig(`0x${(data as string).slice(74, 138)}`);
      const all = s.name === 'setApprovalForAll' || amount === null || amount >= UNLIMITED;
      const scope = all ? 'ALL of this token in your wallet, now and later' : 'part of this token in your wallet';
      if (whoKnown) {
        out.push({ verdict: 'known', method, protocol: whoKnown.protocol, counterparty: who, reasons: [knownSpenderReason(whoKnown, viaPermit2, scope)] });
      } else if (whoProto) {
        out.push({ verdict: 'risky', method, protocol: whoProto, counterparty: who, reasons: [`This lets ${whoText} (published by ${whoProto}) spend ${scope}. Exits never need this.`] });
      } else if (viaPermit2) {
        out.push({ verdict: 'dangerous', method, counterparty: who, reasons: [`A Permit2 permission for a spender that is not Uniswap: ${NOT_UNISWAP}. It lets ${whoText} spend ${scope}.`] });
      } else {
        out.push({ verdict: 'dangerous', method, counterparty: who, reasons: [`This lets ${whoText} spend ${scope}. No protocol you follow publishes that address: this is how wallet drainers work.`] });
      }
    } else if (who && ctx.account && eq(who, ctx.account)) {
      out.push({ verdict: 'unknown', method, reasons: ['This moves tokens to your own address.'] });
    } else if (whoProto) {
      out.push({ verdict: 'known', method, protocol: whoProto, counterparty: who, reasons: [`This sends tokens to ${whoText}, a contract published by ${whoProto}.`] });
    } else {
      out.push({ verdict: 'dangerous', method, counterparty: who, reasons: [`This sends your tokens to ${whoText}, an address no protocol you follow publishes.`] });
    }
  }
  if (out.length) return out.reduce((w, c) => (ORDER.indexOf(c.verdict) > ORDER.indexOf(w.verdict) ? c : w));

  // 3. Known contract, ETH to strangers, everything else.
  if (protocol) return { verdict: 'known', method, protocol, reasons: [`A call to ${short(target)}, a contract published by ${protocol}.`] };
  const k = wellKnown(target, chainId, ctx);
  if (k) return { verdict: 'known', method, protocol: k.protocol, reasons: [`A call to ${k.protocol}'s ${k.name} (${short(target)}).`] };
  if (value > 0n) {
    return { verdict: 'risky', method, counterparty: target, reasons: [`This sends ETH to ${short(target)}, an address no protocol you follow publishes.`] };
  }
  if (data === '0x') return { verdict: 'pass', method, reasons: ['An empty transaction.'] };
  return { verdict: 'unknown', method, counterparty: target, reasons: [`A call to ${short(target)}, a contract no protocol you follow publishes.`] };
}

const isPrintable = (bytes: Uint8Array) => {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n\r\t]*$/u.test(s);
  } catch {
    return false;
  }
};

function classifyPersonalSign(params: unknown[]): Classification {
  const method = 'personal_sign';
  const msg = params.find((p) => typeof p === 'string' && !isAddress(p, { strict: false }));
  if (typeof msg !== 'string') return unreadable(method, 'signature request');
  if (/^0x([0-9a-fA-F]{2})*$/.test(msg)) {
    const bytes = hexToBytes(msg as Hex);
    if (bytes.length === 32 && !isPrintable(bytes)) {
      return { verdict: 'dangerous', method, reasons: ['This signs a bare 32-byte hash. It can stand in for a transaction or a permit you cannot read.'] };
    }
    if (!isPrintable(bytes)) return { verdict: 'risky', method, reasons: ['This signs binary data that cannot be shown as text.'] };
  }
  return { verdict: 'pass', method, reasons: ['A plain-text message (for example a sign-in). It cannot move funds on its own.'] };
}

function classifyTyped(method: string, params: unknown[], chainId: number, ctx: ClassifyCtx): Classification {
  if (method === 'eth_signTypedData') {
    return { verdict: 'risky', method, reasons: ['This uses an old signature format that wallets cannot show clearly.'] };
  }
  const raw = params.find((p) => !(typeof p === 'string' && isAddress(p, { strict: false })));
  let td: { domain?: Record<string, unknown>; primaryType?: unknown; message?: Record<string, unknown> };
  try {
    td = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof td);
    if (!td || typeof td !== 'object') throw new Error();
  } catch {
    return unreadable(method, 'signature request');
  }
  const pt = String(td.primaryType ?? '');
  const dom = td.domain ?? {};
  const msg = td.message ?? {};
  const isPermit2 = dom.name === 'Permit2' || (typeof dom.verifyingContract === 'string' && eq(dom.verifyingContract, PERMIT2));
  const spender = typeof msg.spender === 'string' && isAddress(msg.spender, { strict: false }) ? getAddress(msg.spender) : undefined;
  if (isPermit2 || pt === 'Permit' || spender) {
    const what = isPermit2 ? 'a Permit2 signature' : 'a permit signature';
    if (spender) {
      // The signature is valid on the chain in its domain, so the spender is looked up there.
      const dc = toBig(dom.chainId);
      const sigChain = dc && dc > 0n && dc <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(dc) : chainId;
      const realPermit2 = isPermit2At(dom.verifyingContract, sigChain, ctx);
      const k = isPermit2 && !realPermit2 ? undefined : wellKnown(spender, sigChain, ctx);
      if (k) return { verdict: 'known', method, protocol: k.protocol, counterparty: spender, reasons: [knownSpenderReason(k, isPermit2, 'this token')] };
      const p = protocolOf(spender, chainId, ctx);
      if (isPermit2 && !p) {
        return { verdict: 'dangerous', method, counterparty: spender, reasons: [`A Permit2 signature for a spender that is not Uniswap: ${NOT_UNISWAP}. It lets ${short(spender)} spend your tokens without another transaction.`] };
      }
      if (p) return { verdict: 'risky', method, protocol: p, counterparty: spender, reasons: [`This is ${what} that lets ${short(spender)} (published by ${p}) spend your tokens without another transaction.`] };
      return { verdict: 'dangerous', method, counterparty: spender, reasons: [`This is ${what} that lets ${short(spender)} spend your tokens without another transaction. No protocol you follow publishes that address.`] };
    }
    return { verdict: 'dangerous', method, reasons: [`This is ${what}, and who could spend your tokens cannot be read.`] };
  }
  if (pt === 'OrderComponents' || /order/i.test(pt)) {
    return { verdict: 'risky', method, reasons: ['This signs a marketplace order. A signed order can hand over your tokens or NFTs when someone fills it.'] };
  }
  return { verdict: 'unknown', method, reasons: [`A typed message (${pt || 'unnamed'}) that is not a token permission.`] };
}

export function classifyRequest(req: { method: string; params?: unknown }, ctx: ClassifyCtx): Classification {
  const method = req.method;
  const params = Array.isArray(req.params) ? req.params : [];
  switch (method) {
    case 'eth_sendTransaction': {
      const tx = params[0];
      if (!tx || typeof tx !== 'object') return unreadable(method, 'transaction');
      const t = tx as Record<string, unknown>;
      const cid = toBig(t.chainId);
      return classifyCall(method, t, cid && cid > 0n ? Number(cid) : ctx.chainId, ctx);
    }
    case 'wallet_sendCalls': {
      const b = params[0] as { calls?: unknown; chainId?: unknown } | undefined;
      if (!b || !Array.isArray(b.calls) || b.calls.length === 0) return unreadable(method, 'batch of transactions');
      const cid = toBig(b.chainId);
      const chainId = cid && cid > 0n ? Number(cid) : ctx.chainId;
      const each = b.calls.map((c) => (c && typeof c === 'object' ? classifyCall(method, c as Record<string, unknown>, chainId, ctx) : unreadable(method, 'transaction')));
      const worst = worstVerdict(each.map((e) => e.verdict));
      const pick = each.find((e) => e.verdict === worst)!;
      return { ...pick, method, reasons: each.length > 1 ? [`A batch of ${each.length} transactions. The riskiest one: ${pick.reasons[0]}`] : pick.reasons };
    }
    case 'eth_sign':
      return { verdict: 'dangerous', method, reasons: ['eth_sign signs a raw hash. It can authorize almost anything, and honest sites no longer use it.'] };
    case 'personal_sign':
      return classifyPersonalSign(params);
    case 'eth_signTypedData':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return classifyTyped(method, params, ctx.chainId, ctx);
    default:
      return { verdict: 'pass', method, reasons: [] };
  }
}
