import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetSettings, state } from './helpers';

const HOSTED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'hosted');

test('hosted page: download + fingerprint, and the kit reads live release records with no wallet; 0 third-party requests', async ({ page }) => {
  const s = state();
  execFileSync('node', ['build.mjs'], { cwd: HOSTED, stdio: 'pipe' });
  const server = createServer((req, res) => {
    const f = req.url === '/' ? 'index.html' : (req.url ?? '').slice(1);
    try { res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' }).end(readFileSync(join(HOSTED, 'dist', f))); } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${(server.address() as { port: number }).port}`;
  const seen = new Set<string>();
  page.on('request', (r) => { if (/^https?:/.test(r.url())) seen.add(new URL(r.url()).origin); });
  try {
    await page.goto(`${url}/`);
    await expect(page.getByText(s.kitSha256)).toBeVisible();
    await expect(page.getByRole('link', { name: 'copeybara-kit.html' })).toHaveAttribute('href', 'copeybara-kit.html');
    await presetSettings(page, s);
    await page.goto(`${url}/copeybara-kit.html`);
    await page.getByRole('button', { name: 'Release & exits' }).click();
    await page.getByRole('button', { name: 'Read records' }).click();
    await expect(page.locator('[data-release]')).toHaveAttribute('data-release', '2', { timeout: 30_000 });
    await expect(page.getByText(s.kitSha256)).toBeVisible();
    await expect(page.getByText(/uniswap-v3 positionManager/).first()).toBeVisible();
    const allowed = new Set([url, ...s.rpcs.map((r) => new URL(r).origin)]);
    expect([...seen].filter((o) => !allowed.has(o))).toEqual([]);
  } finally {
    server.close();
  }
});
