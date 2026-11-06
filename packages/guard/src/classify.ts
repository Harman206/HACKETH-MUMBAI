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
import { encodeFunctionData, getAddress, hexToBytes, isAddress, parseAbi, type Hex } from 'viem';
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

const APPROVALS = new Set(['approve', 'increaseAllowance', 'permit', 'permit (DAI)', 'permit (NFT)', 'setApprovalForAll', 'Permit2 approve', 'Permit2 permit', 'Permit2 lockdown']);
const REVOKE = 'Removes a permission';
const ZERO = '0x0000000000000000000000000000000000000000';

/** Every decoded step, with `direct` = not part of a batch (a plain top-level call, or the one call a Safe transaction wraps). */
function walk(d: Decoded, direct: boolean): { s: Decoded; direct: boolean }[] {
  return [{ s: d, direct }, ...d.nested.flatMap((n) => walk(n, direct && !d.batch))];
}

/** A permission that is being taken away: approve 0, setApprovalForAll false, permit 0, Permit2 lockdown. */
function isRevoke(s: Decoded): boolean {
  if (s.name === 'Permit2 lockdown') return true;
  if (s.name === 'setApprovalForAll' || s.name === 'permit (DAI)') return s.approved === false;
  if (['approve', 'permit', 'Permit2 approve', 'Permit2 permit'].includes(s.name)) return s.amount === 0n;
  return false;
}

const fmtAmount = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Who-controls-what changes: upgrades, ownership, Safe owners/modules/guards, Safe delegatecalls. */
function classifyControl(method: string, s: Decoded, target: Address, chainId: number, ctx: ClassifyCtx): Classification {
  const who = s.counterparty;
  const mine = (a?: string) => !!a && !!ctx.account && eq(a, ctx.account);
  const safe = `your Safe (${short(target)})`;
  const contract = `the contract ${short(target)}`;
  if (s.control === 'acceptOwner') return { verdict: 'unknown', method, reasons: [`This makes your own address the owner of ${contract}.`] };
  if (s.control === 'threshold') {
    return { verdict: 'risky', method, reasons: [`This changes how many owners must sign for ${safe} to ${s.threshold ?? 'a new number'}. Only continue if you and the other owners planned this.`] };
  }
  if (s.control === 'safeRemoveOwner') {
    if (mine(who)) return { verdict: 'dangerous', method, counterparty: who, reasons: [`This removes you as an owner of ${safe}. You would lose control of it.`] };
    return { verdict: 'risky', method, counterparty: who, reasons: [`This removes ${who ? short(who) : 'an owner'} as an owner of ${safe}. Only continue if the owners planned this.`] };
  }
  if (!who) return { verdict: 'dangerous', method, reasons: [`This changes who controls ${contract}, and the new controller cannot be read.`] };
  if (mine(who)) return { verdict: 'unknown', method, counterparty: who, reasons: [`This hands control of ${contract} to your own address.`] };
  const k = wellKnown(who, chainId, ctx);
  const p = protocolOf(who, chainId, ctx);
  if (s.control === 'delegatecall' && k) return { verdict: 'known', method, protocol: k.protocol, counterparty: who, reasons: [`Your Safe runs ${k.protocol}'s ${k.name} to send several transactions at once.`] };
  if (eq(who, ZERO)) {
    if (s.control === 'implementation' || s.control === 'delegatecall') return { verdict: 'dangerous', method, counterparty: who, reasons: [`This points ${contract} at empty code. It would stop working and anything in it could be lost.`] };
    return { verdict: 'risky', method, counterparty: who, reasons: [`This removes a ${s.control === 'owner' ? 'owner' : s.control} setting from ${s.control === 'owner' ? contract : safe}. Nobody gains control, but only continue if you meant to.`] };
  }
  const name = k ? `${k.protocol}'s ${k.name} (${short(who)})` : p ? `${short(who)} (published by ${p})` : short(who);
  if (k || p) {
    return { verdict: 'risky', method, protocol: k?.protocol ?? p, counterparty: who, reasons: [`This hands control of ${s.control === 'implementation' || s.control === 'owner' ? contract : safe} to ${name}. Only continue if you meant to.`] };
  }
  const stranger = 'No protocol you follow publishes that address.';
  const why: Record<string, string> = {
    implementation: `This replaces the code of ${contract} with code from ${name}. Whoever wrote that code gets full control of it and of everything it holds. ${stranger}`,
    owner: `This hands control of ${contract} to ${name}. ${stranger}`,
    safeOwner: `This hands control of your Safe to ${name}: it becomes an owner who can sign transactions that move everything in ${safe}. ${stranger}`,
    module: `This hands control of your Safe to ${name}: as a module it can move everything in ${safe} without any owner signature. ${stranger}`,
    guard: `This hands control of your Safe to ${name}: as its guard it can block every transaction of ${safe}, including rescues. ${stranger}`,
    fallbackHandler: `This hands control of your Safe to ${name}: as its fallback handler it decides how ${safe} answers signature checks and unknown calls. ${stranger}`,
    delegatecall: `This makes ${safe} run code from ${name} with full control over it (a delegatecall). That is how the Bybit Safe was taken over in 2025. ${stranger}`,
  };
  return { verdict: 'dangerous', method, counterparty: who, reasons: [why[s.control!] ?? `This changes who controls ${contract}. ${stranger}`] };
}

/** EIP-7702: a transaction that carries authorizations makes an account run another contract's code. */
function classifyDelegations(method: string, list: unknown, chainId: number, ctx: ClassifyCtx): Classification[] {
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.map((a) => {
    const raw = a && typeof a === 'object' ? ((a as Record<string, unknown>).address ?? (a as Record<string, unknown>).contractAddress) : undefined;
    if (typeof raw !== 'string' || !isAddress(raw, { strict: false })) {
      return { verdict: 'dangerous', method, reasons: ['This turns your account into a smart account (EIP-7702), and the code it would run cannot be read.'] };
    }
    const who = getAddress(raw);
    if (eq(who, ZERO)) return { verdict: 'risky', method, counterparty: who, reasons: ['This removes the smart-account code from your account (EIP-7702). Only continue if you meant to.'] };
    const k = wellKnown(who, chainId, ctx);
    const p = protocolOf(who, chainId, ctx);
    if (k || p) {
      return { verdict: 'risky', method, protocol: k?.protocol ?? p, counterparty: who, reasons: [`This turns your account into a smart account running ${k ? `${k.protocol}'s ${k.name}` : `code published by ${p}`} (EIP-7702). That code would control everything in your wallet.`] };
    }
    return { verdict: 'dangerous', method, counterparty: who, reasons: [`This turns your account into a smart account running code from ${short(who)} (EIP-7702). That code would control everything in your wallet. No protocol you follow publishes it.`] };
  });
}

/** One call (a transaction, or one call of a wallet_sendCalls batch). `inBatch`: one of several calls in a batch. */
function classifyCall(method: string, call: Record<string, unknown>, chainId: number, ctx: ClassifyCtx, inBatch = false): Classification {
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
  const k = wellKnown(target, chainId, ctx);

  // 1. A Copeybara exit for a followed protocol (the fail-closed Guard decides).
  if (ctx.account && protocol && call.authorizationList === undefined) {
    const tx: TxRequest = { chainId, from: ctx.account, to: target, data: data as Hex, value };
    for (const m of ctx.manifests) {
      if (guard(tx, { account: ctx.account, chainId, manifest: m.manifest }).ok) {
        return { verdict: 'exit', method, protocol: m.name, reasons: [`A withdrawal from ${m.name} that pays only your own address.`] };
      }
    }
  }

  // 2. The drainer patterns, anywhere in the call (inside a multicall or a Safe transaction too).
  let steps: { s: Decoded; direct: boolean }[] = [];
  try {
    steps = walk(decodeCall(data as Hex), !inBatch);
  } catch {
    steps = [];
  }
  const out: Classification[] = classifyDelegations(method, call.authorizationList, chainId, ctx);
  for (const { s, direct } of steps) {
    if (s.control) {
      out.push(classifyControl(method, s, target, chainId, ctx));
      continue;
    }
    if (!APPROVALS.has(s.name) && !/transfer/i.test(s.name)) continue;
    const others = (s.counterparties ?? (s.counterparty ? [s.counterparty] : [])).filter((a) => !(ctx.account && eq(a, ctx.account)));
    const who = others[0] ?? s.counterparty;
    const whoProto = who ? protocolOf(who, chainId, ctx) : undefined;
    // A Permit2 approve / permit only means something when it is sent to the real Permit2.
    const viaPermit2 = s.name.startsWith('Permit2');
    const whoKnown = viaPermit2 && !isPermit2At(target, chainId, ctx) ? undefined : wellKnown(who, chainId, ctx);
    const whoText = who ? short(who) : 'an address that could not be read';
    if (APPROVALS.has(s.name)) {
      if (isRevoke(s)) {
        out.push({ verdict: 'pass', method, counterparty: who, reasons: [`${REVOKE}: ${whoText} can no longer spend this token. This is safe.`] });
        continue;
      }
      const amount = s.name === 'approve' || s.name === 'increaseAllowance' ? (s.amount ?? null) : null;
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
    } else if (who && others.length === 0) {
      out.push({ verdict: 'unknown', method, reasons: ['This moves tokens to your own address.'] });
    } else if (whoProto && others.every((a) => protocolOf(a, chainId, ctx))) {
      out.push({ verdict: 'known', method, protocol: whoProto, counterparty: who, reasons: [`This sends tokens to ${whoText}, a contract published by ${whoProto}.`] });
    } else if (s.name === 'transfer' && direct && s.amount !== undefined) {
      // A plain ERC-20 send, the way people pay each other: ask, don't alarm. Batched sends and transferFrom stay red.
      out.push({ verdict: 'risky', method, counterparty: who, reasons: [`You are sending ${fmtAmount(s.amount)} units of the token at ${short(target)} to ${whoText}. Make sure you know this address: Copeybara cannot tell a friend from a scammer.`] });
    } else if (s.name === 'bulkTransfer') {
      out.push({ verdict: 'dangerous', method, counterparty: who, reasons: [`This sends ${s.amount ?? 'several'} NFTs or tokens at once to ${others.map(short).join(', ')}, through a bulk-transfer helper. No protocol you follow publishes that address: this is how NFT drainers work.`] });
    } else {
      out.push({ verdict: 'dangerous', method, counterparty: who, reasons: [`This sends your tokens to ${whoText}, an address no protocol you follow publishes.`] });
    }
  }

  // 3. ETH to a stranger, on top of whatever the call does.
  if (value > 0n && !protocol && !k) {
    out.push({ verdict: 'risky', method, counterparty: target, reasons: [`This sends ETH to ${short(target)}, an address no protocol you follow publishes.`] });
  }
  if (out.length) return out.reduce((w, c) => (ORDER.indexOf(c.verdict) > ORDER.indexOf(w.verdict) ? c : w));

  // 4. Known contract, everything else.
  if (protocol) return { verdict: 'known', method, protocol, reasons: [`A call to ${short(target)}, a contract published by ${protocol}.`] };
  if (k) return { verdict: 'known', method, protocol: k.protocol, reasons: [`A call to ${k.protocol}'s ${k.name} (${short(target)}).`] };
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

/** A permit signature that grants nothing: EIP-2612 value 0, DAI allowed=false, Permit2 PermitSingle/PermitBatch amount 0. */
function isZeroPermit(pt: string, isPermit2: boolean, msg: Record<string, unknown>): boolean {
  if (isPermit2) {
    if (pt !== 'PermitSingle' && pt !== 'PermitBatch') return false;
    const d = msg.details;
    const list = Array.isArray(d) ? d : d && typeof d === 'object' ? [d] : [];
    return list.length > 0 && list.every((x) => x && typeof x === 'object' && toBig((x as Record<string, unknown>).amount) === 0n && (x as Record<string, unknown>).amount !== undefined);
  }
  if (pt !== 'Permit') return false;
  if ('allowed' in msg) return msg.allowed === false;
  return msg.value !== undefined && toBig(msg.value) === 0n;
}

/** A Safe owner signs a SafeTx (EIP-712): the same call as execTransaction on the Safe, classified the same way. */
function classifySafeTx(method: string, dom: Record<string, unknown>, msg: Record<string, unknown>, chainId: number, ctx: ClassifyCtx): Classification {
  const safe = dom.verifyingContract;
  const inner = msg.to;
  const data = msg.data ?? '0x';
  const value = toBig(msg.value);
  const op = toBig(msg.operation);
  if (typeof safe !== 'string' || !isAddress(safe, { strict: false }) || typeof inner !== 'string' || !isAddress(inner, { strict: false }) || typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data) || value === null || op === null || op > 1n) {
    return unreadable(method, 'Safe transaction');
  }
  const dc = toBig(dom.chainId);
  const cid = dc && dc > 0n && dc <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(dc) : chainId;
  const execData = encodeFunctionData({ abi: SAFE_EXEC, functionName: 'execTransaction', args: [getAddress(inner), value, data as Hex, Number(op), 0n, 0n, 0n, ZERO, ZERO, '0x'] });
  const c = classifyCall(method, { to: safe, data: execData, value: '0x0' }, cid, ctx);
  if (c.verdict === 'unknown' && value > 0n && !protocolOf(inner, cid, ctx) && !wellKnown(inner, cid, ctx)) {
    return { verdict: 'risky', method, counterparty: getAddress(inner), reasons: [`This signs a Safe transaction that sends ETH from your Safe to ${short(inner)}, an address no protocol you follow publishes.`] };
  }
  return { ...c, reasons: c.reasons.map((r, i) => (i === 0 ? `This signs a Safe transaction. ${r}` : r)) };
}
const SAFE_EXEC = parseAbi(['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)']);

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
  if (pt === 'SafeTx') return classifySafeTx(method, dom, msg, chainId, ctx);
  if (isPermit2 || pt === 'Permit' || spender) {
    const what = isPermit2 ? 'a Permit2 signature' : 'a permit signature';
    if (spender && isZeroPermit(pt, isPermit2, msg)) {
      return { verdict: 'pass', method, counterparty: spender, reasons: [`${REVOKE}: this ${isPermit2 ? 'Permit2 ' : ''}permit sets what ${short(spender)} may spend to zero. This is safe.`] };
    }
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
      const many = b.calls.length > 1;
      const each = b.calls.map((c) => (c && typeof c === 'object' ? classifyCall(method, c as Record<string, unknown>, chainId, ctx, many) : unreadable(method, 'transaction')));
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
