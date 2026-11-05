import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { installTestWallet, presetSettings, state } from './helpers';

/** Scan hook: third-party origins DemoSwap (our own demo site) loads vs the saved kit. Only our own site is scanned live. */
async function origins(page: Page, url: string, firstParty: string[], act?: () => Promise<void>) {
  const seen = new Set<string>();
  page.on('request', (r) => {
    const u = r.url();
    if (/^https?:/.test(u)) seen.add(new URL(u).origin);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (act) await act();
  await page.waitForTimeout(1500);
  return [...seen].filter((o) => !firstParty.includes(o));
}

test('scan: DemoSwap loads N third-party origins, the kit loads 0', async ({ browser }) => {
  const s = state();
  const site = await browser.newPage();
  await site.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
  const siteThird = await origins(site, `${s.drill.router}/`, [new URL(s.drill.router).origin]);

  const kit = await browser.newPage();
  await installTestWallet(kit, s);
  await presetSettings(kit, s);
  const kitThird = await origins(kit, s.kitUrl, [new URL(s.kitUrl).origin, ...s.rpcs.map((r) => new URL(r).origin)], async () => {
    await kit.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
    await expect(kit.getByText(/Release v2/)).toBeVisible({ timeout: 30_000 });
  });

  const table = `| Page | Third-party origins |\n|---|---|\n| DemoSwap (normal app frontend) | ${siteThird.length}: ${siteThird.join(', ')} |\n| BLACKOUT kit | ${kitThird.length} |\n`;
  writeFileSync('test-results/scan.md', table);
  console.log(table);
  expect(siteThird.length).toBeGreaterThanOrEqual(4);
  expect(kitThird).toEqual([]);
});
