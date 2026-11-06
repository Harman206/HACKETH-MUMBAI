import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
import type { Page } from '@playwright/test';

export interface E2EState {
  kitUrl: string;
  kitSha256: string;
  rpcs: string[];
  ensName: string;
  wallet: string;
  positions: { inRange: string; outOfRange: string; owedOnly: string };
  drill: { wallet: string; positions: string[]; control: string; router: string; site: string; rpcProxy: string };
  theater: { site: string; control: string; victim: string; rpcProxy: string };
}

export const state = (): E2EState => JSON.parse(readFileSync(join(HERE, '.state.json'), 'utf8'));

/**
 * Test wallet: an EIP-1193 provider announced via EIP-6963, backed by anvil's unlocked account.
 * It is injected with addInitScript (CDP), so it is not part of the kit and not subject to the kit's CSP.
 */
export async function installTestWallet(page: Page | import('@playwright/test').BrowserContext, s: E2EState, account = s.wallet) {
  await page.addInitScript(
    ({ rpc, account }) => {
      let id = 1;
      const send = async (method: string, params: unknown[] = []) => {
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
        return j.result;
      };
      const provider = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
          if (method === 'wallet_switchEthereumChain') return null;
          if (method.startsWith('eth_sign') || method.startsWith('personal_sign')) throw new Error(`test wallet refuses ${method}`);
          (window as unknown as { __walletCalls: string[] }).__walletCalls.push(method);
          return send(method, params ?? []);
        },
      };
      (window as unknown as { __walletCalls: string[] }).__walletCalls = [];
      (window as unknown as { ethereum: unknown }).ethereum = provider; // classic injection (what a hijacked page's script uses)
      window.addEventListener('eip6963:requestProvider', () =>
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'Test Wallet', rdns: 'test.wallet', uuid: 't', icon: 'data:,' }, provider } })),
      );
    },
    { rpc: s.rpcs[0]!, account },
  );
}

export async function presetSettings(page: Page | import('@playwright/test').BrowserContext, s: E2EState, over: Record<string, unknown> = {}) {
  await page.addInitScript(
    (settings) => localStorage.setItem('blackout.settings.v1', JSON.stringify(settings)),
    { ensName: s.ensName, targetChainId: 11155111, userRpcs: { '11155111': s.rpcs }, slippageBps: 50, useDefaultRpcs: false, drillUrl: '', ...over },
  );
}
