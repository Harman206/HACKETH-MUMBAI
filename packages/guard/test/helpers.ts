import { encodeAbiParameters, encodeFunctionData, getAddress, maxUint128, parseAbi, parseAbiParameters, toHex } from 'viem';
import { npmAbi, aavePoolAbi, curve3poolAbi, v4PosmAbi, V4_ACTIONS, type Address, type Hex } from '@copeybara/core';

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

// ---- Uniswap v4 PositionManager.modifyLiquidities(abi.encode(bytes actions, bytes[] params), deadline)
export const T0: Address = '0x00000000000000000000000000000000000000a0';
export const T1: Address = '0x00000000000000000000000000000000000000a1';
export const v4 = {
  decrease: (tokenId = 7n, liquidity = 1000n, min0 = 0n, min1 = 0n, hookData: Hex = '0x'): Hex =>
    encodeAbiParameters(parseAbiParameters('uint256, uint256, uint128, uint128, bytes'), [tokenId, liquidity, min0, min1, hookData]),
  burn: (tokenId = 7n): Hex => encodeAbiParameters(parseAbiParameters('uint256, uint128, uint128, bytes'), [tokenId, 0n, 0n, '0x']),
  burnWithHook: (hookData: Hex): Hex => encodeAbiParameters(parseAbiParameters('uint256, uint128, uint128, bytes'), [7n, 0n, 0n, hookData]),
  takePair: (recipient: Address = USER, c0: Address = T0, c1: Address = T1): Hex =>
    encodeAbiParameters(parseAbiParameters('address, address, address'), [c0, c1, recipient]),
  settlePair: (c0: Address = T0, c1: Address = T1): Hex => encodeAbiParameters(parseAbiParameters('address, address'), [c0, c1]),
  sweep: (to: Address = ATTACKER, c: Address = T0): Hex => encodeAbiParameters(parseAbiParameters('address, address'), [c, to]),
  take: (to: Address = ATTACKER, c: Address = T0): Hex => encodeAbiParameters(parseAbiParameters('address, address, uint256'), [c, to, 0n]),
  mint: (owner: Address = ATTACKER): Hex =>
    encodeAbiParameters(parseAbiParameters('(address,address,uint24,int24,address), int24, int24, uint256, uint128, uint128, address, bytes'), [
      [T0, T1, 3000, 60, '0x0000000000000000000000000000000000000000'], -60, 60, 1n, 1n, 1n, owner, '0x',
    ]),
  /** Raw unlockData; `actions` may disagree with `params` length on purpose. */
  unlock: (actions: number[], params: Hex[]): Hex =>
    encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [toHex(Uint8Array.from(actions)), params]),
  call: (actions: number[], params: Hex[], deadline = 2_000_000_000n): Hex =>
    encodeFunctionData({ abi: v4PosmAbi, functionName: 'modifyLiquidities', args: [v4.unlock(actions, params), deadline] }),
  exit: (recipient: Address = USER): Hex =>
    v4.call([V4_ACTIONS.DECREASE_LIQUIDITY, V4_ACTIONS.TAKE_PAIR], [v4.decrease(), v4.takePair(recipient)]),
};
