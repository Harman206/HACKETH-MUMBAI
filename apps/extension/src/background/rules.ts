/**
 * declarativeNetRequest rules: the block a page cannot evade. Requests to a followed protocol's site while its
 * ENS status says "compromised", and to any domain on a followed protocol's blocklist, are cancelled before a single
 * byte of the site loads; the worker then moves the tab to the warning page (core.onNavigate). Blocking instead of
 * redirecting means no extension page has to be web-accessible, so pages cannot probe for Copeybara.
 */
import type { ProtocolState } from '../shared/types';

export const RULE_ID_BASE = 1000;
export const WARNING_PATH = '/src/pages/warning.html';

export interface DnrRule {
  id: number;
  priority: number;
  action: { type: 'block' };
  condition: { requestDomains: string[]; resourceTypes: ('main_frame' | 'sub_frame')[] };
}

export const warningPath = (reason: 'compromised' | 'blocklist' | 'mismatch', name: string, extra: Record<string, string> = {}) =>
  `${WARNING_PATH}?${new URLSearchParams({ reason, name, ...extra }).toString()}`;

/** Deterministic: same protocols → same rules (ids follow the sorted list). */
export function buildRules(protocols: ProtocolState[]): DnrRule[] {
  const entries: { domain: string; path: string }[] = [];
  for (const p of [...protocols].sort((a, b) => a.name.localeCompare(b.name))) {
    const s = p.snapshot;
    if (!s) continue;
    if (s.status?.state === 'compromised' && s.origin) {
      const host = new URL(s.origin).hostname;
      entries.push({ domain: host, path: warningPath('compromised', p.name, s.status.note ? { note: s.status.note } : {}) });
    }
    for (const d of s.blocklist) entries.push({ domain: d, path: warningPath('blocklist', p.name, { domain: d }) });
  }
  const seen = new Set<string>();
  return entries
    .filter((e) => (seen.has(e.domain) ? false : (seen.add(e.domain), true)))
    .map((e, i) => ({
      id: RULE_ID_BASE + i,
      priority: 1,
      action: { type: 'block' },
      condition: { requestDomains: [e.domain], resourceTypes: ['main_frame', 'sub_frame'] },
    }));
}
