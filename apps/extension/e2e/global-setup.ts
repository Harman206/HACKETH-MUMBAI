/**
 * Extension E2E world, all real except the chain being an anvil fork of Sepolia:
 *  - a fresh ENSv2 name owned by a 2-of-3 Safe with org.copeybara.{release,manifest,site} + url, a website key
 *    limited to `url` and a watcher key limited to status + blocklist (the same forge scripts as the live setup);
 *  - DemoSwap behind the harness router at http://demoswap.localhost:<port> (switchable: down / DNS hijack),
 *    the hijack clone also reachable as the look-alike http://demoswap-rewards.localhost:<port>;
 *  - three seeded Uniswap v3 positions for the test wallet; the built kit served on http://localhost;
 *  - the watcher agent in-process, ticked on demand through a small control server;
 *  - a plain "unknown dapp" page that asks for a drainer approval, and hostile pages;
 *  - the Demo Portal (harness control server) that drives the scenarios a human runs in the live demo.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseAbi, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { packetToBytes } from 'viem/ens';
import { formatSiteRecord } from '@copeybara/core';
import { readCopeybaraRecords } from '@copeybara/ens';
import { createQuorum } from '@copeybara/quorum';
import { fetchCodeItems } from '@copeybara/sitecheck';
import { FORK_RPCS, startFork, type Fork } from '@copeybara/testkit';
import { startHarness } from '../../../harness/services/control';
import { hijackRequest } from '../../../harness/services/hijack-request';
import { createWatcher } from '../../watcher/src/watcher';
import { PAGES } from './pages';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, '..');
const KIT = join(EXT, '..', 'kit');
const CONTRACTS = join(EXT, '..', '..', 'contracts');
export const STATE = join(HERE, '.state.json');
const FORGE = `${homedir()}/.foundry/bin/forge`;
const CAST = `${homedir()}/.foundry/bin/cast`;
const UR = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';

// anvil default keys (public test keys, fork only)
const K = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // 5: test wallet (positions)
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6', // 9: watcher
] as const;

const free = () => new Promise<number>((r) => { const s = netServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });
const addr = (k: string) => execFileSync(CAST, ['wallet', 'address', '--private-key', k], { encoding: 'utf8' }).trim();
/** Node does not resolve *.localhost; Chromium does. The watcher runs in Node. */
const nodeFetch = (u: string) => {
  const x = new URL(u);
  if (x.hostname.endsWith('.localhost')) x.hostname = '127.0.0.1';
  return fetch(x.href, { redirect: 'manual' });
};

export default async function globalSetup() {
  execFileSync('pnpm', ['build'], { cwd: KIT, env: { ...process.env, SOURCE_DATE_EPOCH: '0' }, stdio: 'pipe' });
  execFileSync('node', ['scripts/build.mjs'], { cwd: EXT, stdio: 'pipe' });
  let lastErr: unknown;
  for (const src of FORK_RPCS[11155111]) {
    let fork: Fork | null = null;
    try {
      fork = await startFork({ chainId: 11155111, forkUrl: src });
      return await buildWorld(fork);
    } catch (e) {
      lastErr = e;
      await fork?.stop().catch(() => {});
    }
  }
  throw lastErr;
}

async function buildWorld(fork: Fork) {
  const kitFile = join(KIT, 'dist', 'copeybara-kit.html');
  const kitHtml = readFileSync(kitFile);
  const kitSha = createHash('sha256').update(kitHtml).digest('hex');
  const port_ = new URL(fork.url).port;
  const rpcs = [`http://127.0.0.1:${port_}`, `http://localhost:${port_}`];

  // DemoSwap + hijack + router (url record must be known before the name is created)
  const hp = { control: await free(), router: await free(), site: await free(), hijack: await free(), rpc: await free() };
  const label = `copeybara-e2e-${Date.now()}`;
  const wallet = addr(K[5]);
  // the built kit on http://localhost (listening now: the harness links to it)
  const kitPort = await free();
  const kitServer = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/copeybara-kit.html' || path === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(kitHtml);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => kitServer.listen(kitPort, '127.0.0.1', r));
  const harness = await startHarness({
    primaryRpc: fork.url, kitFile, ensName: `${label}.eth`, ensRpcs: rpcs, chainId: 11155111, universalResolver: UR,
    token: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', ports: hp, mode: 'process',
    kitUrl: `http://localhost:${kitPort}`, watcherUrl: 'http://127.0.0.1:1/', // the e2e watcher runs in-process (no status server)
  });
  const siteUrl = `http://demoswap.localhost:${hp.router}`;
  const items = await fetchCodeItems(`http://127.0.0.1:${hp.site}/`, nodeFetch);
  if (items.some((i) => i.hash === null)) throw new Error(`could not fingerprint DemoSwap: ${items.filter((i) => !i.hash).map((i) => i.label)}`);
  const siteRecord = formatSiteRecord(items.map((i) => i.hash!));

  const env = {
    ...process.env,
    DEPLOYER_KEY: K[0], OWNER_KEY_1: K[1], OWNER_KEY_2: K[2], OWNER_KEY_3: K[3],
    WEB_KEY_ADDR: addr(K[4]), WATCHER_ADDR: addr(K[9]),
    LABEL: label, SITE_URL: siteUrl, RELEASE: `sha256:${kitSha};v=5`, SITE: siteRecord,
    MANIFEST_FILE: '../config/manifest.json', DEPLOYMENTS_FILE: 'deployments/rehearsal-ext.json',
    TEST_WALLET_KEY: K[5], DEMO_WALLET: wallet, POSITIONS_FILE: 'deployments/rehearsal-ext-positions.json',
  };
  const forge = (args: string[]) => execFileSync(FORGE, [...args, '--rpc-url', fork.url, '--broadcast'], { cwd: CONTRACTS, env, stdio: 'pipe' });
  forge(['script', 'script/SetupName.s.sol', '--sig', 'commit()']);
  await fork.testClient.increaseTime({ seconds: 61 });
  await fork.testClient.mine({ blocks: 1 });
  forge(['script', 'script/SetupName.s.sol', '--sig', 'finish()']);
  forge(['script', 'script/SeedPositions.s.sol']);
  const positions = JSON.parse(readFileSync(join(CONTRACTS, env.POSITIONS_FILE), 'utf8'));

  // plain pages ("unknown dapp", hostile pages) on one more origin
  const pagesPort = await free();
  const approve = hijackRequest('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');
  const pagesServer = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!.replace(/^\//, '');
    const page = PAGES[path];
    if (!page) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(approve));
  });
  await new Promise<void>((r) => pagesServer.listen(pagesPort, '127.0.0.1', r));

  // watcher agent (in-process), ticked by the tests through the control server
  const q = createQuorum({ urls: rpcs, timeoutMs: 30_000, expectedChainId: 11155111 });
  const watcherAccount = privateKeyToAccount(K[9]);
  const wc = createWalletClient({ account: watcherAccount, transport: http(fork.url) });
  const pc = createPublicClient({ transport: http(fork.url) });
  const setText = parseAbi(['function setText(bytes name, string key, string value)']);
  const lookalike = `http://demoswap-rewards.localhost:${hp.hijack}/`;
  const watcher = createWatcher({
    names: [`${label}.eth`],
    candidates: { [`${label}.eth`]: [lookalike] },
    readRecords: (n) => readCopeybaraRecords(n, q, { universalResolver: UR }),
    fetchText: nodeFetch,
    writeText: async (name, resolver, key, value) => {
      const hash = await wc.writeContract({ chain: null, address: resolver, abi: setText, functionName: 'setText', args: [toHex(packetToBytes(name)), key, value] });
      const r = await pc.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error(`reverted ${hash}`);
      return hash;
    },
    now: () => Date.now(),
  });
  const ctlPort = await free();
  const ctl = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    try {
      if (path === '/watcher/tick') {
        await watcher.tick();
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(watcher.state()));
      }
      if (path.startsWith('/harness/')) {
        const r = await fetch(`http://127.0.0.1:${hp.control}/switch/${path.slice(9)}`, { method: 'POST' });
        return void res.writeHead(r.status).end(await r.text());
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise<void>((r) => ctl.listen(ctlPort, '127.0.0.1', r));

  writeFileSync(
    STATE,
    JSON.stringify({
      ensName: `${label}.eth`,
      rpcs,
      forkUrl: fork.url,
      wallet,
      positions: [positions.inRange, positions.outOfRange, positions.owedOnly].map(String),
      kitUrl: `http://localhost:${kitPort}/copeybara-kit.html`,
      kitSha,
      siteUrl,
      siteRecord,
      lookalike,
      pages: `http://127.0.0.1:${pagesPort}`,
      pagesAlt: `http://localhost:${pagesPort}`,
      control: `http://127.0.0.1:${ctlPort}`,
      drainer: approve,
      // the Demo Portal, served by the harness control server
      portal: `http://localhost:${hp.control}`,
    }),
  );

  return async () => {
    ctl.close();
    pagesServer.close();
    kitServer.close();
    await harness.stop();
    await fork.stop();
  };
}
