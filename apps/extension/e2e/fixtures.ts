import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PublicState, SiteState } from '../src/shared/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist', 'chrome');

export interface World {
  ensName: string;
  rpcs: string[];
  forkUrl: string;
  wallet: string;
  positions: string[];
  kitUrl: string;
  kitSha: string;
  siteUrl: string;
  siteRecord: string;
  lookalike: string;
  pages: string;
  pagesAlt: string;
  control: string;
  drainer: { to: string; data: string };
  /** Demo Portal (harness control server) */
  portal: string;
}
export const world = (): World => JSON.parse(readFileSync(join(HERE, '.state.json'), 'utf8'));

/** Talks to the extension the way its own pages do (chrome.runtime.sendMessage from an extension page). */
export class Ext {
  id: string;
  sw: Worker;
  private page: Page;
  constructor(id: string, page: Page, sw: Worker) {
    this.id = id;
    this.page = page;
    this.sw = sw;
  }
  url(p: string) {
    return `chrome-extension://${this.id}/src/pages/${p}`;
  }
  send<T = unknown>(m: unknown): Promise<T> {
    return this.page.evaluate((msg) => (globalThis as any).chrome.runtime.sendMessage(msg), m) as Promise<T>;
  }
  state() {
    return this.send<PublicState>({ t: 'getState' });
  }
  async configure(w: World) {
    await this.send({ t: 'settings', patch: { useDefaultRpcs: false, userRpcs: w.rpcs, kitUrl: w.kitUrl } });
  }
  /** The worker's verdict for the tab currently showing `prefix` (and its badge text). */
  async tab(prefix: string): Promise<{ site: SiteState; badge: string; url: string } | null> {
    return this.page.evaluate(async (pre) => {
      const c = (globalThis as any).chrome;
      const t = (await c.tabs.query({})).find((x: { url?: string }) => x.url?.startsWith(pre));
      if (!t) return null;
      return { site: await c.runtime.sendMessage({ t: 'getTab', tabId: t.id }), badge: await c.action.getBadgeText({ tabId: t.id }), url: t.url };
    }, prefix);
  }
}

export async function control(w: World, path: string) {
  const r = await fetch(`${w.control}${path}`, { method: 'POST' });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json().catch(() => null);
}

export function installTestWallet(ctx: BrowserContext, w: World) {
  return ctx.addInitScript(
    ({ rpc, account, kitPort, rpcs }) => {
      let id = 1;
      const send = async (method: string, params: unknown[] = []) => {
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
        return j.result;
      };
      const calls: string[] = [];
      (window as any).__walletCalls = calls;
      // init scripts normally run before any page script; on a page Playwright attached to late they run after it
      (window as any).__testWalletLate = document.readyState !== 'loading';
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
          if (method === 'wallet_switchEthereumChain') return null;
          calls.push(method);
          if (method.startsWith('eth_sign') || method === 'personal_sign') return '0x' + '11'.repeat(65);
          return send(method, params ?? []);
        },
      };
      (window as any).ethereum = provider;
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'Test Wallet', rdns: 'test.wallet', uuid: 't', icon: 'data:,' }, provider } })),
      );
      // the kit reads its RPCs from localStorage: point it at the fork (always: an earlier load of the kit without
      // this script, see ensureTestWallet, has already saved the public defaults there)
      if (location.port === kitPort) {
        let saved: Record<string, unknown> = {};
        try {
          saved = JSON.parse(localStorage.getItem('copeybara.settings.v1') ?? '{}') ?? {};
        } catch {
          /* replaced below */
        }
        localStorage.setItem('copeybara.settings.v1', JSON.stringify({ slippageBps: 50, drillUrl: '', ...saved, targetChainId: 11155111, userRpcs: { '11155111': rpcs }, useDefaultRpcs: false }));
      }
    },
    { rpc: w.rpcs[0]!, account: w.wallet, kitPort: new URL(w.kitUrl).port, rpcs: w.rpcs },
  );
}

/**
 * Pages the extension opens itself (chrome.tabs.create: the kit from setup and from the dashboard) can load their
 * first document before Playwright has attached to the new tab. The context init script (test wallet + the kit's fork
 * RPCs) then either never runs there, or runs only after the kit has started (and saved its public-RPC defaults):
 * no wallet when the button is clicked, or a kit reading real Sepolia, where the e2e name does not exist.
 * Reload such a page once; the reload runs with the init script first. The caller asserts the opened URL before this.
 */
export async function ensureTestWallet(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  const state = () => page.evaluate(() => (!Array.isArray((window as any).__walletCalls) ? 'missing' : (window as any).__testWalletLate ? 'late' : 'ok'));
  const s = await state();
  if (s === 'ok') return;
  console.log(`[e2e] init script ${s} on ${page.url()} (opened by the extension before Playwright attached): reloading`);
  await page.reload();
  expect(await state()).toBe('ok');
}

export const test = base.extend<{ w: World; ctx: BrowserContext; ext: Ext }>({
  w: async ({}, use) => use(world()),
  ctx: async ({ w }, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await installTestWallet(ctx, w);
    await use(ctx);
    await ctx.close();
  },
  ext: async ({ ctx, w }, use) => {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/src/pages/sidepanel.html`);
    const ext = new Ext(id, page, sw);
    await ext.configure(w);
    await use(ext);
  },
});

export { expect };

/** UI_SHOTS=<dir> saves full-page screenshots of the trusted pages as <dir>/ui-<name>.png (light, then dark). */
export async function shot(page: Page, name: string) {
  const dir = process.env.UI_SHOTS;
  if (!dir) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/ui-${name}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300); // let colour transitions settle
  await page.screenshot({ path: `${dir}/ui-${name}-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: null });
}

/** Follow the test protocol through the extension (no UI): for specs that are not about setup. */
export async function follow(ext: Ext, w: World) {
  const s = await ext.send<PublicState>({ t: 'follow', name: w.ensName });
  expect(s.protocols[0]?.snapshot?.release.version).toBe(5);
  await ext.send({ t: 'settings', patch: { account: w.wallet, setupDone: true } });
}
