/**
 * E2E world: anvil fork of Sepolia + a fresh ENSv2 name (Safe-owned, real manifest, release = this kit's sha256)
 * + three seeded Uniswap v3 positions + the kit served on http://localhost.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
import { FORK_RPCS, startFork, type Fork } from '@blackout/testkit';
import { createServer as netServer } from 'node:net';
import { startHarness } from '../../../harness/services/control';
import { createDrainerBot } from '../../../harness/services/drainer-bot';
import { makePrepareVictim, makeReadVictim, makeSender } from '../../../harness/services/chain';
import { createQuorum } from '@blackout/quorum';

const free = () => new Promise<number>((r) => { const s = netServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });

const KIT = join(HERE, '..');
const CONTRACTS = join(KIT, '..', '..', 'contracts');
export const STATE = join(HERE, '.state.json');
const FORGE = `${homedir()}/.foundry/bin/forge`;
const CAST = `${homedir()}/.foundry/bin/cast`;

// anvil default keys (public test keys, fork only)
const K = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356', // 7: theater attacker
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97', // 8: theater victim
];

export default async function globalSetup() {
  execFileSync('pnpm', ['build'], { cwd: KIT, env: { ...process.env, SOURCE_DATE_EPOCH: '0' }, stdio: 'pipe' });
  const kitFile = join(KIT, 'dist', 'blackout-kit.html');
  const sha = createHash('sha256').update(readFileSync(kitFile)).digest('hex');

  // Public fork sources flake mid-setup ("header for hash not found"): rebuild the whole world on the next source.
  let lastErr: unknown;
  for (const src of FORK_RPCS[11155111]) {
    let fork: Fork | null = null;
    try {
      fork = await startFork({ chainId: 11155111, forkUrl: src });
      return await buildWorld(fork, kitFile, sha);
    } catch (e) {
      lastErr = e;
      await fork?.stop().catch(() => {});
    }
  }
  throw lastErr;
}

async function buildWorld(fork: Fork, kitFile: string, sha: string) {
  const label = `blackout-e2e-${Date.now()}`;
  const env = {
    ...process.env,
    DEPLOYER_KEY: K[0], OWNER_KEY_1: K[1], OWNER_KEY_2: K[2], OWNER_KEY_3: K[3],
    WEB_KEY_ADDR: execFileSync(CAST, ['wallet', 'address', '--private-key', K[4]!], { encoding: 'utf8' }).trim(),
    LABEL: label, SITE_URL: 'http://demoswap.localhost', RELEASE: `sha256:${sha};v=2`,
    MANIFEST_FILE: '../config/manifest.json', DEPLOYMENTS_FILE: 'deployments/rehearsal-e2e.json',
    TEST_WALLET_KEY: K[5], POSITIONS_FILE: 'deployments/rehearsal-e2e-positions.json',
  };
  const forge = (args: string[]) => execFileSync(FORGE, [...args, '--rpc-url', fork.url, '--broadcast'], { cwd: CONTRACTS, env, stdio: 'pipe' });
  forge(['script', 'script/SetupName.s.sol', '--sig', 'commit()']);
  await fork.testClient.increaseTime({ seconds: 61 });
  await fork.testClient.mine({ blocks: 1 });
  forge(['script', 'script/SetupName.s.sol', '--sig', 'finish()']);
  // contracts/.env may set DEMO_WALLET (a real MetaMask address); forge auto-loads it, so pin it to the seeding key.
  env.DEMO_WALLET = execFileSync(CAST, ['wallet', 'address', '--private-key', K[5]!], { encoding: 'utf8' }).trim();
  forge(['script', 'script/SeedPositions.s.sol']);
  const positions = JSON.parse(readFileSync(join(CONTRACTS, env.POSITIONS_FILE), 'utf8'));
  // A second wallet for the fire drill, so specs do not consume each other's positions.
  env.TEST_WALLET_KEY = K[6];
  env.DEMO_WALLET = execFileSync(CAST, ['wallet', 'address', '--private-key', K[6]!], { encoding: 'utf8' }).trim();
  env.POSITIONS_FILE = 'deployments/rehearsal-e2e-drill-positions.json';
  forge(['script', 'script/SeedPositions.s.sol']);
  const drillPositions = JSON.parse(readFileSync(join(CONTRACTS, env.POSITIONS_FILE), 'utf8'));

  // Attack Theater world: the drainer, the bot (attacker = key 7), victim = key 8, token holder = key 5 (seeded pool #1).
  env.ATTACKER_KEY = K[7];
  env.DEPLOYER_KEY = K[0];
  env.POSITIONS_FILE = 'deployments/rehearsal-e2e-positions.json';
  env.ATTACK_FILE = 'deployments/rehearsal-e2e-attack.json';
  forge(['script', 'script/DeployAttack.s.sol']);
  const attack = JSON.parse(readFileSync(join(CONTRACTS, env.ATTACK_FILE), 'utf8'));
  execFileSync('pnpm', ['--filter', '@blackout/site', 'build'], { cwd: join(KIT, '..', '..'), stdio: 'pipe' });

  const html = readFileSync(kitFile);
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/' || path === '/blackout-kit.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const port_ = new URL(fork.url).port;
  const rpcs = [`http://127.0.0.1:${port_}`, `http://localhost:${port_}`];
  const hp = { control: await free(), router: await free(), site: await free(), hijack: await free(), rpc: await free() };
  const harness = await startHarness({
    primaryRpc: fork.url, kitFile, ensName: `${label}.eth`, ensRpcs: rpcs, chainId: 11155111,
    universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe', token: positions.token0, ports: hp, mode: 'process',
  });
  const tq = createQuorum({ urls: rpcs, timeoutMs: 30_000, expectedChainId: 11155111 });
  const bot = createDrainerBot({ q: tq, send: makeSender(fork.url, K[7] as `0x${string}`), drainer: attack.drainer, tokens: [attack.DUSD], fromBlock: await tq.pinBlock(), pollMs: 1000 });
  bot.start();
  const tp = { control: await free(), router: await free(), site: await free(), hijack: await free(), rpc: await free() };
  const theaterHarness = await startHarness({
    primaryRpc: fork.url, kitFile, ensName: `${label}.eth`, ensRpcs: rpcs, chainId: 11155111,
    universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe', token: attack.DUSD, drainer: attack.drainer, ports: tp, mode: 'process',
    kitUrl: `http://localhost:${port}`,
    theater: {
      network: 'local-fork',
      prepareVictim: makePrepareVictim({ rpcUrl: fork.url, deployerKey: K[5] as `0x${string}`, dusd: attack.DUSD, deth: attack.DETH }),
      readVictim: makeReadVictim({ q: tq, dusd: attack.DUSD }),
      drains: bot.records,
      tokens: { [attack.DUSD]: 'DUSD', [attack.DETH]: 'DETH' },
    },
  });
  const siteDist = join(KIT, '..', 'site', 'dist');
  const siteServer = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const f = join(siteDist, path === '/' ? 'index.html' : path);
    let body: Buffer;
    try {
      body = readFileSync(f);
    } catch {
      return void res.writeHead(404).end();
    }
    const type = f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/plain';
    res.writeHead(200, { 'content-type': type }).end(body);
  });
  await new Promise<void>((r) => siteServer.listen(0, '127.0.0.1', r));
  const sitePort = (siteServer.address() as { port: number }).port;

  writeFileSync(
    STATE,
    JSON.stringify({
      kitUrl: `http://localhost:${port}/`,
      kitSha256: sha,
      rpcs,
      ensName: `${label}.eth`,
      wallet: positions.wallet,
      positions: { inRange: String(positions.inRange), outOfRange: String(positions.outOfRange), owedOnly: String(positions.owedOnly) },
      drill: {
        wallet: drillPositions.wallet,
        positions: [drillPositions.inRange, drillPositions.outOfRange, drillPositions.owedOnly].map(String),
        control: `http://localhost:${hp.control}`,
        router: `http://127.0.0.1:${hp.router}`,
        site: `http://127.0.0.1:${hp.site}`,
        rpcProxy: `http://localhost:${hp.rpc}`,
      },
      theater: {
        site: `http://localhost:${sitePort}/?booth=${encodeURIComponent(`http://localhost:${tp.control}`)}`,
        control: `http://localhost:${tp.control}`,
        victim: execFileSync(CAST, ['wallet', 'address', '--private-key', K[8]!], { encoding: 'utf8' }).trim(),
        rpcProxy: `http://localhost:${tp.rpc}`,
      },
    }),
  );

  return async () => {
    bot.stop();
    siteServer.close();
    await theaterHarness.stop();
    await harness.stop();
    server.close();
    await fork.stop();
  };
}
