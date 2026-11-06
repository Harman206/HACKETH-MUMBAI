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

  const html = readFileSync(kitFile);
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/blackout-kit.html') {
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
    }),
  );

  return async () => {
    await harness.stop();
    server.close();
    await fork.stop();
  };
}
