/**
 * LIVE Sepolia rehearsal of the whole Attack Theater, headless, with a throwaway victim key that really signs.
 *   cd apps/kit && pnpm exec tsx e2e-live/rehearse-live.ts
 * Needs contracts/.env (DEPLOYER_KEY funded, ATTACKER_KEY funded), contracts/deployments/sepolia-attack.json,
 * and the current kit published as the ENS release (contracts/script/live-setup.sh). Writes demo-runs/latest.json.
 */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createQuorum } from '@blackout/quorum';
import { startHarness } from '../../../harness/services/control';
import { createDrainerBot } from '../../../harness/services/drainer-bot';
import { loadEnv, makePrepareVictim, makeReadVictim, makeSender, transportFor } from '../../../harness/services/chain';
import networks from '../../../config/networks.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const env = loadEnv();
const RPC = env.SEPOLIA_RPC ?? 'https://sepolia.gateway.tenderly.co';
const PUBLIC = networks.defaultRpcs['11155111'];
const attack = JSON.parse(readFileSync(join(REPO, 'contracts', 'deployments', 'sepolia-attack.json'), 'utf8')) as { drainer: Address; DUSD: Address; DETH: Address };
const ensName = 'demoswap-blackout.eth';
const free = () => new Promise<number>((r) => { const s = netServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const victimKey = (process.env.REHEARSAL_VICTIM_KEY as Hex | undefined) ?? generatePrivateKey();
mkdirSync(join(REPO, 'contracts', 'deployments'), { recursive: true });
writeFileSync(join(REPO, 'contracts', '.rehearsal-victim.key'), victimKey); // gitignored; lets a rerun reuse a funded victim
const victim = privateKeyToAccount(victimKey);
const pub = createPublicClient({ chain: sepolia, transport: transportFor(RPC) });
const victimWallet = createWalletClient({ chain: sepolia, account: victim, transport: transportFor(RPC) });
log(`throwaway victim ${victim.address}`);

// --- harness against real Sepolia ---
const kitFile = join(REPO, 'apps', 'kit', 'dist', 'blackout-kit.html');
const q = createQuorum({ urls: PUBLIC, expectedChainId: 11155111 });
const bot = createDrainerBot({ q, send: makeSender(RPC, env.ATTACKER_KEY as Hex), drainer: attack.drainer, tokens: [attack.DUSD], fromBlock: (await q.pinBlock()) - 2n, pollMs: 2000 });
bot.start();
const kitPort = await free();
const kitServer = createServer((_q, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(kitFile)));
await new Promise<void>((r) => kitServer.listen(kitPort, '127.0.0.1', r));
const ports = { control: await free(), router: await free(), site: await free(), hijack: await free(), rpc: await free() };
const harness = await startHarness({
  primaryRpc: RPC, kitFile, ensName, ensRpcs: PUBLIC, chainId: 11155111, universalResolver: networks.ens.universalResolver as Address,
  token: attack.DUSD, drainer: attack.drainer, ports, mode: 'process', kitUrl: `http://localhost:${kitPort}`,
  theater: {
    network: 'sepolia',
    prepareVictim: makePrepareVictim({ rpcUrl: RPC, deployerKey: env.DEPLOYER_KEY as Hex, dusd: attack.DUSD, deth: attack.DETH }),
    readVictim: makeReadVictim({ q, dusd: attack.DUSD }),
    drains: bot.records,
    tokens: { [attack.DUSD]: 'DUSD', [attack.DETH]: 'DETH' },
  },
});
const siteDist = join(REPO, 'apps', 'site', 'dist');
const sitePort = await free();
const siteServer = createServer((req, res) => {
  const p = (req.url ?? '/').split('?')[0]!;
  const f = join(siteDist, p === '/' ? 'index.html' : p);
  let body: Buffer;
  try { body = readFileSync(f); } catch { return void res.writeHead(404).end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/plain' }).end(body);
});
await new Promise<void>((r) => siteServer.listen(sitePort, '127.0.0.1', r));

// --- browser with a wallet that really signs (Node side) ---
const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext();
// Signer proxy: a local JSON-RPC endpoint that behaves like an unlocked node for the throwaway victim
// (signs eth_sendTransaction, refuses typed-data signing, forwards everything else to Sepolia). The page-side
// wallet is the same fetch-based provider the fork e2e uses.
async function rpcHandler(method: string, params: unknown[]) {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [victim.address];
  if (method === 'eth_chainId') return '0xaa36a7';
  if (method === 'wallet_switchEthereumChain') return null;
  if (method === 'eth_sendTransaction') {
    const t = params[0] as { to: Address; data?: Hex; value?: Hex; gas?: Hex };
    const hash = await victimWallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : 0n, gas: t.gas ? BigInt(t.gas) : undefined });
    log(`victim signed ${t.data?.slice(0, 10) ?? 'transfer'} → ${hash}`);
    return hash;
  }
  if (/sign/i.test(method)) throw Object.assign(new Error(`rehearsal wallet refuses ${method}`), { code: 4001 });
  return pub.request({ method: method as never, params: params as never }); // fallback transport across public RPCs
}
const signerPort = await free();
const signer = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const { id, method, params } = JSON.parse(body || '{}');
    try {
      const result = await rpcHandler(method, params ?? []);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (e) {
      log(`wallet ${method} FAILED: ${(e as Error).message.split('\n')[0]}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: (e as { code?: number }).code ?? -32000, message: (e as Error).message } }));
    }
  });
});
await new Promise<void>((r) => signer.listen(signerPort, '127.0.0.1', r));
await ctx.addInitScript((rpc: string) => {
  let id = 1;
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params ?? [] }) });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
      return j.result;
    },
  };
  (window as unknown as { ethereum: unknown }).ethereum = provider;
  window.addEventListener('eip6963:requestProvider', () =>
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'Rehearsal Wallet', rdns: 'rehearsal.wallet', uuid: 'r', icon: 'data:,' }, provider } })),
  );
}, `http://127.0.0.1:${signerPort}`);
await ctx.addInitScript(
  (rpcProxy) => localStorage.setItem('blackout.settings.v1', JSON.stringify({ ensName: 'demoswap-blackout.eth', targetChainId: 11155111, userRpcs: { '11155111': [rpcProxy] }, slippageBps: 50, useDefaultRpcs: true, drillUrl: '' })),
  `http://localhost:${ports.rpc}`,
);

const T = { timeout: 240_000 };
try {
  const site = await ctx.newPage();
  await site.goto(`http://localhost:${sitePort}/?booth=${encodeURIComponent(`http://localhost:${ports.control}`)}`);
  await expect(site.getByRole('heading', { name: 'Attack Theater: live' })).toBeVisible(T);
  log('chapter 1: prepare victim');
  await site.locator('#victim').fill(victim.address);
  await site.getByRole('button', { name: 'Prepare victim wallet' }).click();
  const watch = setInterval(async () => {
    try {
      const st = await (await fetch(`http://localhost:${ports.control}/theater/state`)).json();
      const alerts = await site.locator('[role=alert]').allTextContents().catch(() => []);
      log(`  state: victim=${st.victim} dusd=${st.victimDusd} positions=${st.victimPositions?.join(',')} prepareTxs=${st.prepareTxs?.length} chapter=${st.chapter} alerts=${JSON.stringify(alerts)}`);
    } catch (e) { log(`  state poll failed: ${(e as Error).message}`); }
  }, 15_000);
  await expect(site.getByRole('button', { name: 'Hijack the domain' })).toBeEnabled(T); // unlocks only once prepare fully landed
  await expect(site.getByText(/holds [\d,]+ DUSD/)).toBeVisible(T);
  clearInterval(watch);
  log('chapter 2: hijack + approve');
  await site.getByRole('button', { name: 'Hijack the domain' }).click();
  const [demo] = await Promise.all([ctx.waitForEvent('page'), site.getByRole('link', { name: /Open DemoSwap \(now fake\)/ }).click()]);
  demo.on('console', (m) => log(`demoswap console: ${m.text()}`));
  await expect(demo.getByText('Approve to view your rewards')).toBeVisible(T);
  await demo.getByRole('button', { name: 'Connect wallet' }).click();
  log('clicked Connect on the hijacked DemoSwap');
  await expect(site.locator('.scoreboard .big.bad')).toContainText('DUSD', T);
  log('chapter 3: outage');
  await site.getByRole('button', { name: 'Take the website down' }).click();
  await site.getByRole('button', { name: 'Take the RPC down' }).click();
  log('chapter 4: verify + rescue');
  await site.getByRole('button', { name: /Verify the saved kit/ }).click();
  await expect(site.getByText(/^MATCH v=\d+/)).toBeVisible(T);
  await expect(site.getByText(/^MISMATCH/)).toBeVisible(T);
  const [kit] = await Promise.all([ctx.waitForEvent('page'), site.getByRole('link', { name: 'Open the kit and exit' }).click()]);
  await kit.getByRole('button', { name: 'Connect wallet and find my positions' }).click();
  await expect(kit.locator('[data-position]').first()).toBeVisible(T);
  await kit.getByRole('button', { name: 'Exit all' }).click();
  await expect(kit.locator('[data-status="recovered"]').first()).toBeVisible(T);
  await expect(site.locator('.scoreboard .big.ok')).toContainText('DUSD', T);

  const st = await (await fetch(`http://localhost:${ports.control}/theater/state`)).json();
  const drain = st.drains.find((d: { drainTx: string | null }) => d.drainTx);
  const rescue = (st.rescue?.results ?? []).find((r: { status: string }) => r.status === 'recovered');
  for (const h of [drain.drainTx, rescue.txHashes[0]]) {
    const r = await pub.getTransactionReceipt({ hash: h });
    if (r.status !== 'success') throw new Error(`tx ${h} not successful`);
  }
  const drained = (await site.locator('.scoreboard .big.bad').textContent())!.trim();
  const recovered = (await site.locator('.scoreboard .big.ok').textContent())!.trim();
  mkdirSync(join(REPO, 'demo-runs'), { recursive: true });
  const run = { network: 'sepolia', victim: victim.address, drained, drainTx: drain.drainTx, rescueTx: rescue.txHashes[0], recovered, at: Date.now() };
  writeFileSync(join(REPO, 'demo-runs', 'latest.json'), `${JSON.stringify(run, null, 2)}\n`);
  log(`LIVE REHEARSAL PASSED: lost ${drained}, recovered ${recovered}`);
  log(`drain  https://sepolia.etherscan.io/tx/${run.drainTx}`);
  log(`rescue https://sepolia.etherscan.io/tx/${run.rescueTx}`);
} finally {
  bot.stop();
  await browser.close();
  await harness.stop();
  kitServer.close();
  siteServer.close();
  signer.close();
}
process.exit(0);
