import type { Address, AdapterId, ExitPlan, Manifest, Position, TargetEntry } from '@blackout/core';
import type { Quorum } from '@blackout/quorum';

/** Everything an adapter may use. Addresses come only from `manifest`; reads only through `q` at `block`. */
export interface Ctx {
  q: Quorum;
  chainId: number;
  manifest: Manifest;
  block: bigint;
  account: Address;
  slippageBps: number;
  nowSec: () => number;
}

export interface ExitAdapter {
  id: AdapterId;
  discover(user: Address, ctx: Ctx): Promise<Position[]>;
  buildExit(pos: Position, ctx: Ctx): Promise<ExitPlan>;
  /** For protocols whose positions cannot all be discovered (v4 NFTs): load one by id, only if `user` owns it. */
  byId?(id: string, user: Address, ctx: Ctx): Promise<Position>;
}

/** amount × (10000 − bps) / 10000, floored. */
export function applySlippage(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new RangeError(`slippage ${bps} bps out of range`);
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

/** The manifest entry for (adapter, role) on ctx.chainId, or undefined when the protocol is not listed there. */
export function target(ctx: Ctx, adapter: AdapterId, role: string): TargetEntry | undefined {
  return ctx.manifest.chains[String(ctx.chainId)]?.[adapter]?.[role];
}
