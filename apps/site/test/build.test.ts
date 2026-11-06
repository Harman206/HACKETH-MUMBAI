import { beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..');
let html = '';
let js = '';
beforeAll(() => {
  execFileSync('pnpm', ['build'], { cwd: SITE, stdio: 'pipe' });
  html = readFileSync(join(SITE, 'dist', 'index.html'), 'utf8');
  js = readdirSync(join(SITE, 'dist', 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(SITE, 'dist', 'assets', f), 'utf8')).join('\n');
}, 120_000);

test('no third-party scripts, styles, fonts or analytics', () => {
  expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  expect(html + js).not.toMatch(/fonts\.googleapis|google-analytics|googletagmanager|segment\.io|plausible/);
});

test('CSP lets the site fetch its own files (recorded run, kit sha256)', () => {
  expect(html).toMatch(/connect-src 'self' /);
});

test('strict CSP meta with self-only scripts', () => {
  expect(html).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
});

test('ships the exact kit and its sha256 next to the site', () => {
  const kit = readFileSync(join(SITE, '..', 'kit', 'dist', 'blackout-kit.html'));
  expect(readFileSync(join(SITE, 'dist', 'blackout-kit.html')).equals(kit)).toBe(true);
  expect(readFileSync(join(SITE, 'dist', 'blackout-kit.html.sha256'), 'utf8')).toMatch(/^[0-9a-f]{64}  blackout-kit.html\n$/);
});

test('service worker: precaches the page and the exact kit; CSP allows only a same-origin worker', () => {
  const sw = readFileSync(join(SITE, 'dist', 'sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/const PRECACHE = (\[.*?\]);/s)![1]!) as string[];
  expect(list).toEqual(expect.arrayContaining(['./', 'blackout-kit.html', 'blackout-kit.html.sha256']));
  expect(list.some((f) => f.startsWith('assets/') && f.endsWith('.js'))).toBe(true);
  expect(list).not.toContain('sw.js');
  expect(sw).toMatch(/const CACHE = 'blackout-[0-9a-f]{12}';/);
  expect(html).toMatch(/worker-src 'self'/);
});

test('qr.svg is the QR code of the public site URL, and is precached for offline use', async () => {
  const { url } = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8')) as { url: string };
  expect(url).toMatch(/^https:\/\//);
  const QR = (await import('qrcode')).default;
  const want = await QR.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  expect(readFileSync(join(SITE, 'dist', 'qr.svg'), 'utf8')).toBe(want);
  expect(readFileSync(join(SITE, 'dist', 'sw.js'), 'utf8')).toContain('"qr.svg"');
});

