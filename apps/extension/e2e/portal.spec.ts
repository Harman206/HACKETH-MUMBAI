import type { BrowserContext, Page } from '@playwright/test';
import { expect, follow, test, type World } from './fixtures';

/**
 * The Demo Portal (harness control server) as a human drives it in the live demo: each scenario button sets the
 * harness state and opens the target in a new tab; the extension reacts on its own.
 * 1 real site verified · 2 DNS hijack replaced by the warning page · 4 unlimited approve, 5 Permit2 signature,
 * 6 setApprovalForAll: each stopped in Copeybara's confirm window before the wallet sees it.
 * Also: DemoSwap's own demo bar shows the mode to the audience. PORTAL_SHOT=<dir> saves screenshots.
 */
const shot = (p: Page, name: string) => (process.env.PORTAL_SHOT ? p.screenshot({ path: `${process.env.PORTAL_SHOT}/${name}.png`, fullPage: true }) : null);

async function openFrom(ctx: BrowserContext, portal: Page, scenario: string) {
  await portal.bringToFront();
  const card = portal.locator(`#cards [data-scenario="${scenario}"]`);
  const [tab] = await Promise.all([ctx.waitForEvent('page'), card.locator('[data-run]').click()]);
  await expect(card.locator('[data-msg]')).toHaveText('Opened in a new tab.', { timeout: 15_000 });
  return tab;
}

async function expectDrainerStopped(ctx: BrowserContext, page: Page, reason: RegExp) {
  const [win] = await Promise.all([
    ctx.waitForEvent('page', { predicate: (p) => p.url().includes('/confirm.html'), timeout: 20_000 }),
    page.locator('#go').click(),
  ]);
  await expect(win.locator('[data-verdict="dangerous"]')).toBeVisible();
  await expect(win.getByText('This looks like a wallet drainer')).toBeVisible();
  await expect(win.locator('[data-reasons]')).toContainText(reason);
  await win.locator('#cancel').click();
  await expect(page.locator('#result')).toHaveText('error 4001');
  const calls = await page.evaluate(() => (window as any).__walletCalls as string[]);
  expect(calls.filter((m) => m === 'eth_sendTransaction' || m.startsWith('eth_signTypedData'))).toEqual([]);
}

const attackUrl = (w: World, path: string) => new RegExp(`demoswap-airdrop\\.localhost:${new URL(w.portal).port}/${path}$`);

test('demo portal: scenarios 1, 2, 4, 5, 6 open the right targets and the extension reacts', async ({ ctx, ext, w }) => {
  await follow(ext, w);
  const portal = await ctx.newPage();
  await portal.setViewportSize({ width: 1280, height: 900 });
  await portal.goto(w.portal);
  await expect(portal.getByRole('heading', { name: /Watch Copeybara stop attacks/ })).toBeVisible();
  await expect(portal.locator('[data-checklist]')).toContainText('Before you start');
  await expect(portal.locator('#cards [data-scenario]')).toHaveCount(7);
  await expect(portal.locator('#cards [data-scenario="verified"] [data-link="site"]')).toHaveText(w.siteUrl);
  // live ENS strip, read through the quorum on the fork
  await expect(portal.locator('#ens-status')).toContainText('All clear', { timeout: 60_000 });
  await expect(portal.locator('#ens-site')).toContainText('3 scripts');
  await expect(portal.locator('#st-site')).toContainText('Up');
  await shot(portal, 'portal-e2e');

  // ---------- 1. the real site: verified (and DemoSwap's demo bar says so to the audience) ----------
  const site = await openFrom(ctx, portal, 'verified');
  await site.waitForURL(`${w.siteUrl}/`);
  await expect.poll(async () => (await ext.tab(w.siteUrl))?.site?.kind, { timeout: 30_000 }).toBe('protocol');
  await expect.poll(async () => (await ext.tab(w.siteUrl))?.site, { timeout: 30_000 }).toMatchObject({ kind: 'protocol', verdict: 'match' });
  expect((await ext.tab(w.siteUrl))!.badge).toBe('✓');
  await expect(site.locator('#demobar')).toHaveAttribute('data-demo-mode', 'normal', { timeout: 10_000 });
  await expect(site.locator('#demo-text')).toContainText('You are on the real DemoSwap');
  await shot(site, 'demoswap-e2e');
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(ext.url('sidepanel.html'));
  await site.bringToFront();
  await panel.bringToFront();
  await expect(panel.locator('[data-site="match"]')).toContainText(`Verified ${w.ensName} site`, { timeout: 15_000 });
  await panel.close();
  await site.close();

  // ---------- 2. DNS hijack: the portal flips the harness, the extension replaces the tab ----------
  const hijacked = await openFrom(ctx, portal, 'hijack');
  await expect(portal.locator('#st-dns')).toContainText('Hijacked', { timeout: 10_000 });
  await hijacked.waitForURL(/warning\.html\?reason=mismatch/, { timeout: 30_000 });
  await expect(hijacked.locator('[data-reason="mismatch"]')).toBeVisible();
  await expect(hijacked.locator('[data-unknown]')).toContainText('/inject.js');
  await expect(hijacked.getByRole('button', { name: /continue/i })).toHaveCount(0);
  await hijacked.close();

  // ---------- 4. malicious approval on an unknown site ----------
  const approve = await openFrom(ctx, portal, 'approve');
  await approve.waitForURL(attackUrl(w, 'drainer'));
  await expect(portal.locator('#st-dns')).toContainText('Normal'); // every scenario resets first
  await expect(approve.locator('[data-attack-page="approve"]')).toBeVisible();
  await expectDrainerStopped(ctx, approve, /ALL of this token/);
  await approve.close();

  // ---------- 5. Permit2 signature phishing (through the guided demo) ----------
  await portal.bringToFront();
  await portal.locator('.gstep[data-step="4"]').click();
  await expect(portal.locator('#g-title')).toHaveText('Permit2 signature phishing');
  const [permit] = await Promise.all([ctx.waitForEvent('page'), portal.locator('#g-actions [data-run="permit"]').click()]);
  await permit.waitForURL(attackUrl(w, 'permit'));
  await expectDrainerStopped(ctx, permit, /Permit2/);
  await permit.close();

  // ---------- 6. setApprovalForAll "NFT airdrop" ----------
  const nft = await openFrom(ctx, portal, 'nft');
  await nft.waitForURL(attackUrl(w, 'nft'));
  await expectDrainerStopped(ctx, nft, /spend|move|NFT|ALL/i);
  await nft.close();

  // the guided demo's Reset everything puts the harness back
  await portal.bringToFront();
  await portal.locator('#g-reset').click();
  await expect(portal.locator('#g-reset-msg')).toHaveText('Everything reset.');
  await expect(portal.locator('#st-dns')).toContainText('Normal');
});
