/**
 * Codecs for the org.copeybara.* ENS text records (see docs/superpowers/specs/2026-11-06-copeybara-extension-design.md).
 * release / manifest use ./release and ./manifest; this file holds site, status and blocklist.
 */

export const COPEYBARA_KEYS = {
  release: 'org.copeybara.release',
  manifest: 'org.copeybara.manifest',
  site: 'org.copeybara.site',
  extension: 'org.copeybara.extension',
  status: 'org.copeybara.status',
  blocklist: 'org.copeybara.blocklist',
  /** declarative exit spec for the protocol's own contracts (see ./exitspec) */
  exits: 'org.copeybara.exits',
} as const;

export class RecordFormatError extends Error {
  override name = 'RecordFormatError';
}

// ---------- status ----------

export type StatusState = 'ok' | 'degraded' | 'compromised';
export interface StatusRecord {
  state: StatusState;
  /** unix seconds when the state was set */
  at?: number;
  /** plain-language note, ≤ 200 characters */
  note?: string;
}

const STATES: readonly StatusState[] = ['ok', 'degraded', 'compromised'];
export const STATUS_NOTE_MAX = 200;

/** `v=1;state=<ok|degraded|compromised>[;at=<unix>][;note=<urlencoded>]`; an empty record means ok. */
export function parseStatus(text: string): StatusRecord {
  const t = text.trim();
  if (!t) return { state: 'ok' };
  const fields = new Map<string, string>();
  for (const part of t.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) throw new RecordFormatError('The status record is not a list of key=value fields.');
    const k = part.slice(0, i);
    if (fields.has(k)) throw new RecordFormatError(`The status record repeats "${k}".`);
    fields.set(k, part.slice(i + 1));
  }
  if (fields.get('v') !== '1') throw new RecordFormatError('The status record must start with v=1.');
  for (const k of fields.keys()) if (!['v', 'state', 'at', 'note'].includes(k)) throw new RecordFormatError(`The status record has an unknown field "${k}".`);
  const state = fields.get('state') as StatusState | undefined;
  if (!state || !STATES.includes(state)) throw new RecordFormatError('The status record has no valid state (ok, degraded or compromised).');
  const out: StatusRecord = { state };
  const at = fields.get('at');
  if (at !== undefined) {
    if (!/^(0|[1-9][0-9]{0,15})$/.test(at)) throw new RecordFormatError('The status time is not a whole number of seconds.');
    out.at = Number(at);
  }
  const note = fields.get('note');
  if (note !== undefined) {
    try {
      out.note = decodeURIComponent(note).slice(0, STATUS_NOTE_MAX);
    } catch {
      throw new RecordFormatError('The status note is not URL-encoded text.');
    }
  }
  return out;
}

export function formatStatus(r: StatusRecord): string {
  let s = `v=1;state=${r.state}`;
  if (r.at !== undefined) s += `;at=${Math.floor(r.at)}`;
  if (r.note) s += `;note=${encodeURIComponent(r.note.slice(0, STATUS_NOTE_MAX))}`;
  return s;
}

// ---------- blocklist ----------

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

function canonicalHost(h: string): string {
  return h.trim().toLowerCase().replace(/\.$/, '');
}

/** `{"v":1,"domains":["host",…]}` → lowercase, de-duplicated hosts. Empty record → []. */
export function parseBlocklist(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  let j: unknown;
  try {
    j = JSON.parse(t);
  } catch {
    throw new RecordFormatError('The blocklist record is not JSON.');
  }
  const o = j as { v?: unknown; domains?: unknown };
  if (!o || o.v !== 1 || !Array.isArray(o.domains)) throw new RecordFormatError('The blocklist record must be {"v":1,"domains":[…]}.');
  const out: string[] = [];
  for (const d of o.domains) {
    if (typeof d !== 'string') throw new RecordFormatError('Every blocklist entry must be a hostname.');
    const h = canonicalHost(d);
    if (!HOST_RE.test(h)) throw new RecordFormatError(`"${d}" is not a bare hostname.`);
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

export function formatBlocklist(domains: string[]): string {
  const hs = [...new Set(domains.map(canonicalHost))].sort();
  for (const h of hs) if (!HOST_RE.test(h)) throw new RecordFormatError(`"${h}" is not a bare hostname.`);
  return JSON.stringify({ v: 1, domains: hs });
}

/** True when `host` is `domain` or a subdomain of it (label boundary, case-insensitive). */
export function hostMatches(host: string, domain: string): boolean {
  const h = canonicalHost(host);
  const d = canonicalHost(domain);
  return h === d || h.endsWith(`.${d}`);
}

// ---------- site fingerprint ----------

const HASH_RE = /^[0-9a-f]{64}$/;

/** `v=2;sha256=<h1>,<h2>,…` (set of allowed script hashes) or legacy `sha256:<hex>`. Empty → null (no fingerprint). */
export function parseSiteRecord(text: string): string[] | null {
  const t = text.trim();
  if (!t) return null;
  let list: string[];
  if (t.startsWith('sha256:')) list = [t.slice(7)];
  else {
    const m = /^v=2;sha256=(.+)$/.exec(t);
    if (!m) throw new RecordFormatError('The site record is not in the form v=2;sha256=<hash>,<hash>,….');
    list = m[1]!.split(',');
  }
  const out: string[] = [];
  for (const raw of list) {
    const h = raw.trim().toLowerCase();
    if (!HASH_RE.test(h)) throw new RecordFormatError('The site record holds something that is not a sha256 hash.');
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

export function formatSiteRecord(hashes: string[]): string {
  const hs = [...new Set(hashes.map((h) => h.toLowerCase()))].sort();
  if (!hs.length || hs.some((h) => !HASH_RE.test(h))) throw new RecordFormatError('A site record needs at least one sha256 hash.');
  return `v=2;sha256=${hs.join(',')}`;
}
