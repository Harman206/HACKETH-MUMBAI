import type { ExitResult } from '@copeybara/exec';
import { formatAmount, type TokenMeta } from './tokens';

/** The "Saved by Copey!" line after Recovered exits: what came back, summed per token. */
export function savedLine(results: Pick<ExitResult, 'deltas'>[], meta: TokenMeta): string {
  const sum = new Map<string, bigint>();
  for (const r of results) for (const d of r.deltas) if (d.after > d.before) sum.set(d.token, (sum.get(d.token) ?? 0n) + (d.after - d.before));
  const parts = [...sum].map(([t, a]) => `${formatAmount(a, meta[t as `0x${string}`]?.decimals ?? 18)} ${meta[t as `0x${string}`]?.symbol ?? `${t.slice(0, 6)}…${t.slice(-4)}`}`);
  const n = results.length === 1 ? 'Your position' : `${results.length} positions`;
  return parts.length > 0 ? `You got ${parts.join(' + ')} back, straight from the contracts.` : `${n} came back to your wallet, straight from the contracts.`;
}
