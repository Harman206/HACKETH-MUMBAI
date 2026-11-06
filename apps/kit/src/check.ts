import { normaliseBundle, scriptHash } from '@copeybara/sitecheck';
import { isAddress } from 'viem';
import type { Address, Hex, Manifest } from '@copeybara/core';
import { classifyRequest, explain, guard, type GuardCtx } from '@copeybara/guard';

export interface PastedTx {
  chainId?: number;
  from?: string;
  to?: string;
  data?: string;
  value?: string;
}

export interface CheckResult {
  /** safe-exit: the Guard would send it · not-exit: the kit would refuse it, but it is not a drainer pattern ·
   *  dangerous: approvals, permits, transfers or payouts to someone else */
  verdict: 'safe-exit' | 'not-exit' | 'dangerous';
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
      if (typeof j.chainId === 'string' || typeof j.chainId === 'number') {
        const c = Number(j.chainId);
        if (Number.isSafeInteger(c) && c > 0) out.chainId = c;
      }
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
  const blocked = (s: string): CheckResult => ({ verdict: 'not-exit', sentences: [s] });
  if (!isAddress(input.to ?? '', { strict: false })) return blocked('The "to" address is missing or not a valid address, so this cannot be checked.');
  if (!/^0x[0-9a-fA-F]*$/.test(input.data ?? '')) return blocked('This transaction could not be decoded, so it is blocked (the data is not hex).');
  const value = parseValue(input.value);
  if (value === null) return blocked('The ETH value is not a number, so this is blocked.');
  const from = (input.from && isAddress(input.from, { strict: false }) ? input.from : ctx.account) as Address;
  const r = guard({ chainId: input.chainId, from, to: input.to as Address, data: input.data as Hex, value }, ctx);
  const sentences = explain(r);
  const notYou = from.toLowerCase() !== ctx.account.toLowerCase();
  if (r.ok && !notYou) return { verdict: 'safe-exit', sentences };
  // Not an exit. Is it one of the drainer patterns, or just some other transaction?
  const c = classifyRequest(
    { method: 'eth_sendTransaction', params: [{ from: ctx.account, to: input.to, data: input.data, value: `0x${value.toString(16)}` }] },
    { account: ctx.account, chainId: input.chainId, manifests: [{ name: 'this protocol', manifest: ctx.manifest }] },
  );
  const paysSomeoneElse = r.reasons.some((x) => x.code === 'BANNED' || x.code === 'RECIPIENT' || x.code === 'CALLER');
  const head = notYou ? [`This request is for ${from.slice(0, 6)}…${from.slice(-4)}, not your address.`] : [];
  if (c.verdict === 'dangerous' || paysSomeoneElse) return { verdict: 'dangerous', sentences: [...head, ...c.reasons.filter(() => c.verdict === 'dangerous'), ...sentences] };
  return {
    verdict: 'not-exit',
    sentences: [...head, 'This is not a withdrawal from the protocol’s published exits, so this kit would not send it. That alone does not make it malicious; it is simply not an exit.', ...sentences],
  };
}

/**
 * What the Check screen calls. The account checked is ONLY the address the user typed (or their connected wallet):
 * a pasted `from` is attacker-controlled and is never used as "you".
 */
export function checkPastedText(input: { text: string; to: string; account: string; chainId: number; manifest: Manifest }): CheckResult {
  if (!isAddress(input.account.trim(), { strict: false })) {
    return { verdict: 'not-exit', sentences: ['Enter your address first: the check compares where the funds would go with your own address.'] };
  }
  const p = parsePasted(input.text);
  const account = input.account.trim() as Address;
  const chainId = p.chainId ?? input.chainId; // evaluate against the chain the request is actually for
  return checkPasted({ to: p.to ?? input.to, data: p.data ?? '', value: p.value, from: p.from, chainId }, { account, chainId, manifest: input.manifest });
}

export interface SiteCheck {
  verdict: 'match' | 'mismatch' | 'unset';
  sha256: string;
}

export { normaliseBundle };

/**
 * Hijack detection (manual): sha256 of a pasted site script vs the Safe-published org.copeybara.site set.
 * The extension does this automatically for every script a page runs.
 */
export async function siteHashCheck(bundleText: string, allowed: string[] | null): Promise<SiteCheck> {
  const sha256 = await scriptHash(bundleText);
  if (!allowed) return { verdict: 'unset', sha256 };
  return { verdict: allowed.includes(sha256) ? 'match' : 'mismatch', sha256 };
}

/** `?check=<base64url JSON>` pre-fills the Check tab (used by the Attack Theater). Returns pretty JSON or null. */
export function prefillFromUrl(href: string): string | null {
  try {
    const v = new URL(href).searchParams.get('check');
    if (!v) return null;
    const b64 = v.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return JSON.stringify(json, null, 2);
  } catch {
    return null;
  }
}
