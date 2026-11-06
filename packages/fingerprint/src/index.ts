/**
 * Build-time site fingerprint: the org.copeybara.site value for a built site, and the problems that make a build
 * unpublishable. Shared by `copeybara fingerprint` and the vite / webpack / next plugins. Node only.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { formatSiteRecord, parseSiteRecord } from '@copeybara/core';
import { extractScripts, fetchCodeItems, scriptHash, type FetchText } from '@copeybara/sitecheck';

export interface ScriptEntry {
  /** dist-relative file, inline label, or URL */
  source: string;
  sha256: string;
}

export interface SiteFingerprint {
  /** The org.copeybara.site value. */
  record: string;
  hashes: string[];
  scripts: ScriptEntry[];
  /** External scripts found (pinned or not). */
  thirdParty: { url: string; pinned: boolean }[];
  /** Anything here fails the build. */
  problems: string[];
}

const LOCAL = 'https://copeybara-dist.invalid';

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** SRI: `integrity="sha384-…"` must match the fetched bytes exactly, or the browser refuses them. */
export function sriMatches(integrity: string, bytes: Buffer): boolean {
  return integrity
    .trim()
    .split(/\s+/)
    .some((t) => {
      const m = /^(sha256|sha384|sha512)-(.+)$/.exec(t);
      return !!m && createHash(m[1]!).update(bytes).digest('base64') === m[2];
    });
}

const integrityOf = (html: string, url: string, base: string): string | null => {
  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const tag = m[1] ?? '';
    const src = /\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(` ${tag}`)?.[1];
    if (src && new URL(src, base).href === url) return /\sintegrity\s*=\s*["']([^"']+)["']/i.exec(` ${tag}`)?.[1] ?? null;
  }
  return null;
};

export type FetchBytes = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

/**
 * Fingerprint a built site directory. Every .js / .mjs file, every inline script and every event handler in every
 * .html file is hashed. A third-party <script src> is allowed only when it carries an SRI integrity pin that matches
 * the bytes it serves now (fetched once, here); otherwise the build fails: its code could change without a new record.
 */
export async function fingerprintDist(dist: string, opts: { fetch?: FetchBytes } = {}): Promise<SiteFingerprint> {
  const root = resolve(dist);
  const files = await walk(root);
  const scripts: ScriptEntry[] = [];
  const thirdParty: SiteFingerprint['thirdParty'] = [];
  const problems: string[] = [];
  const rel = (p: string) => relative(root, p).split(sep).join('/');

  for (const f of files.filter((f) => /\.(m?js)$/.test(f)).sort()) {
    scripts.push({ source: rel(f), sha256: await scriptHash(await readFile(f, 'utf8')) });
  }
  for (const f of files.filter((f) => f.endsWith('.html')).sort()) {
    const html = await readFile(f, 'utf8');
    const base = `${LOCAL}/${rel(f)}`;
    const { inline, src, handlers } = extractScripts(html, base);
    for (const [i, t] of inline.entries()) scripts.push({ source: `${rel(f)} inline #${i + 1}`, sha256: await scriptHash(t) });
    for (const [i, t] of handlers.entries()) scripts.push({ source: `${rel(f)} handler #${i + 1}`, sha256: await scriptHash(t) });
    for (const u of src) {
      if (u.startsWith(`${LOCAL}/`)) {
        const local = join(root, decodeURIComponent(new URL(u).pathname));
        if (!files.includes(local)) problems.push(`${rel(f)} loads ${new URL(u).pathname}, which is not in the build`);
        continue;
      }
      const integrity = integrityOf(html, u, base);
      if (!integrity) {
        thirdParty.push({ url: u, pinned: false });
        problems.push(`${rel(f)} loads an unpinned third-party script ${u}: vendor it into the build, or pin it with an integrity="sha384-…" attribute`);
        continue;
      }
      const fetchBytes = opts.fetch ?? (globalThis.fetch as unknown as FetchBytes);
      try {
        const r = await fetchBytes(u);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (!sriMatches(integrity, bytes)) {
          problems.push(`${u} no longer matches its integrity pin`);
          thirdParty.push({ url: u, pinned: false });
          continue;
        }
        thirdParty.push({ url: u, pinned: true });
        scripts.push({ source: u, sha256: await scriptHash(bytes.toString('utf8')) });
      } catch (e) {
        problems.push(`${u} is pinned but could not be fetched to hash it (${(e as Error).message})`);
      }
    }
  }
  if (!scripts.length) problems.push(`no scripts found in ${dist}`);
  const hashes = [...new Set(scripts.map((s) => s.sha256))].sort();
  return { record: hashes.length ? formatSiteRecord(hashes) : '', hashes, scripts, thirdParty, problems };
}

/** Same, for a deployed page (what the watcher and extensions see). Unreadable scripts are problems. */
export async function fingerprintUrl(url: string, fetchText: FetchText = (u) => fetch(u)): Promise<SiteFingerprint> {
  const items = await fetchCodeItems(url, fetchText);
  const problems = items.filter((i) => i.hash === null).map((i) => `could not read ${i.label}`);
  const origin = new URL(url).origin;
  const thirdParty = items.filter((i) => i.kind === 'src' && new URL(i.label).origin !== origin).map((i) => ({ url: i.label, pinned: false }));
  for (const t of thirdParty) problems.push(`the page loads a third-party script ${t.url}: its code can change without a new record`);
  const hashes = [...new Set(items.flatMap((i) => (i.hash ? [i.hash] : [])))].sort();
  return { record: hashes.length ? formatSiteRecord(hashes) : '', hashes, scripts: items.flatMap((i) => (i.hash ? [{ source: i.label, sha256: i.hash }] : [])), thirdParty, problems };
}

export interface SiteDiff {
  added: string[];
  removed: string[];
  same: boolean;
}

/** Compare a build's hashes with the published record (text, "" when unset). */
export function diffSite(hashes: string[], publishedRecord: string): SiteDiff {
  let live: string[] = [];
  try {
    live = publishedRecord ? (parseSiteRecord(publishedRecord) ?? []) : [];
  } catch {
    live = [];
  }
  const a = new Set(hashes);
  const b = new Set(live);
  const added = hashes.filter((h) => !b.has(h));
  const removed = live.filter((h) => !a.has(h));
  return { added, removed, same: !added.length && !removed.length };
}

/** Markdown for a CI job summary. Publishing stays manual: the Safe has to sign the new record. */
export function ciSummary(name: string, fp: SiteFingerprint, diff: SiteDiff | null): string {
  const lines = [`### Copeybara site fingerprint${name ? ` · ${name}` : ''}`, ''];
  lines.push(fp.problems.length ? `**✗ ${fp.problems.length} problem(s): this build cannot be published**` : `✓ ${fp.hashes.length} script hash(es)`);
  for (const p of fp.problems) lines.push(`- ${p}`);
  if (fp.thirdParty.length) lines.push('', 'Third-party scripts:', ...fp.thirdParty.map((t) => `- ${t.pinned ? 'pinned' : '**unpinned**'} ${t.url}`));
  if (diff) {
    lines.push('', diff.same ? 'Matches the published org.copeybara.site.' : `Differs from the published org.copeybara.site: +${diff.added.length} / -${diff.removed.length}. Run \`copeybara propose\` after deploying; the Safe signs the new record.`);
    for (const h of diff.added) lines.push(`- + ${h} ${fp.scripts.find((s) => s.sha256 === h)?.source ?? ''}`);
    for (const h of diff.removed) lines.push(`- - ${h}`);
  } else lines.push('', 'Published record not read (no ENS name or RPC).');
  lines.push('', '```', fp.record, '```');
  return lines.join('\n');
}

/** The file plugins write next to the build: dist/.well-known/copeybara-site.json. */
export const WELL_KNOWN = '.well-known/copeybara-site.json';
export const wellKnownJson = (name: string, fp: SiteFingerprint) =>
  JSON.stringify({ v: 1, name, record: fp.record, scripts: fp.scripts, thirdParty: fp.thirdParty }, null, 2) + '\n';
