/**
 * The Copeybara certified directory, bundled with this build (config/certified.json, the same list the website shows).
 * Bundled rather than fetched: the extension only ever talks to RPCs. The list only says who was onboarded; the tick
 * itself is re-checked on chain by the worker (checkCertified) every time it is shown.
 */
import { isAddress } from 'viem';
import type { CertifiedEntry } from '@copeybara/protocol-cli/onchain';
import registry from '../../../../config/certified.json';

export type { CertifiedEntry };

const NAME = /^[a-z0-9-]+\.eth$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** Keep only well-formed entries: a malformed one is dropped, never half-trusted. */
export function validEntries(raw: unknown): CertifiedEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CertifiedEntry[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    if (typeof e !== 'object' || e === null) continue;
    if (!str(e.protocol, 64) || !str(e.name, 255) || !NAME.test(e.name) || !str(e.since, 10) || !DATE.test(e.since)) continue;
    const addrs = [e.safe, e.resolver, e.websiteKey, e.watcher];
    if (!addrs.every((a) => typeof a === 'string' && isAddress(a, { strict: false }))) continue;
    if (e.note !== undefined && !str(e.note, 500)) continue;
    if (out.some((x) => x.name === e.name)) continue;
    out.push({ protocol: e.protocol, name: e.name, safe: e.safe as CertifiedEntry['safe'], resolver: e.resolver as CertifiedEntry['resolver'], websiteKey: e.websiteKey as CertifiedEntry['websiteKey'], watcher: e.watcher as CertifiedEntry['watcher'], since: e.since, ...(e.note ? { note: e.note as string } : {}) });
  }
  return out;
}

export const CERTIFIED: readonly CertifiedEntry[] = Object.freeze(validEntries(registry));
export const findCertified = (name: string): CertifiedEntry | null => CERTIFIED.find((e) => e.name === name.trim().toLowerCase()) ?? null;

/** What the worker answers for one entry: the live verdict, and the plain names of any failing checks. */
export interface CertifiedVerdict {
  certified: boolean;
  block: string;
  failed: string[];
}
