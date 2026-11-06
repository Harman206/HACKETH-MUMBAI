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

test('strict CSP meta with self-only scripts', () => {
  expect(html).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
});

test('ships the exact kit and its sha256 next to the site', () => {
  const kit = readFileSync(join(SITE, '..', 'kit', 'dist', 'blackout-kit.html'));
  expect(readFileSync(join(SITE, 'dist', 'blackout-kit.html')).equals(kit)).toBe(true);
  expect(readFileSync(join(SITE, 'dist', 'blackout-kit.html.sha256'), 'utf8')).toMatch(/^[0-9a-f]{64}  blackout-kit.html\n$/);
});
