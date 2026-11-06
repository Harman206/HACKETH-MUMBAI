import { expect, test, type Page } from '@playwright/test';
import { installTestWallet, presetSettings, state } from './helpers';

const noHorizontalScroll = async (page: Page, where: string) => {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `horizontal scroll on ${where}`).toBeLessThanOrEqual(iw);
};

test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

test('phone width: every kit screen fits without sideways scrolling', async ({ page }) => {
  const s = state();
  await installTestWallet(page, s);
  await presetSettings(page, s);
  await page.goto(s.kitUrl);
  await noHorizontalScroll(page, 'setup');
  await page.getByRole('button', { name: 'Check a transaction' }).click();
  await noHorizontalScroll(page, 'check');
  await page.getByRole('button', { name: 'Release & exits' }).click();
  await page.getByRole('button', { name: 'Read records' }).click();
  await expect(page.locator('[data-release]')).toBeVisible({ timeout: 30_000 });
  await noHorizontalScroll(page, 'release');
  await page.getByRole('button', { name: 'Exit my positions' }).click();
  await page.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(page.getByText(/Release v2/).first()).toBeVisible({ timeout: 30_000 });
  await noHorizontalScroll(page, 'positions (with the sha256 facts)');
});

test('no wallet: the kit says so before you click, and points to a wallet', async ({ page }) => {
  const s = state();
  await presetSettings(page, s);
  await page.goto(s.kitUrl);
  const hint = page.locator('[data-no-wallet]');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('No browser wallet detected');
  await expect(hint.locator('[data-fix="install-wallet"] a')).toHaveCount(2);
  // Clicking anyway gives the same plain answer, not a stack trace.
  await page.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(page.locator('[data-error]')).toContainText('Install MetaMask or Rabby', { timeout: 30_000 });
});
