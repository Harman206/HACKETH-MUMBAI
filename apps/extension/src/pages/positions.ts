/**
 * Auto-detect the watched wallet's positions in every followed protocol (dashboard). Read-only: the same adapters
 * and 3-RPC quorum the exit kit uses, at one pinned block. Exiting happens in the kit, never here.
 */
import { erc20Abi, formatUnits } from 'viem';
import { ADAPTERS, type Ctx } from '@copeybara/adapters';
import type { Address, Position } from '@copeybara/core';
import { createQuorum } from '@copeybara/quorum';
import networks from '../../../../config/networks.json';
import type { ProtocolState, Settings } from '../shared/types';

export interface FoundPosition {
  protocol: string;
  position: Position;
  amounts: { symbol: string; text: string }[];
}
export interface Scan {
  found: FoundPosition[];
  errors: string[];
  block: bigint | null;
}

export const rpcList = (s: Settings) => [...(s.useDefaultRpcs ? (networks.defaultRpcs as Record<string, string[]>)['11155111']! : []), ...s.userRpcs];

export async function scanPositions(settings: Settings, protocols: ProtocolState[]): Promise<Scan> {
  const account = settings.account;
  if (!account) return { found: [], errors: ['No wallet address yet.'], block: null };
  const q = createQuorum({ urls: rpcList(settings), expectedChainId: 11155111, timeoutMs: 8000 });
  const block = await q.pinBlock();
  const found: FoundPosition[] = [];
  const errors: string[] = [];
  const meta = new Map<string, { symbol: string; decimals: number }>();
  const tokenMeta = async (t: Address) => {
    if (!meta.has(t)) {
      try {
        const [symbol, decimals] = await Promise.all([
          q.read({ address: t, abi: erc20Abi, functionName: 'symbol' }, block),
          q.read({ address: t, abi: erc20Abi, functionName: 'decimals' }, block),
        ]);
        meta.set(t, { symbol: /^[\x20-\x7e]{1,16}$/.test(symbol) ? symbol : `${t.slice(0, 6)}…`, decimals: Number(decimals) });
      } catch {
        meta.set(t, { symbol: `${t.slice(0, 6)}…`, decimals: 18 });
      }
    }
    return meta.get(t)!;
  };
  for (const p of protocols) {
    const manifest = p.snapshot?.manifest;
    if (!manifest?.chains['11155111']) continue;
    const ctx: Ctx = { q, chainId: 11155111, manifest, block, account, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
    const settled = await Promise.allSettled(ADAPTERS.map((a) => a.discover(account, ctx).then((ps) => ps.map((pos) => ({ a, pos })))));
    for (const [i, r] of settled.entries()) {
      if (r.status === 'rejected') {
        errors.push(`${p.name} · ${ADAPTERS[i]!.id}: ${(r.reason as Error)?.message ?? r.reason}`);
        continue;
      }
      for (const { a, pos } of r.value) {
        const amounts: FoundPosition['amounts'] = [];
        if (!pos.manual) {
          const plan = await a.buildExit(pos, ctx).catch(() => null);
          for (const e of plan?.preview ?? []) {
            const m = await tokenMeta(e.token);
            amounts.push({ symbol: m.symbol, text: Number(formatUnits(e.amount, m.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 }) });
          }
        }
        found.push({ protocol: p.name, position: pos, amounts });
      }
    }
  }
  return { found, errors, block };
}
