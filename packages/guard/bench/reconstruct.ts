/**
 * Turn a real mainnet transaction into the wallet request the user was shown.
 *   - a tx the user sent (approve, setApprovalForAll, transfer, payable call) → eth_sendTransaction with its real calldata
 *   - a permit() / Permit2.permit() / Permit2.permitTransferFrom() someone else submitted → the EIP-712 request the user
 *     signed, rebuilt from the calldata and checked by recovering the signer (verified = recovered address == owner)
 */
import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  parseAbi,
  parseAbiParameters,
  recoverTypedDataAddress,
  serializeSignature,
  type Hex,
} from 'viem';
import { rpc } from './lib';

export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export interface Req {
  id: string;
  category: string;
  /** real = calldata exactly as sent; reconstructed-verified = EIP-712 rebuilt and signature recovers to the owner; reconstructed-unverified */
  provenance: 'real' | 'reconstructed-verified' | 'reconstructed-unverified';
  tx: string;
  block: number;
  account: string;
  counterparty: string;
  request: { method: string; params: unknown[] };
  note?: string;
}

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const SEL = {
  approve: '0x095ea7b3',
  increaseAllowance: '0x39509351',
  setApprovalForAll: '0xa22cb465',
  transfer: '0xa9059cbb',
  permit2612: '0xd505accf',
  permitDai: '0x8fcbaf0c',
  p2single: '0x2b67b570',
  p2batch: '0x2a2d80d1',
  p2transfer: '0x30f28b7a',
  p2batchTransfer: '0xedd9444b',
  urExecute: '0x3593564c',
  urExecuteNoDeadline: '0x24856bc3',
} as const;

const p2Abi = parseAbi([
  'function permit(address owner, ((address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline) permitSingle, bytes signature)',
  'function permit(address owner, ((address token,uint160 amount,uint48 expiration,uint48 nonce)[] details,address spender,uint256 sigDeadline) permitBatch, bytes signature)',
  'function permitTransferFrom(((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount) transferDetails,address owner,bytes signature)',
  'function permitTransferFrom(((address token,uint256 amount)[] permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount)[] transferDetails,address owner,bytes signature)',
]);
const P2_DOMAIN = { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 } as const;
const DETAILS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' },
];
const TOKEN_PERM = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
];

const typedReq = (account: string, td: unknown) => ({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(td, (_, x) => (typeof x === 'bigint' ? x.toString() : x))] });

async function recovers(td: any, signature: Hex, owner: string): Promise<boolean> {
  try {
    return eq(await recoverTypedDataAddress({ ...td, signature }), owner);
  } catch {
    return false;
  }
}

async function call(to: string, data: Hex): Promise<Hex | null> {
  try {
    return await rpc<Hex>('eth_call', [{ to, data }, 'latest']);
  } catch {
    return null;
  }
}
async function strCall(to: string, sig: string): Promise<string | null> {
  const sel = { 'name()': '0x06fdde03', 'version()': '0x54fd4d50' }[sig]!;
  const r = await call(to, sel as Hex);
  if (!r || r === '0x') return null;
  try {
    return decodeAbiParameters(parseAbiParameters('string'), r)[0] as string;
  } catch {
    return null;
  }
}

/** Permit2 PermitSingle / PermitBatch typed data from its struct. */
export async function permit2Typed(owner: string, kind: 'single' | 'batch', p: any, sig: Hex) {
  const td =
    kind === 'single'
      ? { domain: P2_DOMAIN, primaryType: 'PermitSingle', types: { PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }], PermitDetails: DETAILS }, message: p }
      : { domain: P2_DOMAIN, primaryType: 'PermitBatch', types: { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }], PermitDetails: DETAILS }, message: p };
  return { td, verified: await recovers(td, sig, owner) };
}

/**
 * Rebuild the request behind `tx`. `owner` = the user whose permission/tokens moved (from the event),
 * `counterparty` = the spender/receiver the dataset labels.
 */
export async function reconstruct(tx: any, owner: string, counterparty: string, idPrefix: string): Promise<Req | null> {
  const input = (tx.input as Hex).toLowerCase() as Hex;
  const sel = input.slice(0, 10);
  const base = { tx: tx.hash, block: Number(tx.blockNumber), counterparty: getAddress(counterparty) };
  const id = `${idPrefix}:${tx.hash.slice(0, 12)}`;

  // 1. The user sent it.
  if (eq(tx.from, owner)) {
    const request = { method: 'eth_sendTransaction', params: [{ from: tx.from, to: tx.to, data: input, value: tx.value }] };
    let category = 'tx.other';
    if (sel === SEL.approve) {
      const amt = BigInt('0x' + (input.slice(74, 138) || '0'));
      category = amt >= 2n ** 255n ? 'tx.approve.unlimited' : amt === 0n ? 'tx.approve.zero(revoke)' : 'tx.approve.limited';
    } else if (sel === SEL.increaseAllowance) category = 'tx.increaseAllowance';
    else if (sel === SEL.setApprovalForAll) category = BigInt('0x' + (input.slice(74, 138) || '0')) === 0n ? 'tx.setApprovalForAll(false)' : 'tx.setApprovalForAll';
    else if (sel === SEL.transfer) category = 'tx.erc20.transfer';
    else if (input === '0x') category = BigInt(tx.value) > 0n ? 'tx.eth.transfer' : 'tx.empty';
    else if (BigInt(tx.value) > 0n) category = 'tx.payable-call';
    return { id, category, provenance: 'real', account: getAddress(tx.from), request, ...base };
  }

  // 2. Someone else submitted the user's signature.
  if (sel === SEL.permit2612) {
    const { args } = decodeFunctionData({ abi: parseAbi(['function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)']), data: input });
    const [o, spender, value, deadline, v, r, s] = args as [string, string, bigint, bigint, number, Hex, Hex];
    const signature = serializeSignature({ r, s, v: BigInt(v) });
    const name = (await strCall(tx.to, 'name()')) ?? '';
    const ver = await strCall(tx.to, 'version()');
    const nonceHex = await call(tx.to, ('0x7ecebe00' + o.slice(2).toLowerCase().padStart(64, '0')) as Hex);
    const cur = nonceHex && nonceHex !== '0x' ? BigInt(nonceHex) : 1n;
    const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
    let best: any = null;
    let verified = false;
    for (const version of [...new Set([ver, '1', '2'].filter((x): x is string => !!x))]) {
      for (let n = cur - 1n; n >= 0n && n >= cur - 40n && !verified; n--) {
        const td = { domain: { name, version, chainId: 1, verifyingContract: getAddress(tx.to) }, primaryType: 'Permit', types, message: { owner: o, spender, value, nonce: n, deadline } };
        best ??= td;
        if (await recovers(td, signature, o)) {
          best = td;
          verified = true;
        }
      }
      if (verified) break;
    }
    return { id, category: 'sig.permit(EIP-2612)', provenance: verified ? 'reconstructed-verified' : 'reconstructed-unverified', account: getAddress(o), request: typedReq(o, best), ...base, note: verified ? undefined : 'nonce/version not recovered; spender and fields are from calldata' };
  }
  if (sel === SEL.permitDai) {
    const { args } = decodeFunctionData({ abi: parseAbi(['function permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)']), data: input });
    const [holder, spender, nonce, expiry, allowed, v, r, s] = args as [string, string, bigint, bigint, boolean, number, Hex, Hex];
    const name = (await strCall(tx.to, 'name()')) ?? 'Dai Stablecoin';
    const td = { domain: { name, version: '1', chainId: 1, verifyingContract: getAddress(tx.to) }, primaryType: 'Permit', types: { Permit: [{ name: 'holder', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint256' }, { name: 'allowed', type: 'bool' }] }, message: { holder, spender, nonce, expiry, allowed } };
    const verified = await recovers(td, serializeSignature({ r, s, v: BigInt(v) }), holder);
    return { id, category: 'sig.permit(DAI)', provenance: verified ? 'reconstructed-verified' : 'reconstructed-unverified', account: getAddress(holder), request: typedReq(holder, td), ...base };
  }
  if (eq(tx.to, PERMIT2) && (sel === SEL.p2single || sel === SEL.p2batch || sel === SEL.p2transfer || sel === SEL.p2batchTransfer)) {
    const { functionName, args } = decodeFunctionData({ abi: p2Abi, data: input }) as { functionName: string; args: any[] };
    if (functionName === 'permit') {
      const [o, p, sig] = args as [string, any, Hex];
      const kind = Array.isArray(p.details) ? 'batch' : 'single';
      const { td, verified } = await permit2Typed(o, kind, p, sig);
      return { id, category: `sig.permit2.${kind}`, provenance: verified ? 'reconstructed-verified' : 'reconstructed-unverified', account: getAddress(o), request: typedReq(o, td), ...base };
    }
    const [permit, , o, sig] = args as [any, any, string, Hex];
    const batch = Array.isArray(permit.permitted);
    const td = {
      domain: P2_DOMAIN,
      primaryType: batch ? 'PermitBatchTransferFrom' : 'PermitTransferFrom',
      types: batch
        ? { PermitBatchTransferFrom: [{ name: 'permitted', type: 'TokenPermissions[]' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }], TokenPermissions: TOKEN_PERM }
        : { PermitTransferFrom: [{ name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }], TokenPermissions: TOKEN_PERM },
      message: { permitted: permit.permitted, spender: getAddress(tx.from), nonce: permit.nonce, deadline: permit.deadline },
    };
    const verified = await recovers(td, sig, o);
    return { id, category: batch ? 'sig.permit2.batchTransfer' : 'sig.permit2.transfer', provenance: verified ? 'reconstructed-verified' : 'reconstructed-unverified', account: getAddress(o), request: typedReq(o, td), ...base, note: verified ? undefined : 'spender assumed = tx.from (direct call)' };
  }
  // Universal Router execute with a PERMIT2_PERMIT / PERMIT2_PERMIT_BATCH command (benign Uniswap flow; the user sent this tx, but
  // also signed the embedded permit before, which is the signature request we want).
  return null;
}

/** The Permit2 signature a Uniswap user signed before an execute() that carries PERMIT2_PERMIT(_BATCH). */
export async function urEmbeddedPermit(tx: any, idPrefix: string): Promise<Req | null> {
  const input = (tx.input as Hex).toLowerCase() as Hex;
  const sel = input.slice(0, 10);
  if (sel !== SEL.urExecute && sel !== SEL.urExecuteNoDeadline) return null;
  const abi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline)', 'function execute(bytes commands, bytes[] inputs)']);
  const { args } = decodeFunctionData({ abi, data: input }) as { args: any[] };
  const cmds = (args[0] as Hex).slice(2).match(/../g)!.map((h) => parseInt(h, 16) & 0x3f);
  for (const [i, c] of cmds.entries()) {
    if (c !== 0x0a && c !== 0x04) continue;
    const kind = c === 0x0a ? 'single' : 'batch';
    const types = kind === 'single' ? '((address,uint160,uint48,uint48),address,uint256), bytes' : '((address,uint160,uint48,uint48)[],address,uint256), bytes';
    const [p, sig] = decodeAbiParameters(parseAbiParameters(types), args[1][i]) as [any, Hex];
    const toDet = (d: any) => ({ token: d[0], amount: d[1], expiration: d[2], nonce: d[3] });
    const struct = { details: kind === 'single' ? toDet(p[0]) : p[0].map(toDet), spender: p[1], sigDeadline: p[2] };
    const { td, verified } = await permit2Typed(tx.from, kind, struct, sig);
    return { id: `${idPrefix}:${tx.hash.slice(0, 12)}`, category: `sig.permit2.${kind}`, provenance: verified ? 'reconstructed-verified' : 'reconstructed-unverified', tx: tx.hash, block: Number(tx.blockNumber), account: getAddress(tx.from), counterparty: getAddress(struct.spender), request: typedReq(tx.from, td) };
  }
  return null;
}
