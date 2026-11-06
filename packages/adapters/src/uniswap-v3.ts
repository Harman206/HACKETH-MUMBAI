import { decodeFunctionResult, encodeFunctionData, maxUint128, type Hex } from 'viem';
import { npmAbi, type Address, type ExitPlan, type Position, type TxRequest } from '@copeybara/core';
import { applySlippage, target, type Ctx, type ExitAdapter } from './types';
import { symbolOf } from './symbols';

export interface UniswapRaw {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  fee: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

const DEADLINE_SEC = 1200;

function npm(ctx: Ctx): Address | undefined {
  return target(ctx, 'uniswap-v3', 'positionManager')?.address;
}

const collectData = (tokenId: bigint, recipient: Address): Hex =>
  encodeFunctionData({ abi: npmAbi, functionName: 'collect', args: [{ tokenId, recipient, amount0Max: maxUint128, amount1Max: maxUint128 }] });

const decreaseData = (tokenId: bigint, liquidity: bigint, min0: bigint, min1: bigint, deadline: bigint): Hex =>
  encodeFunctionData({ abi: npmAbi, functionName: 'decreaseLiquidity', args: [{ tokenId, liquidity, amount0Min: min0, amount1Min: min1, deadline }] });

const multicallData = (calls: Hex[]): Hex => encodeFunctionData({ abi: npmAbi, functionName: 'multicall', args: [calls] });

export const uniswapV3: ExitAdapter = {
  id: 'uniswap-v3',

  /** NFT positions held directly by the wallet: balanceOf → tokenOfOwnerByIndex → positions. */
  async discover(user, ctx) {
    const address = npm(ctx);
    if (!address) return [];
    const n = await ctx.q.read({ address, abi: npmAbi, functionName: 'balanceOf', args: [user] }, ctx.block);
    const out: Position[] = [];
    for (let i = 0n; i < n; i++) {
      const tokenId = await ctx.q.read({ address, abi: npmAbi, functionName: 'tokenOfOwnerByIndex', args: [user, i] }, ctx.block);
      const p = await ctx.q.read({ address, abi: npmAbi, functionName: 'positions', args: [tokenId] }, ctx.block);
      const [, , token0, token1, fee, , , liquidity, , , tokensOwed0, tokensOwed1] = p;
      if (liquidity === 0n && tokensOwed0 === 0n && tokensOwed1 === 0n) continue;
      const [s0, s1] = await Promise.all([symbolOf(token0, ctx), symbolOf(token1, ctx)]);
      const raw: UniswapRaw = { tokenId, token0, token1, fee, liquidity, tokensOwed0, tokensOwed1 };
      out.push({
        adapter: 'uniswap-v3',
        id: tokenId.toString(),
        label: `Uniswap v3 #${tokenId} ${s0}/${s1} ${fee / 10_000}%`,
        tokens: [token0, token1],
        raw,
      });
    }
    return out;
  },

  /**
   * liquidity > 0: multicall[decreaseLiquidity(min from simulation), collect(to user)].
   * liquidity = 0 (owed only): collect alone — decreaseLiquidity(0) reverts.
   * Expected deltas list only tokens with a simulated amount > 0.
   */
  async buildExit(pos, ctx): Promise<ExitPlan> {
    const address = npm(ctx);
    if (!address) throw new Error(`Uniswap v3 is not listed in the manifest for chain ${ctx.chainId}.`);
    const r = pos.raw as UniswapRaw;
    const user = ctx.account;
    const deadline = BigInt(ctx.nowSec() + DEADLINE_SEC);
    const tx = (data: Hex): TxRequest => ({ chainId: ctx.chainId, from: user, to: address, data, value: 0n });

    let data: Hex;
    let out0: bigint;
    let out1: bigint;
    if (r.liquidity > 0n) {
      const sim = await ctx.q.call(
        { to: address, from: user, data: multicallData([decreaseData(r.tokenId, r.liquidity, 0n, 0n, deadline), collectData(r.tokenId, user)]) },
        ctx.block,
      );
      const [decRes, colRes] = decodeFunctionResult({ abi: npmAbi, functionName: 'multicall', data: sim });
      const [dec0, dec1] = decodeFunctionResult({ abi: npmAbi, functionName: 'decreaseLiquidity', data: decRes! });
      [out0, out1] = decodeFunctionResult({ abi: npmAbi, functionName: 'collect', data: colRes! });
      data = multicallData([
        decreaseData(r.tokenId, r.liquidity, applySlippage(dec0, ctx.slippageBps), applySlippage(dec1, ctx.slippageBps), deadline),
        collectData(r.tokenId, user),
      ]);
    } else {
      data = collectData(r.tokenId, user);
      const sim = await ctx.q.call({ to: address, from: user, data }, ctx.block);
      [out0, out1] = decodeFunctionResult({ abi: npmAbi, functionName: 'collect', data: sim });
    }

    const expected = [
      { token: r.token0, amount: out0 },
      { token: r.token1, amount: out1 },
    ]
      .filter((e) => e.amount > 0n)
      .map((e) => ({ token: e.token, min: applySlippage(e.amount, ctx.slippageBps) }));
    const preview = [
      { token: r.token0, amount: out0 },
      { token: r.token1, amount: out1 },
    ].filter((e) => e.amount > 0n);
    return { position: pos, calls: [tx(data)], expected, preview };
  },
};
