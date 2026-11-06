import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { state } from './helpers';

const SITE_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'dist');

/** The website in public mode (no booth): live ENS proof, no third-party requests, keyboard and phone-width usable. */
const PUBLIC_RPCS = ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://rpc.sepolia.ethpandaops.io'];

test('website public mode: explains, reads ENS live, zero third-party requests', async ({ page }) => {
  const s = state();
  const url = s.theater.site.split('?')[0]!;
  const origins = new Set<string>();
  page.on('request', (r) => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin); });
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('An exit of your own.');
  for (const h of ['When the website is the attack', 'How the kit works', 'Live demo', 'Download and verify', 'Give your users a backup exit']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await expect(page.getByText('400,227.23 USDC').first()).toBeVisible();
  await expect(page.getByText(/release v\d+/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('reverted ✓').first()).toBeVisible();
  const qr = page.locator('footer [data-qr] img');
  await qr.scrollIntoViewIfNeeded();
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), 'qr.svg loads under the CSP').toBe(true);
  const third = [...origins].filter((o) => o !== new URL(url).origin && !PUBLIC_RPCS.includes(o));
  expect(third).toEqual([]);
});

test('website: keyboard reaches the main actions; no horizontal scroll at 360 px', async ({ page }) => {
  const s = state();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(s.theater.site.split('?')[0]!);
  const reached = new Set<string>();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    reached.add((await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')) || '');
  }
  expect([...reached]).toEqual(expect.arrayContaining(['See the demo ↗', 'Get the exit kit ↓']));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('booth address that is not localhost falls back to public mode with a notice', async ({ page }) => {
  const s = state();
  await page.goto(`${s.theater.site.split('?')[0]}?booth=https://evil.example`);
  await expect(page.getByText(/booth address must be http:\/\/localhost/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live demo' })).toBeVisible();
});

test('after one visit, the site and the hosted kit keep opening when the website is down', async ({ page }) => {
  // Our own copy of the site, so this test can really switch it off.
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    let body: Buffer;
    try {
      body = readFileSync(join(SITE_DIST, path === '/' ? 'index.html' : path));
    } catch {
      return void res.writeHead(404).end();
    }
    const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.sha256') ? 'text/plain' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'content-type': type }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${(server.address() as { port: number }).port}/`;

  await page.goto(url);
  await expect(page.getByRole('link', { name: 'Try the kit on the demo protocol' }).first()).toHaveAttribute('href', 'copeybara-kit.html?ens=demoswap-blackout.eth');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect(page.locator('[data-offline-ready]')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download the kit' }).click();
  expect((await download).suggestedFilename()).toBe('copeybara-kit.html');

  server.closeAllConnections();
  await new Promise((r) => server.close(r));

  await page.goto(`${url}copeybara-kit.html?ens=demoswap-blackout.eth`);
  await expect(page.getByRole('heading', { name: 'Copeybara exit kit' })).toBeVisible();
  const served: string = await page.evaluate(() => fetch('copeybara-kit.html').then((r) => r.text()));
  const want = readFileSync(join(SITE_DIST, 'copeybara-kit.html.sha256'), 'utf8').split(' ')[0];
  expect(createHash('sha256').update(served).digest('hex'), 'offline copy is byte-identical to the verified kit').toBe(want);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('An exit of your own.');
});
