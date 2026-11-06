import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, getAddress, parseAbi, parseAbiParameters, type Abi } from 'viem';
import { aavePoolAbi, curve3poolAbi, npmAbi, SEL, SIGS, specExitSelector, V4_ACTIONS, v4PosmAbi, type Address, type ExitKind, type Hex } from '@copeybara/core';

export interface Decoded {
  selector: Hex;
  name: string;
  /** Every address the call pays out to (must equal the user). */
  recipients: Address[];
  /** True when the contract pays msg.sender (Curve). */
  paysCaller: boolean;
  nested: Decoded[];
  /** For banned calls: the spender / receiver, when decodable. Used only for explanations. */
  counterparty?: Address;
  /** Set on a step that is never part of an exit (e.g. a Uniswap v4 SETTLE action); the plain reason. */
  forbidden?: string;
  // ---- Below: read only by the request classifier, for its verdict and wording. The Guard rejects every one of these calls.
  /** Token amount of this call's own arguments (approve, increaseAllowance, transfer, permit, Permit2 approve). */
  amount?: bigint;
  /** setApprovalForAll / DAI permit flag (false = a revocation). */
  approved?: boolean;
  /** Every receiver (batch transfers) or spender (Permit2 lockdown), when there can be more than one. */
  counterparties?: Address[];
  /** The call changes who controls a contract, a Safe or the account. `counterparty` is who gets control. */
  control?: ControlKind;
  /** Safe changeThreshold / removeOwner: the new threshold. */
  threshold?: bigint;
  /** The nested calls are a batch (multicall, Safe MultiSend), not a single wrapped call (Safe execTransaction). */
  batch?: boolean;
}

export type ControlKind = 'implementation' | 'owner' | 'acceptOwner' | 'safeOwner' | 'safeRemoveOwner' | 'threshold' | 'module' | 'guard' | 'fallbackHandler' | 'delegatecall';

export class DecodeError extends Error {
  override name = 'DecodeError';
}

const MAX_MULTICALL_DEPTH = 2;

type Extra = (args: readonly any[]) => Partial<Decoded>;
const big = (v: unknown): bigint | undefined => (typeof v === 'bigint' ? v : typeof v === 'number' ? BigInt(v) : undefined);
const addr = (v: unknown): Address => getAddress(v as Address);
const ctl = (control: ControlKind, i: number): Extra => (a) => ({ control, counterparty: addr(a[i]) });

/** Banned selectors → [human name, ABI fragment, index of counterparty arg or -1, extra fields for the classifier]. */
const BANNED: Record<Hex, [string, string, number, Extra?]> = {
  [SEL.approve]: ['approve', 'function approve(address,uint256)', 0, (a) => ({ amount: big(a[1]) })],
  [SEL.increaseAllowance]: ['increaseAllowance', 'function increaseAllowance(address,uint256)', 0, (a) => ({ amount: big(a[1]) })],
  [SEL.permit2612]: ['permit', 'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', 1, (a) => ({ amount: big(a[2]) })],
  [SEL.permitDai]: ['permit (DAI)', 'function permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)', 1, (a) => ({ approved: a[4] === true })],
  [SEL.permit721]: ['permit (NFT)', 'function permit(address,uint256,uint256,uint8,bytes32,bytes32)', 0],
  [SEL.setApprovalForAll]: ['setApprovalForAll', 'function setApprovalForAll(address,bool)', 0, (a) => ({ approved: a[1] === true })],
  [SEL.transfer]: ['transfer', 'function transfer(address,uint256)', 0, (a) => ({ amount: big(a[1]) })],
  [SEL.transferFrom]: ['transferFrom', 'function transferFrom(address,address,uint256)', 1, (a) => ({ amount: big(a[2]) })],
  [SEL.safeTransferFrom]: ['safeTransferFrom', 'function safeTransferFrom(address,address,uint256)', 1],
  [SEL.safeTransferFromData]: ['safeTransferFrom', 'function safeTransferFrom(address,address,uint256,bytes)', 1],
  [SEL.permit2Approve]: ['Permit2 approve', 'function approve(address,address,uint160,uint48)', 1, (a) => ({ amount: big(a[2]) })],
  [SEL.permit2PermitSingle]: ['Permit2 permit', `function ${SIGS.banned[11]}`, -1],
  [SEL.permit2PermitBatch]: ['Permit2 permit', `function ${SIGS.banned[12]}`, -1],
  [SEL.permit2TransferFrom]: ['Permit2 permitTransferFrom', `function ${SIGS.banned[13]}`, -1],
  [SEL.permit2WitnessTransferFrom]: ['Permit2 permitWitnessTransferFrom', `function ${SIGS.banned[14]}`, -1],
  // Who controls a contract or a Safe.
  [SEL.upgradeTo]: ['upgradeTo', 'function upgradeTo(address)', -1, ctl('implementation', 0)],
  [SEL.upgradeToAndCall]: ['upgradeToAndCall', 'function upgradeToAndCall(address,bytes)', -1, ctl('implementation', 0)],
  [SEL.transferOwnership]: ['transferOwnership', 'function transferOwnership(address)', -1, ctl('owner', 0)],
  [SEL.setOwner]: ['setOwner', 'function setOwner(address)', -1, ctl('owner', 0)],
  [SEL.acceptOwnership]: ['acceptOwnership', 'function acceptOwnership()', -1, () => ({ control: 'acceptOwner' })],
  [SEL.safeAddOwner]: ['addOwnerWithThreshold (Safe)', 'function addOwnerWithThreshold(address,uint256)', -1, (a) => ({ control: 'safeOwner', counterparty: addr(a[0]), threshold: big(a[1]) })],
  [SEL.safeSwapOwner]: ['swapOwner (Safe)', 'function swapOwner(address,address,address)', -1, ctl('safeOwner', 2)],
  [SEL.safeRemoveOwner]: ['removeOwner (Safe)', 'function removeOwner(address,address,uint256)', -1, (a) => ({ control: 'safeRemoveOwner', counterparty: addr(a[1]), threshold: big(a[2]) })],
  [SEL.safeChangeThreshold]: ['changeThreshold (Safe)', 'function changeThreshold(uint256)', -1, (a) => ({ control: 'threshold', threshold: big(a[0]) })],
  [SEL.safeEnableModule]: ['enableModule (Safe)', 'function enableModule(address)', -1, ctl('module', 0)],
  [SEL.safeSetGuard]: ['setGuard (Safe)', 'function setGuard(address)', -1, ctl('guard', 0)],
  [SEL.safeSetFallbackHandler]: ['setFallbackHandler (Safe)', 'function setFallbackHandler(address)', -1, ctl('fallbackHandler', 0)],
  // Batch transfers and Permit2 lockdown.
  [SEL.bulkTransfer]: ['bulkTransfer', 'function bulkTransfer(((uint8,address,uint256,uint256)[],address,bool)[],bytes32)', -1, (a) => {
    const groups = a[0] as readonly (readonly [readonly unknown[], Address, boolean])[];
    const counterparties = groups.map((g) => addr(g[1]));
    return { counterparties, counterparty: counterparties[0], amount: BigInt(groups.reduce((n, g) => n + g[0].length, 0)) };
  }],
  [SEL.safeBatchTransferFrom1155]: ['safeBatchTransferFrom', 'function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', 1],
  [SEL.safeTransferFrom1155]: ['safeTransferFrom (ERC-1155)', 'function safeTransferFrom(address,address,uint256,uint256,bytes)', 1],
  [SEL.permit2Lockdown]: ['Permit2 lockdown', 'function lockdown((address,address)[])', -1, (a) => {
    const counterparties = (a[0] as readonly (readonly [Address, Address])[]).map((p) => addr(p[1]));
    return { counterparties, counterparty: counterparties[0], amount: 0n };
  }],
};

/** Safe containers (banned too): decoded only so the classifier can look at the calls inside. */
const MAX_CONTAINER_DEPTH = 4;
const execAbi = parseAbi(['function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)']);
const multiSendAbi = parseAbi(['function multiSend(bytes)']);

/** One call a Safe makes (operation 1 = delegatecall: the target's code runs as the Safe). Undecodable inner data is skipped. */
function safeCall(to: Address, data: Hex, operation: number, depth: number): Decoded[] {
  const out: Decoded[] = [];
  if (operation === 1) out.push({ selector: SEL.safeExecTransaction, name: 'delegatecall (Safe)', recipients: [], paysCaller: false, nested: [], control: 'delegatecall', counterparty: getAddress(to) });
  if (depth < MAX_CONTAINER_DEPTH && data.length >= 10) {
    try {
      out.push(decodeCall(data, depth + 1));
    } catch {
      /* an ordinary call the classifier cannot read */
    }
  }
  return out;
}

/** MultiSend packs (uint8 operation, address to, uint256 value, uint256 length, bytes data) back to back. */
function multiSendCalls(packed: Hex, depth: number): Decoded[] {
  const h = packed.slice(2);
  const out: Decoded[] = [];
  let i = 0;
  while (i + 170 <= h.length) {
    const op = parseInt(h.slice(i, i + 2), 16);
    const to = `0x${h.slice(i + 2, i + 42)}` as Address;
    const len = Number(BigInt(`0x${h.slice(i + 106, i + 170)}`));
    if (!Number.isSafeInteger(len) || i + 170 + len * 2 > h.length) break;
    out.push(...safeCall(to, `0x${h.slice(i + 170, i + 170 + len * 2)}` as Hex, op, depth));
    i += 170 + len * 2;
  }
  return out;
}

function decodeWith(abi: Abi, data: Hex): { functionName: string; args: readonly unknown[] } {
  try {
    const r = decodeFunctionData({ abi, data });
    return { functionName: r.functionName, args: (r.args ?? []) as readonly unknown[] };
  } catch (e) {
    throw new DecodeError(`calldata for ${data.slice(0, 10)} could not be decoded: ${(e as Error).message.split('\n')[0]}`);
  }
}

const V4_NAMES = Object.fromEntries(Object.entries(V4_ACTIONS).map(([k, v]) => [v, k])) as Record<number, string>;

/** Why each v4 action outside the exit set is refused (plain words, shown to the user). */
function v4Forbidden(name: string): string {
  if (/^SETTLE|CLOSE_CURRENCY|INCREASE|MINT_POSITION|DONATE/.test(name)) {
    return `Uniswap v4 action ${name} can pull tokens from your wallet (through an existing Permit2 allowance). Exits never pay in.`;
  }
  if (/^SWAP/.test(name)) return `Uniswap v4 action ${name} swaps your tokens. Exits never swap.`;
  return `Uniswap v4 action ${name} can send tokens somewhere other than the exit's single payout to you. Exits use only TAKE_PAIR to your account.`;
}

const v4Param = (types: string, data: Hex, action: string) => {
  try {
    return decodeAbiParameters(parseAbiParameters(types), data);
  } catch {
    throw new DecodeError(`Uniswap v4 ${action} parameters could not be decoded`);
  }
};

/**
 * Uniswap v4 PositionManager.modifyLiquidities(abi.encode(bytes actions, bytes[] params), deadline).
 * Exit set: DECREASE_LIQUIDITY, BURN_POSITION, TAKE_PAIR (recipient pinned by the Guard).
 * Every other known action is forbidden with a reason; unknown codes or malformed data fail closed.
 */
function decodeV4(data: Hex, selector: Hex): Decoded {
  const { args } = decodeWith(v4PosmAbi, data);
  let actions: Hex;
  let params: readonly Hex[];
  try {
    [actions, params] = decodeAbiParameters(parseAbiParameters('bytes, bytes[]'), args[0] as Hex);
  } catch {
    throw new DecodeError('Uniswap v4 unlockData could not be decoded');
  }
  const codes = (actions.slice(2).match(/../g) ?? []).map((h) => parseInt(h, 16));
  if (codes.length === 0) throw new DecodeError('Uniswap v4 call has no actions');
  if (codes.length !== params.length) throw new DecodeError(`Uniswap v4 call has ${codes.length} actions but ${params.length} parameter blocks`);
  const recipients: Address[] = [];
  const nested: Decoded[] = [];
  codes.forEach((code, i) => {
    const name = V4_NAMES[code];
    if (!name) throw new DecodeError(`unknown Uniswap v4 action 0x${code.toString(16).padStart(2, '0')}`);
    const p = params[i]!;
    switch (code) {
      case V4_ACTIONS.DECREASE_LIQUIDITY:
      case V4_ACTIONS.BURN_POSITION: {
        const decoded = v4Param(code === V4_ACTIONS.BURN_POSITION ? 'uint256, uint128, uint128, bytes' : 'uint256, uint256, uint128, uint128, bytes', p, name);
        // hookData is passed to the pool's hook, which may take part of the withdrawal based on it. Exits send none.
        if (decoded[decoded.length - 1] !== '0x') {
          nested.push({ selector, name: `v4 ${name}`, recipients: [], paysCaller: false, nested: [], forbidden: `Uniswap v4 action ${name} carries hook data, which the pool's hook could use to take part of your withdrawal. Exits send no hook data.` });
        }
        return;
      }
      case V4_ACTIONS.TAKE_PAIR: {
        const [, , recipient] = v4Param('address, address, address', p, name);
        recipients.push(getAddress(recipient as Address));
        return;
      }
      default:
        nested.push({ selector, name: `v4 ${name}`, recipients: [], paysCaller: false, nested: [], forbidden: v4Forbidden(name) });
    }
  });
  return { selector, name: 'modifyLiquidities (Uniswap v4)', recipients, paysCaller: false, nested };
}

/**
 * Decode a call to a contract the manifest lists under `spec`, using only that kind's single exit function. The
 * calldata must re-encode to exactly the same bytes (no trailing data, no non-canonical words). Recipients are the
 * arguments the spec names in `recipient` and `self`; both must be the user. Banned selectors decode as banned (so
 * the reason names them); every other selector fails closed.
 */
export function decodeSpecCall(data: Hex, kind: ExitKind): Decoded {
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) throw new DecodeError('calldata is too short or not hex');
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  if (BANNED[selector]) return decodeCall(data);
  if (selector !== specExitSelector(kind)) throw new DecodeError(`${selector} is not the published exit ${kind.exit.fn} for ${kind.label}`);
  const abi = parseAbi([`function ${kind.exit.fn}`] as string[]) as Abi;
  const { functionName, args } = decodeWith(abi, data);
  if (encodeFunctionData({ abi, functionName, args }).toLowerCase() !== data.toLowerCase()) {
    throw new DecodeError(`calldata for ${kind.exit.fn} is not in canonical form`);
  }
  const recipients = [...kind.exit.recipient, ...kind.exit.self].map((i) => getAddress(args[i] as Address));
  return { selector, name: `${functionName} (${kind.label})`, recipients, paysCaller: kind.exit.paysCaller, nested: [] };
}

/** Decode a call the kit (or a pasted request) wants to send. Throws DecodeError on anything unknown. */
export function decodeCall(data: Hex, depth = 0): Decoded {
  if (typeof data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) {
    throw new DecodeError('calldata is too short or not hex');
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  const base = { selector, recipients: [] as Address[], paysCaller: false, nested: [] as Decoded[] };

  switch (selector) {
    case SEL.multicall: {
      if (depth >= MAX_MULTICALL_DEPTH) throw new DecodeError('multicall nested too deeply');
      const { args } = decodeWith(npmAbi, data);
      const inner = args[0] as readonly Hex[];
      return { ...base, name: 'multicall', batch: true, nested: inner.map((d) => decodeCall(d, depth + 1)) };
    }
    case SEL.decreaseLiquidity:
      decodeWith(npmAbi, data);
      return { ...base, name: 'decreaseLiquidity' };
    case SEL.collect: {
      const { args } = decodeWith(npmAbi, data);
      const p = args[0] as { recipient: Address };
      return { ...base, name: 'collect', recipients: [getAddress(p.recipient)] };
    }
    case SEL.aaveWithdraw: {
      const { args } = decodeWith(aavePoolAbi, data);
      return { ...base, name: 'withdraw', recipients: [getAddress(args[2] as Address)] };
    }
    case SEL.curveRemoveLiquidity:
      decodeWith(curve3poolAbi, data);
      return { ...base, name: 'remove_liquidity', paysCaller: true };
    case SEL.v4ModifyLiquidities:
      return decodeV4(data, selector);
  }

  if (selector === SEL.safeExecTransaction || selector === SEL.safeMultiSend) {
    // Banned like every other non-exit; the calls inside are decoded for the classifier only.
    const name = selector === SEL.safeExecTransaction ? 'execTransaction (Safe)' : 'multiSend (Safe)';
    try {
      if (selector === SEL.safeExecTransaction) {
        const { args } = decodeWith(execAbi, data);
        return { ...base, name, nested: safeCall(args[0] as Address, args[2] as Hex, Number(args[3]), depth) };
      }
      const { args } = decodeWith(multiSendAbi, data);
      return { ...base, name, batch: true, nested: depth < MAX_CONTAINER_DEPTH ? multiSendCalls(args[0] as Hex, depth + 1) : [] };
    } catch {
      return { ...base, name };
    }
  }

  const banned = BANNED[selector];
  if (banned) {
    const [name, fragment, idx, extra] = banned;
    let counterparty: Address | undefined;
    let more: Partial<Decoded> = {};
    try {
      const { args } = decodeWith(parseAbi([fragment]), data);
      if (idx >= 0) counterparty = getAddress(args[idx] as Address);
      else if (selector === SEL.permit2PermitSingle || selector === SEL.permit2PermitBatch) {
        // permit(owner, (details, spender, sigDeadline), signature): the spender sits inside the struct.
        const s = args[1] as readonly unknown[];
        counterparty = getAddress(s[1] as Address);
        const details = (selector === SEL.permit2PermitSingle ? [s[0]] : s[0]) as readonly (readonly unknown[])[];
        more.amount = details.reduce<bigint>((m, d) => (big(d[1])! > m ? big(d[1])! : m), 0n);
      }
      if (extra) more = { ...more, ...extra(args) };
    } catch {
      /* name alone is enough to reject */
    }
    return { ...base, name, counterparty, ...more };
  }

  throw new DecodeError(`unknown selector ${selector}`);
}
