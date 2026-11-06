import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installTestWallet, presetSettings, state } from './helpers';

test('full exit: ENS manifest → three positions → exit all → recovered → report', async ({ page }) => {
  const s = state();
  await installTestWallet(page, s);
  await presetSettings(page, s);
  await page.goto(s.kitUrl);

  await page.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(page.getByText(`Release v2`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(s.kitSha256).first()).toBeAttached();
  for (const id of Object.values(s.positions)) await expect(page.locator(`[data-position="${id}"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Exit all' }).click();
  for (const id of Object.values(s.positions)) {
    await expect(page.locator(`[data-position="${id}"] [data-status]`)).toHaveAttribute('data-status', 'recovered', { timeout: 60_000 });
  }

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download report (JSON)' }).click()]);
  const report = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
  expect(report.ensName).toBe(s.ensName);
  expect(report.kit.sha256).toBe(s.kitSha256);
  expect(report.results).toHaveLength(3);
  expect(report.results.every((r: { status: string }) => r.status === 'recovered')).toBe(true);

  const walletCalls: string[] = await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls);
  expect(walletCalls.filter((m) => /sign/i.test(m))).toEqual([]);
  expect(walletCalls).toContain('eth_sendTransaction');
});

test('check a transaction: the hijacked site’s approve(attacker, max) is blocked', async ({ page }) => {
  const s = state();
  await presetSettings(page, s);
  await page.goto(s.kitUrl);
  await page.getByRole('button', { name: 'Check a transaction' }).click();
  const approve = `0x095ea7b3${'0'.repeat(24)}${'9'.repeat(40)}${'f'.repeat(64)}`;
  await page.locator('#pasted').fill(JSON.stringify({ from: s.wallet, to: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', data: approve, value: '0x0' }));
  await page.locator('#acct').fill(s.wallet);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'blocked', { timeout: 30_000 });
  await expect(page.getByText('Do not sign this.')).toBeVisible();
  await expect(page.getByText(/Exits never need approvals/)).toBeVisible();
});
