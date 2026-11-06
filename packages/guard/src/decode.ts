import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, parseAbiParameters, type Abi } from 'viem';
import { aavePoolAbi, curve3poolAbi, npmAbi, SEL, SIGS, V4_ACTIONS, v4PosmAbi, type Address, type Hex } from '@blackout/core';

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
}

export class DecodeError extends Error {
  override name = 'DecodeError';
}

const MAX_MULTICALL_DEPTH = 2;

/** Banned selectors → [human name, ABI fragment, index of counterparty arg or -1]. */
const BANNED: Record<Hex, [string, string, number]> = {
  [SEL.approve]: ['approve', 'function approve(address,uint256)', 0],
  [SEL.increaseAllowance]: ['increaseAllowance', 'function increaseAllowance(address,uint256)', 0],
  [SEL.permit2612]: ['permit', 'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)', 1],
  [SEL.permitDai]: ['permit (DAI)', 'function permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)', 1],
  [SEL.permit721]: ['permit (NFT)', 'function permit(address,uint256,uint256,uint8,bytes32,bytes32)', 0],
  [SEL.setApprovalForAll]: ['setApprovalForAll', 'function setApprovalForAll(address,bool)', 0],
  [SEL.transfer]: ['transfer', 'function transfer(address,uint256)', 0],
  [SEL.transferFrom]: ['transferFrom', 'function transferFrom(address,address,uint256)', 1],
  [SEL.safeTransferFrom]: ['safeTransferFrom', 'function safeTransferFrom(address,address,uint256)', 1],
  [SEL.safeTransferFromData]: ['safeTransferFrom', 'function safeTransferFrom(address,address,uint256,bytes)', 1],
  [SEL.permit2Approve]: ['Permit2 approve', 'function approve(address,address,uint160,uint48)', 1],
  [SEL.permit2PermitSingle]: ['Permit2 permit', `function ${SIGS.banned[11]}`, -1],
  [SEL.permit2PermitBatch]: ['Permit2 permit', `function ${SIGS.banned[12]}`, -1],
  [SEL.permit2TransferFrom]: ['Permit2 permitTransferFrom', `function ${SIGS.banned[13]}`, -1],
  [SEL.permit2WitnessTransferFrom]: ['Permit2 permitWitnessTransferFrom', `function ${SIGS.banned[14]}`, -1],
};

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
      return { ...base, name: 'multicall', nested: inner.map((d) => decodeCall(d, depth + 1)) };
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

  const banned = BANNED[selector];
  if (banned) {
    const [name, fragment, idx] = banned;
    let counterparty: Address | undefined;
    if (idx >= 0) {
      try {
        const { args } = decodeWith(parseAbi([fragment]), data);
        counterparty = getAddress(args[idx] as Address);
      } catch {
        /* name alone is enough to reject */
      }
    }
    return { ...base, name, counterparty };
  }

  throw new DecodeError(`unknown selector ${selector}`);
}
