import { isAddress } from 'viem';
import type { Address, Hex, Manifest } from '@blackout/core';
import { explain, guard, type GuardCtx } from '@blackout/guard';

export interface PastedTx {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
}

export interface CheckResult {
  verdict: 'safe-exit' | 'blocked';
  sentences: string[];
}

/** Accepts wallet-style JSON (`{from,to,data|input,value}` or `[{…}]`) or bare calldata hex. */
export function parsePasted(text: string): PastedTx {
  const t = text.trim();
  if (/^0x[0-9a-fA-F]*$/.test(t)) return { data: t };
  try {
    let j = JSON.parse(t);
    if (Array.isArray(j)) j = j[0];
    if (j && typeof j === 'object') {
      const out: PastedTx = {};
      for (const k of ['from', 'to', 'value'] as const) if (typeof j[k] === 'string') out[k] = j[k];
      const data = typeof j.data === 'string' ? j.data : typeof j.input === 'string' ? j.input : undefined;
      if (data) out.data = data;
      return out;
    }
  } catch {
    /* fall through */
  }
  return { data: t };
}

function parseValue(v: string | undefined): bigint | null {
  if (v === undefined || v.trim() === '') return 0n;
  try {
    return BigInt(v.trim());
  } catch {
    return null;
  }
}

/**
 * The Exit Guard as a stand-alone checker: paste what a (possibly hijacked) site asks you to sign.
 * Always fail-closed; never throws.
 */
export function checkPasted(input: { to: string; data: string; value?: string; from?: string; chainId: number }, ctx: GuardCtx): CheckResult {
  const blocked = (s: string): CheckResult => ({ verdict: 'blocked', sentences: [s] });
  if (!isAddress(input.to ?? '', { strict: false })) return blocked('The "to" address is missing or not a valid address, so this cannot be checked.');
  if (!/^0x[0-9a-fA-F]*$/.test(input.data ?? '')) return blocked('This transaction could not be decoded, so it is blocked (the data is not hex).');
  const value = parseValue(input.value);
  if (value === null) return blocked('The ETH value is not a number, so this is blocked.');
  const from = (input.from && isAddress(input.from, { strict: false }) ? input.from : ctx.account) as Address;
  const r = guard({ chainId: input.chainId, from, to: input.to as Address, data: input.data as Hex, value }, ctx);
  const sentences = explain(r);
  if (from.toLowerCase() !== ctx.account.toLowerCase()) {
    return { verdict: 'blocked', sentences: [`This request is for ${from.slice(0, 6)}…${from.slice(-4)}, not your address.`, ...(r.ok ? [] : sentences)] };
  }
  return { verdict: r.ok ? 'safe-exit' : 'blocked', sentences };
}

/**
 * What the Check screen calls. The account checked is ONLY the address the user typed (or their connected wallet):
 * a pasted `from` is attacker-controlled and is never used as "you".
 */
export function checkPastedText(input: { text: string; to: string; account: string; chainId: number; manifest: Manifest }): CheckResult {
  if (!isAddress(input.account.trim(), { strict: false })) {
    return { verdict: 'blocked', sentences: ['Enter your address first: the check compares where the funds would go with your own address.'] };
  }
  const p = parsePasted(input.text);
  const account = input.account.trim() as Address;
  return checkPasted({ to: p.to ?? input.to, data: p.data ?? '', value: p.value, from: p.from, chainId: input.chainId }, { account, chainId: input.chainId, manifest: input.manifest });
}

export interface SiteCheck {
  verdict: 'match' | 'mismatch' | 'unset';
  sha256: string;
}

/** Hijack detection: sha256 of the live site's main bundle vs the Safe-published org.blackout.site record. */
export async function siteHashCheck(bundleText: string, record: string | null): Promise<SiteCheck> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(bundleText));
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!record) return { verdict: 'unset', sha256 };
  const want = record.trim().toLowerCase().replace(/^sha256:/, '');
  return { verdict: want === sha256 ? 'match' : 'mismatch', sha256 };
}
