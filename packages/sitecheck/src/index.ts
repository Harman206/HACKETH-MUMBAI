/**
 * Site fingerprint checks shared by the extension (live DOM), the watcher (static HTML) and the fingerprint tool.
 * A page passes only when every piece of code it runs hashes to a member of the Safe-published org.copeybara.site set.
 */

/** Line endings and trailing whitespace must not flip the verdict. Same rule as scripts/site-hash.mjs. */
export function normaliseBundle(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n';
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const scriptHash = (text: string): Promise<string> => sha256Hex(normaliseBundle(text));

export interface CodeItem {
  kind: 'src' | 'inline' | 'handler';
  /** what to show the user: a URL, "inline #2", or `onclick on <button>` */
  label: string;
  /** null when the bytes could not be read */
  hash: string | null;
}

export type SiteVerdict = 'match' | 'mismatch' | 'unverifiable' | 'unset';
export interface SiteResult {
  verdict: SiteVerdict;
  unknown: CodeItem[];
  unreadable: CodeItem[];
}

/** unset: nothing published · mismatch: some code is not in the set · unverifiable: some code could not be read · match. */
export function checkScripts(items: CodeItem[], allowed: string[] | null): SiteResult {
  if (allowed === null) return { verdict: 'unset', unknown: [], unreadable: [] };
  const set = new Set(allowed.map((h) => h.toLowerCase()));
  const unknown = items.filter((i) => i.hash !== null && !set.has(i.hash));
  const unreadable = items.filter((i) => i.hash === null);
  return { verdict: unknown.length ? 'mismatch' : unreadable.length ? 'unverifiable' : 'match', unknown, unreadable };
}

const JS_TYPES = new Set([
  '',
  'module',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-javascript',
  'text/jscript',
  'text/livescript',
]);

/** Browsers execute a <script> only for these types (missing type = JavaScript). */
export function isExecutableScriptType(type: string | null | undefined): boolean {
  return JS_TYPES.has((type ?? '').trim().toLowerCase());
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};

/** Code a static HTML document would run: inline scripts, external script URLs (absolute), event handlers and javascript: URLs. */
export function extractScripts(html: string, base: string): { inline: string[]; src: string[]; handlers: string[] } {
  const doc = html.replace(/<!--[\s\S]*?-->/g, '');
  const inline: string[] = [];
  const src: string[] = [];
  const handlers: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(doc))) {
    const tag = ` ${m[1]!}`;
    if (!isExecutableScriptType(attr(tag, 'type'))) continue;
    const s = attr(tag, 'src');
    if (s !== null) src.push(new URL(s, base).href);
    else inline.push(m[2]!);
  }
  const withoutScripts = doc.replace(scriptRe, '');
  const tagRe = /<[a-z][a-z0-9-]*\b([^>]*)>/gi;
  while ((m = tagRe.exec(withoutScripts))) {
    const attrRe = /\s(on[a-z]+|href|src|action|formaction)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(` ${m[1]!}`))) {
      const name = a[1]!.toLowerCase();
      const v = a[3] ?? a[4] ?? a[5] ?? '';
      if (name.startsWith('on')) handlers.push(v);
      else if (/^\s*javascript:/i.test(v)) handlers.push(v.trim());
    }
  }
  return { inline, src, handlers };
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Static view of a page's code (watcher + fingerprint tool): fetch the HTML, then every external script.
 * A script that cannot be fetched gets hash null (→ unverifiable), never skipped.
 */
export async function fetchCodeItems(pageUrl: string, fetchText: FetchText): Promise<CodeItem[]> {
  const res = await fetchText(pageUrl);
  if (!res.ok) throw new Error(`${pageUrl} answered HTTP ${res.status}.`);
  const { inline, src, handlers } = extractScripts(await res.text(), pageUrl);
  const items: CodeItem[] = [];
  for (const u of src) {
    let hash: string | null = null;
    try {
      const r = await fetchText(u);
      if (r.ok) hash = await scriptHash(await r.text());
    } catch {
      hash = null;
    }
    items.push({ kind: 'src', label: u, hash });
  }
  for (const [i, t] of inline.entries()) items.push({ kind: 'inline', label: `inline script #${i + 1}`, hash: await scriptHash(t) });
  for (const [i, t] of handlers.entries()) items.push({ kind: 'handler', label: `event handler #${i + 1}`, hash: await scriptHash(t) });
  return items;
}
