import { erc20Abi, type Address } from '@copeybara/core';
import type { Quorum } from '@copeybara/quorum';

export type TokenMeta = Record<Address, { symbol: string; decimals: number }>;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Symbols/decimals for display. Failures fall back (short address, 18) — never block an exit. */
export async function tokenMeta(q: Quorum, tokens: Address[], block: bigint): Promise<TokenMeta> {
  const out: TokenMeta = {};
  await Promise.all(
    [...new Set(tokens)].map(async (t) => {
      try {
        const [symbol, decimals] = await Promise.all([
          q.read({ address: t, abi: erc20Abi, functionName: 'symbol' }, block),
          q.read({ address: t, abi: erc20Abi, functionName: 'decimals' }, block),
        ]);
        out[t] = { symbol: /^[\x20-\x7e]{1,16}$/.test(symbol) ? symbol : short(t), decimals: Number(decimals) };
      } catch {
        out[t] = { symbol: short(t), decimals: 18 };
      }
    }),
  );
  return out;
}

/** 1234567890000000000000n, 18 → "1,234.5679" (≤ 4 decimals, trailing zeros trimmed). */
export function formatAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return '0';
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const frac4 = ((amount % scale) * 10_000n + scale / 2n) / scale; // rounded to 4 dp
  const w = whole + frac4 / 10_000n;
  const f = (frac4 % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  if (w === 0n && !f) return '<0.0001';
  return `${w.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
}
