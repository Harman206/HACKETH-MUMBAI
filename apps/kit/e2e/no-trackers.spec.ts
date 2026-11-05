import { expect, test } from '@playwright/test';
import { installTestWallet, presetSettings, state } from './helpers';

test('the kit contacts only the configured RPC origins: 0 third-party requests', async ({ page }) => {
  const s = state();
  const allowed = new Set([new URL(s.kitUrl).origin, ...s.rpcs.map((r) => new URL(r).origin)]);
  const seen: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('data:') && !u.startsWith('blob:')) seen.push(new URL(u).origin);
  });
  await installTestWallet(page, s);
  await presetSettings(page, s);
  await page.goto(s.kitUrl);
  await page.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(page.getByText(/Release v2/)).toBeVisible({ timeout: 30_000 }); // positions may already be exited by another spec
  await page.getByRole('button', { name: 'Check a transaction' }).click();

  const thirdParty = [...new Set(seen)].filter((o) => !allowed.has(o));
  expect(thirdParty).toEqual([]);
  expect(seen.length).toBeGreaterThan(0);
});
