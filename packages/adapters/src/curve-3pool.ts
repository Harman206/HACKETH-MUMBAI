import { encodeFunctionData } from 'viem';
import { curve3poolAbi, erc20Abi, type Address, type ExitPlan } from '@copeybara/core';
import { applySlippage, target, type Ctx, type ExitAdapter } from './types';

export interface CurveRaw {
  pool: Address;
  lp: Address;
  balance: bigint;
  coins: [Address, Address, Address];
}

const entries = (ctx: Ctx) => ({ pool: target(ctx, 'curve-3pool', 'pool')?.address, lp: target(ctx, 'curve-3pool', 'lpToken')?.address });

export const curve3pool: ExitAdapter = {
  id: 'curve-3pool',

  /** 3CRV held directly by the wallet. Gauge-staked LP is out of scope. */
  async discover(user, ctx) {
    const { pool, lp } = entries(ctx);
    if (!pool || !lp) return [];
    const balance = await ctx.q.read({ address: lp, abi: erc20Abi, functionName: 'balanceOf', args: [user] }, ctx.block);
    if (balance === 0n) return [];
    const coins = (await Promise.all(
      [0n, 1n, 2n].map((i) => ctx.q.read({ address: pool, abi: curve3poolAbi, functionName: 'coins', args: [i] }, ctx.block)),
    )) as CurveRaw['coins'];
    return [{ adapter: 'curve-3pool', id: `curve-3pool:${lp}`, label: 'Curve 3pool LP (DAI/USDC/USDT)', tokens: [...coins], raw: { pool, lp, balance, coins } satisfies CurveRaw }];
  },

  /**
   * remove_liquidity(balance, mins), paid to msg.sender (the Guard pins caller = account).
   * Balanced removal has no fee: out_i = balances(i) × amount / totalSupply, exactly as the pool computes it.
   */
  async buildExit(pos, ctx): Promise<ExitPlan> {
    const r = pos.raw as CurveRaw;
    const [supply, ...bals] = await Promise.all([
      ctx.q.read({ address: r.lp, abi: erc20Abi, functionName: 'totalSupply' }, ctx.block),
      ...[0n, 1n, 2n].map((i) => ctx.q.read({ address: r.pool, abi: curve3poolAbi, functionName: 'balances', args: [i] }, ctx.block)),
    ]);
    const outs = bals.map((b) => (b * r.balance) / supply);
    const mins = outs.map((o) => applySlippage(o, ctx.slippageBps)) as [bigint, bigint, bigint];
    const data = encodeFunctionData({ abi: curve3poolAbi, functionName: 'remove_liquidity', args: [r.balance, mins] });
    await ctx.q.call({ to: r.pool, from: ctx.account, data }, ctx.block); // reverts → CallRevertedError
    return {
      position: pos,
      calls: [{ chainId: ctx.chainId, from: ctx.account, to: r.pool, data, value: 0n }],
      expected: r.coins.map((token, i) => ({ token, min: mins[i]! })).filter((_, i) => outs[i]! > 0n),
      preview: r.coins.map((token, i) => ({ token, amount: outs[i]! })).filter((e) => e.amount > 0n),
    };
  },
};
