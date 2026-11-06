import type { BrowserContext, Page } from '@playwright/test';
import { expect, follow, shot, test } from './fixtures';

const confirmWindow = (ctx: BrowserContext) => ctx.waitForEvent('page', { predicate: (p) => p.url().includes('/confirm.html'), timeout: 20_000 });
const walletCalls = (p: Page) => p.evaluate(() => (window as any).__walletCalls as string[]);

test('an ordinary dapp asks for an unlimited approval to a drainer: stopped in a trusted window, the wallet never sees it', async ({ ctx, ext, w }) => {
  await follow(ext, w);
  const dapp = await ctx.newPage();
  await dapp.goto(`${w.pages}/dapp.html`);
  const [win] = await Promise.all([confirmWindow(ctx), dapp.locator('#go').click()]);
  await expect(win.locator('[data-verdict="dangerous"]')).toBeVisible();
  await expect(win.getByText('This looks like a wallet drainer')).toBeVisible();
  await expect(win.locator('[data-reasons]')).toContainText('ALL of this token');
  await expect(win.locator('#continue')).toBeDisabled(); // needs the tick box first
  await shot(win, 'confirm');
  await win.locator('#cancel').click();
  await expect(dapp.locator('#result')).toHaveText('error 4001');
  expect(await walletCalls(dapp)).not.toContain('eth_sendTransaction');

  // the user may still choose to continue, after ticking the box
  const [win2] = await Promise.all([confirmWindow(ctx), dapp.locator('#go').click()]);
  await win2.locator('#understand').check();
  await win2.locator('#continue').click();
  await expect(dapp.locator('#result')).toHaveText('sent', { timeout: 30_000 });
  const s = (await ext.state()).stats;
  expect([s.requestsChecked.dangerous, s.requestsBlocked, s.requestsAllowedAfterWarning]).toEqual([2, 1, 1]);
});

test('a cross-origin iframe asking for the approval is caught too', async ({ ctx, ext, w }) => {
  await follow(ext, w);
  const page = await ctx.newPage();
  const [win] = await Promise.all([confirmWindow(ctx), page.goto(`${w.pages}/frame.html`)]);
  await expect(win.locator('[data-verdict="dangerous"]')).toBeVisible();
  await expect(win.getByText(new URL(w.pagesAlt).origin)).toBeVisible();
  await win.close(); // closing the window = cancel
  await expect(page.frameLocator('#f').locator('#result')).toHaveText('error 4001');
});

test('a page flooding signature requests gets 3 prompts a minute, the rest are refused', async ({ ctx, ext, w }) => {
  await follow(ext, w);
  const page = await ctx.newPage();
  await page.goto(`${w.pages}/flood.html`);
  const windows: Page[] = [];
  ctx.on('page', (p) => p.url().includes('/confirm.html') && windows.push(p));
  const done = page.evaluate(() => (window as any).flood());
  await expect.poll(() => windows.length, { timeout: 20_000 }).toBe(3);
  await page.waitForTimeout(1000);
  expect(windows.length).toBe(3);
  for (const win of windows) await win.close();
  await done;
  await expect(page.locator('#result')).toHaveText('4001,4001,4001,4001,4001,4001');
  expect(await walletCalls(page)).not.toContain('eth_sign');
  expect((await ext.state()).stats.pageNoise).toBe(3);
});

test('hostile page: forged answers and malformed messages change nothing; no extension API is reachable', async ({ ctx, ext, w }) => {
  await follow(ext, w);
  const page = await ctx.newPage();
  await page.goto(`${w.pages}/hostile.html`);
  await expect(page.locator('#probe[data-done]')).toBeAttached();
  expect(JSON.parse((await page.locator('#probe').textContent())!)).toEqual({ runtime: false, storage: false });

  // a reference to the provider grabbed by the page itself is still checked
  const [win] = await Promise.all([confirmWindow(ctx), page.evaluate(() => { void (window as any).go(); })]);
  await win.locator('#cancel').click();
  await expect(page.locator('#result')).toHaveText('error 4001');

  const s = await ext.state();
  expect(s.settings.account).toBe(w.wallet); // the bogus kit-address message did not touch it
  expect(s.pendingAddress).toBeNull();
  expect(s.stats.requestsChecked.dangerous).toBe(1);
  expect(s.stats.pageNoise).toBeGreaterThan(0);
  expect(s.stats.pageNoise).toBeLessThanOrEqual(21); // the content script caps relayed noise per page
  expect(s.stats.verified + s.stats.mismatched).toBe(0);
});

test('the warning page cannot be fetched by a web page (no fingerprinting of the extension)', async ({ ctx, ext, w }) => {
  const page = await ctx.newPage();
  await page.goto(`${w.pages}/dapp.html`);
  const ok = await page.evaluate((id) => fetch(`chrome-extension://${id}/src/pages/warning.html`).then(() => true, () => false), ext.id);
  expect(ok).toBe(false);
});
