import { expect, test } from '@playwright/test';
import { state } from './helpers';

/** The website in public mode (no booth): live ENS proof, no third-party requests, keyboard and phone-width usable. */
const PUBLIC_RPCS = ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://1rpc.io'];

test('website public mode: explains, reads ENS live, zero third-party requests', async ({ page }) => {
  const s = state();
  const url = s.theater.site.split('?')[0]!;
  const origins = new Set<string>();
  page.on('request', (r) => { if (/^https?:/.test(r.url())) origins.add(new URL(r.url()).origin); });
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('you can still get your money out');
  for (const h of ['The contracts were fine. The websites were not.', 'How BLACKOUT works', 'Live demo', 'Download and verify', 'For protocol teams']) {
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  }
  await expect(page.getByText('400,227.23 USDC').first()).toBeVisible();
  await expect(page.getByText(/release v\d+/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('reverted ✓').first()).toBeVisible();
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
  expect([...reached]).toEqual(expect.arrayContaining(['See the attack live', 'Download the kit']));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('booth address that is not localhost falls back to public mode with a notice', async ({ page }) => {
  const s = state();
  await page.goto(`${s.theater.site.split('?')[0]}?booth=https://evil.example`);
  await expect(page.getByText(/booth address must be http:\/\/localhost/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live demo' })).toBeVisible();
});
