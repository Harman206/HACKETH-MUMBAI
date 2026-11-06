/** Service worker entry: binds the trust core to the real chrome.* APIs. */
import networks from '../../../../config/networks.json';
import { createQuorum } from '@copeybara/quorum';
import { readCopeybaraRecords } from '@copeybara/ens';
import type { Address } from '@copeybara/core';
import { createCore, type ChromeLike } from './core';

declare const chrome: ChromeLike & {
  runtime: ChromeLike['runtime'] & {
    onMessage: { addListener(f: (m: unknown, s: unknown, respond: (r: unknown) => void) => boolean | void): void };
    onInstalled: { addListener(f: (d: { reason: string }) => void): void };
    getManifest(): { version: string };
  };
  alarms: { create(n: string, o: { periodInMinutes: number }): void; onAlarm: { addListener(f: (a: { name: string }) => void): void } };
  tabs: ChromeLike['tabs'] & { onRemoved: { addListener(f: (id: number) => void): void } };
  windows: ChromeLike['windows'] & { onRemoved: { addListener(f: (id: number) => void): void } };
};

const RPCS = (networks.defaultRpcs as Record<string, string[]>)['11155111']!;
export const DEFAULT_KIT_URL = 'https://blackout-red.vercel.app/copeybara-kit.html';

const core = createCore({
  chrome,
  readRecords: (name, rpcs) =>
    readCopeybaraRecords(name, createQuorum({ urls: rpcs, expectedChainId: 11155111, timeoutMs: 8000 }), {
      universalResolver: networks.ens.universalResolver as Address,
    }),
  fetchBytes: async (url) => {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  },
  rpcChainId: async (url) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), credentials: 'omit' });
    const j = (await r.json()) as { result?: string };
    return parseInt(j.result ?? '0', 16);
  },
  now: () => Date.now(),
  defaultRpcs: RPCS,
  defaultKitUrl: DEFAULT_KIT_URL,
  version: chrome.runtime.getManifest().version,
});

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  core.handleMessage(m, sender as Parameters<typeof core.handleMessage>[1]).then(respond, (e) => respond({ error: String((e as Error)?.message ?? e) }));
  return true;
});
chrome.alarms.create('sync', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sync') void core.sync();
});
chrome.tabs.onRemoved.addListener((id) => core.onTabRemoved(id));
chrome.windows.onRemoved.addListener((id) => core.onWindowRemoved(id));
chrome.runtime.onInstalled.addListener(async (d) => {
  await core.load();
  await core.sync();
  if (d.reason === 'install' && !core.publicState().settings.setupDone) await chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/setup.html') });
});
