import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSiteRecord } from '@copeybara/core';
import { scriptHash } from '@copeybara/sitecheck';
import { ciSummary, diffSite, fingerprintDist, sriMatches, type FetchBytes } from '../src';

const CDN = 'https://cdn.example/lib.js';
const LIB = 'window.lib = 1;\n';
const sri = (s: string) => `sha384-${createHash('sha384').update(s).digest('base64')}`;
const cdn: FetchBytes = async (u) => ({ ok: u === CDN, status: u === CDN ? 200 : 404, arrayBuffer: async () => new TextEncoder().encode(LIB).buffer as ArrayBuffer });

function dist(html: string, files: Record<string, string> = { 'assets/app.js': 'console.log(1)' }) {
  const d = mkdtempSync(join(tmpdir(), 'copeybara-fp-'));
  writeFileSync(join(d, 'index.html'), html);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true });
    writeFileSync(join(d, f), body);
  }
  return d;
}

describe('fingerprintDist', () => {
  test('own bundles + inline code → a valid org.copeybara.site record', async () => {
    const fp = await fingerprintDist(dist('<script type="module" src="/assets/app.js"></script><script>boot()</script><button onclick="go()">'));
    expect(fp.problems).toEqual([]);
    expect(fp.hashes).toEqual([await scriptHash('console.log(1)'), await scriptHash('boot()'), await scriptHash('go()')].sort());
    expect(parseSiteRecord(fp.record)).toEqual(fp.hashes);
  });

  test('an unpinned third-party script fails the build', async () => {
    const fp = await fingerprintDist(dist(`<script src="${CDN}"></script><script src="/assets/app.js"></script>`), { fetch: cdn });
    expect(fp.problems.join()).toMatch(/unpinned third-party script https:\/\/cdn\.example\/lib\.js/);
    expect(fp.thirdParty).toEqual([{ url: CDN, pinned: false }]);
  });

  test('a third-party script pinned with matching SRI is hashed into the record', async () => {
    const fp = await fingerprintDist(dist(`<script src="${CDN}" integrity="${sri(LIB)}" crossorigin="anonymous"></script>`), { fetch: cdn });
    expect(fp.problems).toEqual([]);
    expect(fp.hashes).toContain(await scriptHash(LIB));
    expect(fp.thirdParty).toEqual([{ url: CDN, pinned: true }]);
  });

  test('a pin that no longer matches the served bytes fails', async () => {
    const fp = await fingerprintDist(dist(`<script src="${CDN}" integrity="${sri('other')}"></script>`), { fetch: cdn });
    expect(fp.problems.join()).toMatch(/no longer matches its integrity pin/);
  });

  test('a script the HTML loads that is not in the build fails', async () => {
    const fp = await fingerprintDist(dist('<script src="/assets/missing.js"></script>'));
    expect(fp.problems.join()).toMatch(/not in the build/);
  });

  test('non-JS script types are ignored; an empty build fails', async () => {
    const fp = await fingerprintDist(dist('<script type="application/ld+json">{}</script>', {}));
    expect(fp.problems.join()).toMatch(/no scripts found/);
  });
});

describe('diff + CI summary', () => {
  test('diff against the published record', () => {
    const a = 'aa'.repeat(32);
    const b = 'bb'.repeat(32);
    expect(diffSite([a, b], `v=2;sha256=${a}`)).toEqual({ added: [b], removed: [], same: false });
    expect(diffSite([a], `v=2;sha256=${a}`).same).toBe(true);
    expect(diffSite([a], '').added).toEqual([a]);
  });
  test('summary says the Safe publishes, and shows failures', async () => {
    const fp = await fingerprintDist(dist(`<script src="${CDN}"></script>`), { fetch: cdn });
    const md = ciSummary('demo.eth', fp, diffSite(fp.hashes, ''));
    expect(md).toMatch(/cannot be published/);
    expect(md).toMatch(/\*\*unpinned\*\*/);
  });
  test('sriMatches accepts any listed algorithm', () => {
    expect(sriMatches(`sha256-xxx ${sri(LIB)}`, Buffer.from(LIB))).toBe(true);
    expect(sriMatches('sha1-abc', Buffer.from(LIB))).toBe(false);
  });
});
