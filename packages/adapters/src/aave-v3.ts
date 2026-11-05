import { decodeFunctionResult, encodeFunctionData, maxUint256 } from 'viem';
import { aavePoolAbi, erc20Abi, type Address, type ExitPlan, type Position } from '@blackout/core';
import { applySlippage, target, type Ctx, type ExitAdapter } from './types';
import { symbolOf } from './symbols';
import { mapLimit } from './limit';

export interface AaveRaw {
  asset: Address;
  aToken: Address;
  balance: bigint;
}

export const DEBT_NOTE =
  'Has debt: repaying it needs a token approval, which this kit never asks for. Repay elsewhere first, then exit here.';

function pool(ctx: Ctx): Address | undefined {
  return target(ctx, 'aave-v3', 'pool')?.address;
}

export const aaveV3: ExitAdapter = {
  id: 'aave-v3',

  /** Supply positions: every reserve whose aToken balance is > 0. Any debt flags all of them "manual". */
  async discover(user, ctx) {
    const address = pool(ctx);
    if (!address) return [];
    const [reserves, account] = await Promise.all([
      ctx.q.read({ address, abi: aavePoolAbi, functionName: 'getReservesList' }, ctx.block),
      ctx.q.read({ address, abi: aavePoolAbi, functionName: 'getUserAccountData', args: [user] }, ctx.block),
    ]);
    const hasDebt = account[1] > 0n;
    const held = await mapLimit(reserves, 8, async (asset) => {
      const data = await ctx.q.read({ address, abi: aavePoolAbi, functionName: 'getReserveData', args: [asset] }, ctx.block);
      const aToken = data.aTokenAddress;
      const balance = await ctx.q.read({ address: aToken, abi: erc20Abi, functionName: 'balanceOf', args: [user] }, ctx.block);
      return { asset, aToken, balance };
    });
    const out: Position[] = [];
    for (const { asset, aToken, balance } of held) {
      if (balance === 0n) continue;
      const raw: AaveRaw = { asset, aToken, balance };
      out.push({
        adapter: 'aave-v3',
        id: `aave-v3:${asset}`,
        label: `Aave v3 supplied ${await symbolOf(asset, ctx)}`,
        tokens: [asset],
        ...(hasDebt ? { manual: DEBT_NOTE } : {}),
        raw,
      });
    }
    return out;
  },

  /** Pool.withdraw(asset, type(uint256).max, user). Min = simulated withdrawn amount − slippage. */
  async buildExit(pos, ctx): Promise<ExitPlan> {
    if (pos.manual) return { position: pos, calls: [], expected: [] };
    const address = pool(ctx);
    if (!address) throw new Error(`Aave v3 is not listed in the manifest for chain ${ctx.chainId}.`);
    const r = pos.raw as AaveRaw;
    const data = encodeFunctionData({ abi: aavePoolAbi, functionName: 'withdraw', args: [r.asset, maxUint256, ctx.account] });
    const sim = await ctx.q.call({ to: address, from: ctx.account, data }, ctx.block);
    const amount = decodeFunctionResult({ abi: aavePoolAbi, functionName: 'withdraw', data: sim });
    return {
      position: pos,
      calls: [{ chainId: ctx.chainId, from: ctx.account, to: address, data, value: 0n }],
      expected: amount > 0n ? [{ token: r.asset, min: applySlippage(amount, ctx.slippageBps) }] : [],
    };
  },
};
