import { encodeAbiParameters, encodeFunctionData, maxUint128, maxUint160, maxUint256, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from 'viem';
import { V4_ACTIONS, v4PosmAbi, v4StateViewAbi } from '@copeybara/core';
import { poolIdOf, type PoolKey } from '@copeybara/adapters';
import type { Fork } from '@copeybara/testkit';

/** Uniswap v4 on Sepolia (also present on a Sepolia fork). */
const POSM: Address = '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4';
const POOL_MANAGER: Address = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';
const STATE_VIEW: Address = '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24)',
]);
const permit2Abi = parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']);

/** Mints one in-range v4 position (paid by `owner`, who holds both tokens) and returns its token id. */
export async function seedV4(fork: Fork, owner: Address, tokenA: Address, tokenB: Address): Promise<bigint> {
  const send = async (to: Address, data: Hex) => {
    const hash = await fork.wallet(owner).sendTransaction({ to, data, chain: fork.chain, account: owner, gas: 3_000_000n });
    const r = await fork.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`v4 seed tx to ${to} reverted`);
    return r;
  };
  const [c0, c1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const key: PoolKey = { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' };
  for (const t of [c0, c1]) {
    await send(t, encodeFunctionData({ abi, functionName: 'approve', args: [PERMIT2, maxUint256] }));
    await send(PERMIT2, encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [t, POSM, maxUint160, 2 ** 48 - 1] }));
  }
  const [sqrt] = await fork.publicClient.readContract({ address: STATE_VIEW, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolIdOf(key)] });
  if (sqrt === 0n) await send(POOL_MANAGER, encodeFunctionData({ abi, functionName: 'initialize', args: [key, 2n ** 96n] }));
  const mint = encodeAbiParameters(parseAbiParameters('(address,address,uint24,int24,address), int24, int24, uint256, uint128, uint128, address, bytes'), [
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], -600, 600, 10n ** 21n, maxUint128, maxUint128, owner, '0x',
  ]);
  const settle = encodeAbiParameters(parseAbiParameters('address, address'), [key.currency0, key.currency1]);
  const unlock = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [toHex(Uint8Array.from([V4_ACTIONS.MINT_POSITION, V4_ACTIONS.SETTLE_PAIR])), [mint, settle]]);
  const r = await send(POSM, encodeFunctionData({ abi: v4PosmAbi, functionName: 'modifyLiquidities', args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] }));
  const t = r.logs.find((l) => l.address.toLowerCase() === POSM.toLowerCase() && l.topics.length === 4);
  return BigInt(t!.topics[3]!);
}
