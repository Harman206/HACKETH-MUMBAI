// @vitest-environment jsdom
import { beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scriptHash } from '@copeybara/sitecheck';

const DIR = join(__dirname, '..');
const SRC = readFileSync(join(DIR, 'copeybara-exit.js'), 'utf8');
const SHA = 'ab'.repeat(32);

beforeAll(async () => {
  await import('../copeybara-exit.js');
});

const mount = (attrs: Record<string, string>) => {
  const e = document.createElement('copeybara-exit');
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  document.body.append(e);
  return e.shadowRoot!;
};

describe('<copeybara-exit> file', () => {
  test('one file under 15 kB, no dependencies, sha256 sidecar matches', () => {
    expect(Buffer.byteLength(SRC)).toBeLessThan(15 * 1024);
    expect(SRC).not.toMatch(/\bimport\b|\brequire\(/);
    const sha = createHash('sha256').update(SRC).digest('hex');
    expect(readFileSync(join(DIR, 'copeybara-exit.js.sha256'), 'utf8')).toBe(`${sha}  copeybara-exit.js\n`);
  });

  test('never fetches, touches a wallet, stores anything or runs remote code', () => {
    for (const re of [/fetch\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /document\.cookie/, /localStorage/, /sessionStorage/, /indexedDB/, /ethereum/, /eip6963/i, /eth_/, /eval\(/, /innerHTML/, /\bimport\(/, /createElement\(['"]script/]) {
      expect(SRC, String(re)).not.toMatch(re);
    }
  });

  test('its site-fingerprint hash is what `copeybara fingerprint` will list', async () => {
    expect(await scriptHash(SRC)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('<copeybara-exit> rendering', () => {
  test('download, ENS name, sha256, verify commands, extension and the required warning', () => {
    const r = mount({ ens: 'demo.eth', kit: '/k/copeybara-kit.html', sha256: SHA, extension: '/ext.zip', 'extension-sha256': 'cd'.repeat(32) });
    const text = r.textContent!;
    expect(text).toContain('Verify this file against demo.eth before you use it. This website cannot vouch for itself.');
    expect(text).toContain(SHA);
    expect(text).toContain('cd'.repeat(32));
    expect(text).toMatch(/sha256sum copeybara-kit\.html\nshasum -a 256 copeybara-kit\.html\nscripts\/verify-kit\.sh copeybara-kit\.html demo\.eth/);
    const links = Array.from(r.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links[0]).toMatch(/\/k\/copeybara-kit\.html$/);
    expect(links[1]).toMatch(/\/ext\.zip$/);
    expect(text).not.toMatch(/certified/i);
  });

  test('the certified link goes to the independent live check, and says a badge alone proves nothing', () => {
    const r = mount({ ens: 'demo.eth', certified: '' });
    const a = Array.from(r.querySelectorAll('a')).find((x) => /certified/i.test(x.textContent!))!;
    expect(a.getAttribute('href')).toBe('https://blackout-red.vercel.app/#/certified/demo.eth');
    expect(r.textContent).toMatch(/A badge on this page proves nothing/);
  });

  test('attributes are text, never HTML; javascript: links fall back; bad names render nothing useful', () => {
    const r = mount({ ens: 'demo.eth', sha256: '<img src=x onerror=alert(1)>', kit: 'javascript:alert(1)' });
    expect(r.querySelector('img')).toBeNull();
    expect(r.querySelector('a')!.getAttribute('href')).toMatch(/^http.*copeybara-kit\.html$/);
    const bad = mount({ ens: '<b>x</b>' });
    expect(bad.querySelector('b')).toBeNull();
    expect(bad.textContent).toMatch(/set ens=/);
  });
});
