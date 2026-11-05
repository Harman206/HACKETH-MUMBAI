import { encodeFunctionData, getAddress, maxUint128, parseAbi } from 'viem';
import { npmAbi, aavePoolAbi, curve3poolAbi, type Address, type Hex } from '@blackout/core';

export const USER: Address = '0x1111111111111111111111111111111111111111';
export const ATTACKER: Address = getAddress('0xbadbadbadbadbadbadbadbadbadbadbadbadbad0');

export const decreaseData = (tokenId = 1n, liquidity = 1000n): Hex =>
  encodeFunctionData({
    abi: npmAbi,
    functionName: 'decreaseLiquidity',
    args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline: 2_000_000_000n }],
  });

export const collectData = (recipient: Address = USER, tokenId = 1n): Hex =>
  encodeFunctionData({
    abi: npmAbi,
    functionName: 'collect',
    args: [{ tokenId, recipient, amount0Max: maxUint128, amount1Max: maxUint128 }],
  });

export const multicallData = (calls: Hex[]): Hex =>
  encodeFunctionData({ abi: npmAbi, functionName: 'multicall', args: [calls] });

export const aaveWithdrawData = (to: Address = USER, asset: Address = '0x2222222222222222222222222222222222222222'): Hex =>
  encodeFunctionData({ abi: aavePoolAbi, functionName: 'withdraw', args: [asset, 2n ** 256n - 1n, to] });

export const curveRemoveData = (amount = 10n ** 18n): Hex =>
  encodeFunctionData({ abi: curve3poolAbi, functionName: 'remove_liquidity', args: [amount, [0n, 0n, 0n]] });

export const approveData = (spender: Address = ATTACKER, amount = 2n ** 256n - 1n): Hex =>
  encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [spender, amount] });
