import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkScripts, extractScripts, fetchCodeItems, isExecutableScriptType, normaliseBundle, scriptHash, type CodeItem } from '../src';

const HARNESS = join(__dirname, '..', '..', '..', 'harness');
const siteHtml = readFileSync(join(HARNESS, 'site', 'index.html'), 'utf8');
const appJs = readFileSync(join(HARNESS, 'site', 'app.js'), 'utf8');
const injectJs = readFileSync(join(HARNESS, 'hijack', 'inject.js'), 'utf8');

const item = async (label: string, text: string | null, kind: CodeItem['kind'] = 'src'): Promise<CodeItem> => ({
  kind,
  label,
  hash: text === null ? null : await scriptHash(text),
});

describe('scriptHash', () => {
  test('is sha256 of the normalised text (same rule as scripts/site-hash.mjs)', async () => {
    expect(await scriptHash('a\r\nb  \n\n')).toBe(await scriptHash('a\nb\n'));
    expect(normaliseBundle('x \t\r\ny')).toBe('x\ny\n');
    expect(await scriptHash('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('checkScripts', () => {
  test('no record → unset', async () => {
    expect((await checkScripts([await item('/app.js', appJs)], null)).verdict).toBe('unset');
  });
  test('every script known → match', async () => {
    const allowed = [await scriptHash(appJs)];
    expect(checkScripts([await item('/app.js', appJs)], allowed)).toEqual({ verdict: 'match', unknown: [], unreadable: [] });
  });
  test('the DemoSwap hijack (inline request + inject.js) → mismatch naming both', async () => {
    const allowed = [await scriptHash(appJs)];
    const items = [await item('/app.js', appJs), await item('inline #1', 'window.__HIJACK_REQUEST__={}', 'inline'), await item('/inject.js', injectJs)];
    const r = checkScripts(items, allowed);
    expect(r.verdict).toBe('mismatch');
    expect(r.unknown.map((u) => u.label)).toEqual(['inline #1', '/inject.js']);
  });
  test('an unreadable script → unverifiable, never match', async () => {
    const allowed = [await scriptHash(appJs)];
    const r = checkScripts([await item('/app.js', appJs), await item('https://cdn.example/x.js', null)], allowed);
    expect(r.verdict).toBe('unverifiable');
    expect(r.unreadable.map((u) => u.label)).toEqual(['https://cdn.example/x.js']);
  });
  test('mismatch wins over unreadable', async () => {
    const r = checkScripts([await item('a', 'evil()'), await item('b', null)], [await scriptHash(appJs)]);
    expect(r.verdict).toBe('mismatch');
  });
  test('an empty page with a record → match (nothing ran)', () => {
    expect(checkScripts([], ['a'.repeat(64)]).verdict).toBe('match');
  });
});

describe('isExecutableScriptType', () => {
  test.each([
    [null, true],
    ['', true],
    ['text/javascript', true],
    ['module', true],
    ['application/javascript', true],
    ['TEXT/JAVASCRIPT', true],
    ['application/json', false],
    ['application/ld+json', false],
    ['importmap', false],
    ['text/template', false],
  ])('%s → %s', (t, want) => {
    expect(isExecutableScriptType(t)).toBe(want);
  });
});

describe('extractScripts (static HTML, used by the watcher and the fingerprint tool)', () => {
  test('DemoSwap: three external scripts resolved against the page URL, no inline code', () => {
    const r = extractScripts(siteHtml, 'http://demoswap.localhost:8080/');
    expect(r.src).toEqual([
      'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js',
      'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
      'http://demoswap.localhost:8080/app.js',
    ]);
    expect(r.inline).toEqual([]);
    expect(r.handlers).toEqual([]);
  });
  test('inline scripts, event-handler attributes and javascript: URLs count as code; data types do not', () => {
    const html = `<html><body>
      <script>window.a=1</script>
      <script type="application/ld+json">{"x":1}</script>
      <SCRIPT type='module'>import x from "./y.js"</SCRIPT>
      <img src=x onerror="steal()">
      <a href="javascript:pay()">go</a>
      <button onclick='go(1)' data-onclick="nope">b</button>
      <script src="/a.js" async></script>
    </body></html>`;
    const r = extractScripts(html, 'https://site.example/sub/page');
    expect(r.inline).toEqual(['window.a=1', 'import x from "./y.js"']);
    expect(r.src).toEqual(['https://site.example/a.js']);
    expect(r.handlers).toEqual(['steal()', 'javascript:pay()', 'go(1)']);
  });
  test('scripts inside HTML comments are ignored', () => {
    expect(extractScripts('<!-- <script>evil()</script> --><script>ok()</script>', 'https://a.example/').inline).toEqual(['ok()']);
  });
});

describe('fetchCodeItems', () => {
  const files: Record<string, string> = {
    'http://demoswap.localhost:8080/': siteHtml,
    'http://demoswap.localhost:8080/app.js': appJs,
    'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js': 'jq()',
    'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js': 'confetti()',
  };
  const fake = async (u: string) => ({ ok: u in files, status: u in files ? 200 : 404, text: async () => files[u] ?? '' });

  test('DemoSwap: three scripts, all hashed', async () => {
    const items = await fetchCodeItems('http://demoswap.localhost:8080/', fake);
    expect(items.map((i) => i.label)).toEqual([
      'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js',
      'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
      'http://demoswap.localhost:8080/app.js',
    ]);
    expect(items[2]!.hash).toBe(await scriptHash(appJs));
  });
  test('a script that 404s is unreadable (hash null), not skipped', async () => {
    const items = await fetchCodeItems('http://demoswap.localhost:8080/', async (u) => (u.endsWith('app.js') ? { ok: false, status: 404, text: async () => '' } : fake(u)));
    expect(items.find((i) => i.label.endsWith('app.js'))!.hash).toBeNull();
  });
  test('the page itself failing throws', async () => {
    await expect(fetchCodeItems('http://down.example/', fake)).rejects.toThrow(/HTTP 404/);
  });
});
