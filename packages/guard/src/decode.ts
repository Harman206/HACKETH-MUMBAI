import { decodeFunctionData, getAddress, parseAbi, type Abi } from 'viem';
import { aavePoolAbi, curve3poolAbi, npmAbi, SEL, SIGS, type Address, type Hex } from '@blackout/core';

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
