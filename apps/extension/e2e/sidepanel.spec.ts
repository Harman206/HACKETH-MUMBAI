import { expect, follow, shot, test } from './fixtures';

/**
 * The side panel (what the toolbar icon opens), loaded as a page beside the protocol's real site: it shows the
 * worker's verdict for that site, the followed protocol and the positions, and updates live when the tab changes.
 * SIDEPANEL_SHOT=<path> saves a screenshot.
 */
test('side panel: live verdict for the site beside it, protocol health, positions, stats', async ({ ctx, ext, w }) => {
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(ext.url('sidepanel.html'));
  await expect(panel.locator('[data-checklist]')).toBeVisible(); // not set up yet: the beginner checklist
  await shot(panel, 'sidepanel-new');

  await follow(ext, w);
  await expect(panel.locator('[data-checklist]')).toHaveCount(0, { timeout: 10_000 });
  await expect(panel.locator(`[data-protocol="${w.ensName}"]`)).toContainText('All clear');
  await expect(panel.locator(`[data-protocol="${w.ensName}"]`)).toContainText('v5');

  const site = await ctx.newPage();
  await site.goto(w.siteUrl);
  await expect.poll(async () => (await ext.tab(w.siteUrl))?.site, { timeout: 30_000 }).toMatchObject({ kind: 'protocol', verdict: 'match' });
  await panel.bringToFront();
  await expect(panel.locator('[data-site="match"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-site="match"]')).toContainText(`Verified ${w.ensName} site`);
  await expect(panel.locator('[data-site]').getByRole('button', { name: 'Exit safely' })).toBeVisible();
  // positions read straight from the contracts (3 on a fresh world; the journey spec exits them all if it ran first)
  await expect(panel.locator('[data-positions]')).toContainText('Read straight from the contracts at block', { timeout: 90_000 });
  const n = await panel.locator('[data-position]').count();
  expect([0, w.positions.length]).toContain(n);
  for (const id of n ? w.positions : []) await expect(panel.locator(`[data-position="${id}"]`).getByRole('button', { name: 'Exit safely' })).toBeVisible();
  await expect(panel.locator('[data-stat="verified"]')).not.toHaveText('0');
  if (process.env.SIDEPANEL_SHOT) await panel.screenshot({ path: process.env.SIDEPANEL_SHOT, fullPage: true });
  await shot(panel, 'sidepanel');

  // the site tab goes away: the panel follows to whatever is left (here: no web page)
  await site.close();
  await expect(panel.locator('[data-site="none"]')).toBeVisible({ timeout: 10_000 });
});
