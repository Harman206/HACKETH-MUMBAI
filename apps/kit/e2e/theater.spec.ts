import { expect, test } from '@playwright/test';
import { installTestWallet, presetSettings, state } from './helpers';

/**
 * The whole Attack Theater story on a Sepolia fork: a real approval on the hijacked DemoSwap, a real drain by the
 * attacker's bot, a real outage, then the Copeybara rescue — driven from the website exactly as at the booth.
 */
test('attack theater: prepare → hijack (real drain) → outage → verify + rescue → scoreboard', async ({ context }) => {
  test.setTimeout(300_000);
  const s = state();
  const t = s.theater;
  await installTestWallet(context, s, t.victim);
  await presetSettings(context, s, { userRpcs: { '11155111': [t.rpcProxy, ...s.rpcs] } });

  const site = await context.newPage();
  await site.goto(t.site);
  await expect(site.getByRole('heading', { name: 'Attack Theater: live' })).toBeVisible({ timeout: 30_000 });
  await expect(site.getByText('LOCAL FORK')).toBeVisible();
  const next = site.locator('[data-next]');
  await expect(next).toHaveAttribute('data-next', '1');

  // Chapter 1: a normal day
  await site.locator('#victim').fill(t.victim);
  await site.getByRole('button', { name: 'Prepare victim wallet' }).click();
  await expect(site.getByText(/holds 10,000 DUSD/)).toBeVisible({ timeout: 60_000 });
  await expect(next).toHaveAttribute('data-next', '2', { timeout: 30_000 });
  await expect(next).toContainText('Hijack the domain');

  // Chapter 2: the hijack. The victim approves on the fake DemoSwap; the bot drains.
  await site.getByRole('button', { name: 'Hijack the domain' }).click();
  const fakeLink = site.getByRole('link', { name: /Open DemoSwap \(now fake\)/ });
  const [demo] = await Promise.all([context.waitForEvent('page'), fakeLink.click()]);
  await expect(demo.getByText('Approve to view your rewards')).toBeVisible({ timeout: 15_000 }); // page load goes through the hijack router
  await demo.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(site.getByText('Without Copeybara', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await expect(site.locator('.scoreboard .big.bad')).toHaveText('10,000 DUSD', { timeout: 60_000 });
  await expect(next).toHaveAttribute('data-next', '3', { timeout: 30_000 });

  // Chapter 3: the outage
  await site.getByRole('button', { name: 'Take the website down' }).click();
  await site.getByRole('button', { name: 'Take the RPC down' }).click();
  await expect(site.getByText(/Website: down/)).toBeVisible();
  await expect(next).toHaveAttribute('data-next', '4', { timeout: 30_000 });

  // Chapter 4: the rescue
  await site.getByRole('button', { name: /Verify the saved kit/ }).click();
  await expect(site.getByText(/^MATCH v=2/)).toBeVisible({ timeout: 60_000 });
  await expect(site.getByText(/^MISMATCH/)).toBeVisible();

  const [check] = await Promise.all([context.waitForEvent('page'), site.getByRole('link', { name: 'Show the attacker’s request in the kit' }).click()]);
  await check.locator('#acct').fill(t.victim);
  await check.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(check.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'blocked', { timeout: 30_000 });
  await check.close();

  const [kit] = await Promise.all([context.waitForEvent('page'), site.getByRole('link', { name: 'Open the kit and exit' }).click()]);
  await kit.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(kit.locator('[data-position], [role=alert]').first()).toBeVisible({ timeout: 60_000 });
  const alerts = await kit.locator('[role=alert]').allTextContents();
  expect(alerts, `kit reported: ${alerts.join(' | ')}`).toEqual([]);
  await expect(kit.locator('[data-position]').first()).toBeVisible({ timeout: 60_000 });
  await kit.getByRole('button', { name: 'Exit all' }).click();
  await expect(kit.locator('[data-status="recovered"]').first()).toBeVisible({ timeout: 90_000 });
  await expect(kit.getByText(/back in your wallet/).first()).toBeVisible();

  // Scoreboard: lost vs recovered, time to exit
  await expect(site.locator('.scoreboard .big.ok')).toContainText('DUSD', { timeout: 30_000 });
  await expect(site.getByText(/Time to exit .*: \d+(\.\d+)? s/)).toBeVisible();
  await expect(next).toHaveAttribute('data-next', 'done', { timeout: 30_000 });
  await expect(next).toContainText(/Done\. The hijack drained 10,000 DUSD\. The saved kit recovered .*DUSD/);
  await expect(site.locator('.scoreboard [data-qr] img')).toBeVisible();
});
