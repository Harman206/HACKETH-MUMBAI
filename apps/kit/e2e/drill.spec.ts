import { expect, test } from '@playwright/test';
import { installTestWallet, presetSettings, state } from './helpers';

/**
 * Fire drill: the judge presses the three switches on the control page, then the user exits from the kit.
 * The kit's quorum includes the protocol's primary RPC (rpc-proxy), which is down; the wallet broadcasts on its own RPC.
 */
test('drill: site down + RPC down + hijack → exit still lands; report shows detection and time-to-exit', async ({ page, context }) => {
  const s = state();
  const d = s.drill;

  // 1. The judge breaks things on the control page.
  const control = await context.newPage();
  await control.goto(d.control);
  for (const label of ['Take the website down', 'Take the RPC down', 'Hijack the domain']) await control.getByRole('button', { name: label }).click();
  await expect(control.locator('#site')).toHaveText('down');
  await expect(control.locator('#rpc')).toHaveText('down');
  await expect(control.locator('#dns')).toHaveText('HIJACKED');
  await expect(fetch(d.site)).rejects.toThrow();
  await expect(fetch(d.rpcProxy, { method: 'POST', body: '{}' })).rejects.toThrow();
  expect(await (await fetch(d.router, { headers: { host: 'demoswap.localhost' } })).text()).toContain('/inject.js');

  // 2. The user exits from the saved kit.
  await installTestWallet(page, s, d.wallet);
  await presetSettings(page, s, { userRpcs: { '11155111': [d.rpcProxy, ...s.rpcs] }, drillUrl: d.control });
  await page.goto(s.kitUrl);
  await page.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  for (const id of d.positions) await expect(page.locator(`[data-position="${id}"]`)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Exit all' }).click();
  for (const id of d.positions) {
    await expect(page.locator(`[data-position="${id}"] [data-status]`)).toHaveAttribute('data-status', 'recovered', { timeout: 60_000 });
  }

  // 3. The drill report.
  await expect.poll(async () => (await (await fetch(`${d.control}/drill-report.json`)).json()).exitTxHashes.length, { timeout: 15_000 }).toBe(3);
  const r = await (await fetch(`${d.control}/drill-report.json`)).json();
  expect(r.failures.map((f: { kind: string }) => f.kind)).toEqual(['site-down', 'rpc-down', 'hijack-on']);
  expect(r.timeToExitSec).toBeGreaterThan(0);
  expect(r.timeToExitSec).toBeLessThan(60);
  expect(r.tamperedKitDetected).toBe(true);
  expect(r.tamperedKitVerifier).toMatch(/MISMATCH/);
  expect(r.hijackApprovalRejected).toBe(true);
  expect(r.hijackGuardReasons.join(' ')).toMatch(/approve/);
  expect(r.balances.every((b: { status: string }) => b.status === 'recovered')).toBe(true);

  await control.getByRole('button', { name: 'Reset all' }).click();
  await expect(control.locator('#site')).toHaveText('up');
});
