/**
 * Fire Drill + Attack Theater launcher.
 *   pnpm --filter @copeybara/harness start
 * Then open the Demo Portal: http://localhost:8090 (scenarios + live status). Also: website ?booth=http://localhost:8090 ·
 *   DemoSwap http://demoswap.localhost:8080 · kit http://localhost:8000. Optional: scripts/watcher-live.sh (status on :8095).
 * Env (or contracts/.env): DEPLOYER_KEY, ATTACKER_KEY, ENS_NAME, THEATER_RPC (default public Sepolia), THEATER_NETWORK=sepolia|local-fork
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address, Hex } from 'viem';
import networks from '../config/networks.json';
import { createQuorum } from '@copeybara/quorum';
import { serve } from './services/http';
import { startHarness } from './services/control';
import { createDrainerBot } from './services/drainer-bot';
import { loadEnv, makePrepareVictim, makeReadVictim, makeSender } from './services/chain';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv();
const kitFile = env.KIT_FILE ?? join(REPO, 'apps', 'kit', 'dist', 'copeybara-kit.html');
const theaterRpc = env.THEATER_RPC ?? networks.defaultRpcs['11155111'][0]!;
const ensRpcs = (env.ENS_RPCS ?? (env.THEATER_NETWORK === 'local-fork' ? [theaterRpc, theaterRpc, theaterRpc] : networks.defaultRpcs['11155111']).join(',')).split(',');
const attackFile = join(REPO, 'contracts', 'deployments', env.ATTACK_FILE ?? 'sepolia-attack.json');
const attack = existsSync(attackFile) ? (JSON.parse(readFileSync(attackFile, 'utf8')) as { drainer: Address; DUSD: Address; DETH: Address }) : null;

let theater;
if (attack && env.DEPLOYER_KEY && env.ATTACKER_KEY) {
  const q = createQuorum({ urls: env.THEATER_NETWORK === 'local-fork' ? [theaterRpc, theaterRpc] : networks.defaultRpcs['11155111'], expectedChainId: 11155111 });
  const bot = createDrainerBot({ q, send: makeSender(theaterRpc, env.ATTACKER_KEY as Hex), drainer: attack.drainer, tokens: [attack.DUSD], fromBlock: (await q.pinBlock()) - 5n });
  bot.start();
  theater = {
    network: (env.THEATER_NETWORK === 'local-fork' ? 'local-fork' : 'sepolia') as 'sepolia' | 'local-fork',
    prepareVictim: makePrepareVictim({ rpcUrl: theaterRpc, deployerKey: env.DEPLOYER_KEY as Hex, dusd: attack.DUSD, deth: attack.DETH }),
    readVictim: makeReadVictim({ q, dusd: attack.DUSD }),
    drains: bot.records,
    tokens: { [attack.DUSD]: 'DUSD', [attack.DETH]: 'DETH' },
  };
} else {
  console.warn('Attack Theater disabled: needs contracts/deployments/sepolia-attack.json, DEPLOYER_KEY and ATTACKER_KEY.');
}

const h = await startHarness({
  primaryRpc: env.PRIMARY_RPC ?? theaterRpc,
  kitFile,
  ensName: env.ENS_NAME ?? 'demoswap-blackout.eth',
  ensRpcs,
  universalResolver: networks.ens.universalResolver as Address,
  token: (attack?.DUSD ?? env.HIJACK_TOKEN ?? '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8') as Address,
  drainer: attack?.drainer,
  chainId: 11155111,
  theater,
  kitUrl: `http://localhost:${env.KIT_PORT ?? 8000}`,
});
const kitPort = Number(env.KIT_PORT ?? 8000);
await serve(kitPort, (_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(kitFile)));
console.log(`
  Copeybara Demo Portal   http://localhost:${h.ports.control}${theater ? '   (Attack Theater on)' : ''}
    open it in the browser that has the Copeybara extension (scripts/demo-browser.sh)

  DemoSwap site           http://demoswap.localhost:${h.ports.router}
  look-alike              http://demoswap-rewards.localhost:${h.ports.hijack}/
  primary RPC proxy       http://localhost:${h.ports.rpc}
  exit kit                http://localhost:${kitPort}
  watcher (optional)      scripts/watcher-live.sh  → status on http://127.0.0.1:8095/
`);
