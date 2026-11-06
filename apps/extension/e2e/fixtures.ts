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
      // the kit reads its RPCs from localStorage: point it at the fork
      if (location.port === kitPort && !localStorage.getItem('copeybara.settings.v1')) {
        localStorage.setItem('copeybara.settings.v1', JSON.stringify({ targetChainId: 11155111, userRpcs: { '11155111': rpcs }, slippageBps: 50, useDefaultRpcs: false, drillUrl: '' }));
      }
    },
    { rpc: w.rpcs[0]!, account: w.wallet, kitPort: new URL(w.kitUrl).port, rpcs: w.rpcs },
  );
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
    await page.goto(`chrome-extension://${id}/src/pages/popup.html`);
    const ext = new Ext(id, page, sw);
    await ext.configure(w);
    await use(ext);
  },
});

export { expect };

/** Follow the test protocol through the extension (no UI): for specs that are not about setup. */
export async function follow(ext: Ext, w: World) {
  const s = await ext.send<PublicState>({ t: 'follow', name: w.ensName });
  expect(s.protocols[0]?.snapshot?.release.version).toBe(5);
  await ext.send({ t: 'settings', patch: { account: w.wallet, setupDone: true } });
}
