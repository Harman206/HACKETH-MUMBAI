import type { Page } from '@playwright/test';
import { control, ensureTestWallet, expect, shot, test } from './fixtures';

/**
 * The whole product, as a beginner meets it:
 * install → setup (wallet via the kit, follow the protocol by ENS name) → dashboard with auto-detected positions
 * → verified badge on the real site → DNS hijack stopped (site fingerprint) → watcher flips the ENS status → site
 * blocked before it loads → look-alike blocked (ENS blocklist) → watcher clears after recovery → exit from the
 * dashboard through the verified kit → recovered. Stats asserted exactly along the way.
 */
test('beginner journey: set up, verify, survive a DNS hijack, exit', async ({ ctx, ext, w }) => {
  // ---------- 1. setup wizard ----------
  const setup = await ctx.newPage();
  await setup.goto(ext.url('setup.html'));
  await shot(setup, 'setup-welcome');
  await setup.getByRole('button', { name: 'Start' }).click();
  await expect(setup.locator('[data-step="Wallet"]')).toBeVisible();

  // wallet via the kit (wallets work there): the kit hands over only the address; the user confirms it here
  const [kit] = await Promise.all([ctx.waitForEvent('page'), setup.getByRole('button', { name: 'Open the kit to connect' }).click()]);
  await expect(kit).toHaveURL(/#connect=copeybara$/);
  await ensureTestWallet(kit);
  await kit.getByRole('button', { name: 'Use this wallet in Copeybara' }).click();
  await expect(kit.getByText(/Sent .* to the Copeybara extension/)).toBeVisible({ timeout: 20_000 }).catch(async (e) => {
    console.log('[handoff text]', (await kit.locator('[data-copeybara-handoff]').innerText()).slice(0, 800));
    console.log('[handoff env]', await kit.evaluate(() => JSON.stringify({ eth: typeof (window as any).ethereum, calls: (window as any).__walletCalls, shim: (window as any).__copeybaraShim, ls: localStorage.getItem('copeybara.settings.v1'), href: location.href })));
    throw e;
  });
  await kit.close();
  await expect(setup.locator(`[data-pending="${w.wallet}"]`)).toBeVisible({ timeout: 10_000 });
  await shot(setup, 'setup-wallet');
  await setup.getByRole('button', { name: 'Yes, use it' }).click();
  await expect(setup.locator(`[data-account="${w.wallet}"]`)).toBeVisible();
  await setup.getByRole('button', { name: 'Next' }).click();

  // the Copeybara certified picker (bundled directory): each tick is re-checked on chain by the worker, never taken from the list
  const pick = setup.locator('[data-certified="demoswap-blackout.eth"]');
  await expect(pick).toBeVisible();
  await expect(pick.getByRole('button', { name: 'Follow DemoSwap' })).toBeVisible();
  await expect(pick).not.toHaveAttribute('data-live', 'checking', { timeout: 60_000 });
  await shot(setup, 'setup-certified');

  // follow the protocol by its ENS name: records read through the quorum, contracts and fingerprints shown
  await setup.locator('#ens').fill(w.ensName);
  await setup.locator('#follow').click();
  const card = setup.locator(`[data-protocol="${w.ensName}"]`);
  await expect(card).toContainText('v5', { timeout: 60_000 });
  await expect(card).toContainText('3 scripts');
  await expect(card).toContainText('uniswap-v3 · positionManager');
  await expect(card).toContainText('All clear');
  await shot(setup, 'setup-protocols');
  await setup.getByRole('button', { name: 'Next' }).click();
  await expect(setup.locator('[data-step="Connections"]')).toBeVisible();
  await setup.getByRole('button', { name: 'Test' }).first().click();
  await expect(setup.locator(`[data-rpc-test="${w.rpcs[0]}"]`)).toContainText('✓ Sepolia');
  await shot(setup, 'setup-connections');
  await setup.getByRole('button', { name: 'Next' }).click();
  await shot(setup, 'setup-done');
  const [dash] = await Promise.all([ctx.waitForEvent('page'), setup.locator('#finish').click()]);

  // ---------- 2. dashboard: positions found straight from the contracts, with amounts ----------
  await expect(dash.locator('[data-position]')).toHaveCount(3, { timeout: 90_000 });
  await shot(dash, 'dashboard');
  for (const id of w.positions) await expect(dash.locator(`[data-position="${id}"]`)).toContainText(/\d/);
  expect((await ext.state()).settings.setupDone).toBe(true);

  // ---------- 3. the real site: every script matches the Safe-published fingerprint ----------
  const site = await ctx.newPage();
  await site.goto(w.siteUrl);
  await expect.poll(async () => (await ext.tab(w.siteUrl))?.site, { timeout: 30_000 }).toMatchObject({ kind: 'protocol', verdict: 'match' });
  expect((await ext.tab(w.siteUrl))!.badge).toBe('✓');
  await site.close();

  // ---------- 4. DNS hijack: same domain, injected code → the page is replaced before the user can click ----------
  await control(w, '/harness/hijack-on');
  const hijacked = await ctx.newPage();
  await hijacked.goto(w.siteUrl).catch(() => {});
  await hijacked.waitForURL(/warning\.html\?reason=mismatch/, { timeout: 30_000 });
  await expect(hijacked.locator('[data-reason="mismatch"]')).toBeVisible();
  await expect(hijacked.locator('[data-unknown]')).toContainText('/inject.js');
  await expect(hijacked.locator('[data-unknown]')).toContainText('inline script');
  await expect(hijacked.getByRole('button', { name: /continue/i })).toHaveCount(0);
  await shot(hijacked, 'warning-mismatch');

  // ---------- 5. the watcher sees it too and raises the alarm on ENS (its key can write status + blocklist only) ----------
  await control(w, '/watcher/tick'); // 1st mismatch (and the look-alike goes on the blocklist)
  const st = (await control(w, '/watcher/tick')) as Record<string, { status: string; blocklist: string[]; events: { kind: string }[] }>;
  expect(st[w.ensName]!.status).toBe('compromised');
  expect(st[w.ensName]!.blocklist).toEqual(['demoswap-rewards.localhost']);
  const synced = await ext.send<{ protocols: { snapshot: { status: { state: string; note?: string }; blocklist: string[] } }[] }>({ t: 'sync' });
  expect(synced.protocols[0]!.snapshot.status.state).toBe('compromised');
  expect(synced.protocols[0]!.snapshot.status.note).toMatch(/never published/);

  // every extension now blocks the official site before it loads (declarativeNetRequest redirect)
  const blocked = await ctx.newPage();
  await blocked.goto(w.siteUrl).catch(() => {});
  await blocked.waitForURL(/warning\.html\?reason=compromised/, { timeout: 15_000 });
  await expect(blocked.getByText(/never published/)).toBeVisible();
  await shot(blocked, 'warning-compromised');

  // and the look-alike domain
  const fake = await ctx.newPage();
  await fake.goto(w.lookalike).catch(() => {});
  await fake.waitForURL(/warning\.html\?reason=blocklist/, { timeout: 15_000 });
  await expect(fake.getByText('demoswap-rewards.localhost').first()).toBeVisible();

  // ---------- 6. recovery: DNS fixed → the watcher clears its own alarm after 5 clean checks ----------
  await control(w, '/harness/reset');
  let last: Record<string, { status: string }> = {};
  for (let i = 0; i < 5; i++) last = (await control(w, '/watcher/tick')) as typeof last;
  expect(last[w.ensName]!.status).toBe('ok');
  await ext.send({ t: 'sync' });
  const back = await ctx.newPage();
  await back.goto(w.siteUrl);
  await expect.poll(async () => (await ext.tab(w.siteUrl))?.site, { timeout: 30_000 }).toMatchObject({ verdict: 'match' });

  // ---------- 7. stats: exactly what happened ----------
  const s = (await ext.state()).stats;
  expect(s.verified).toBe(2);
  expect(s.mismatched).toBe(1);
  expect(s.pagesBlocked).toEqual({ compromised: 1, blocklist: 1, mismatch: 1 });
  expect(s.requestsBlocked).toBe(0);

  // ---------- 8. exit from the dashboard through the verified kit ----------
  await dash.reload();
  const [kit2] = await Promise.all([ctx.waitForEvent('page'), dash.locator(`[data-protocol="${w.ensName}"]`).locator('xpath=..').getByRole('button', { name: 'Exit safely' }).click()]);
  await expect(kit2).toHaveURL(`${w.kitUrl}?ens=${w.ensName}`);
  await ensureTestWallet(kit2);
  await exitAll(kit2, w.positions);
});

async function exitAll(kit: Page, positions: string[]) {
  await kit.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(kit.getByText('Release v5')).toBeVisible({ timeout: 60_000 }).catch(async (e) => {
    console.log('[kit detail]', (await kit.locator('details').allTextContents()).join(' | ').slice(0, 1500));
    console.log('[kit ls]', await kit.evaluate(() => localStorage.getItem('copeybara.settings.v1')));
    throw e;
  });
  for (const id of positions) await expect(kit.locator(`[data-position="${id}"]`)).toBeVisible();
  await kit.getByRole('button', { name: 'Exit all' }).click();
  for (const id of positions) {
    await expect(kit.locator(`[data-position="${id}"] [data-status]`)).toHaveAttribute('data-status', 'recovered', { timeout: 90_000 });
  }
}
