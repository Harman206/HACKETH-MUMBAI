import { erc20Abi, type Address } from '@copeybara/core';
import type { Ctx } from './types';

const short = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Best-effort token symbol for labels. Some tokens (MKR) return bytes32; fall back to a short address. */
export async function symbolOf(token: Address, ctx: Ctx): Promise<string> {
  try {
    const s = await ctx.q.read({ address: token, abi: erc20Abi, functionName: 'symbol' }, ctx.block);
    return /^[\x20-\x7e]{1,16}$/.test(s) ? s : short(token);
  } catch {
    return short(token);
  }
}
