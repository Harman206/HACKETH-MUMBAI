/**
 * Fire Drill launcher: control page + router + site + hijack + primary RPC proxy + the kit on http://localhost.
 *   PRIMARY_RPC=… ENS_NAME=demoswap-blackout.eth pnpm --filter @blackout/harness start
 * Then open http://localhost:8090 (control), http://demoswap.localhost:8080 (site), http://localhost:8000 (kit).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import networks from '../config/networks.json';
import { serve } from './services/http';
import { startHarness } from './services/control';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitFile = process.env.KIT_FILE ?? join(REPO, 'apps', 'kit', 'dist', 'blackout-kit.html');
const ensRpcs = (process.env.ENS_RPCS ?? networks.defaultRpcs['11155111'].join(',')).split(',');

const h = await startHarness({
  primaryRpc: process.env.PRIMARY_RPC ?? networks.defaultRpcs['11155111'][0]!,
  kitFile,
  ensName: process.env.ENS_NAME ?? 'demoswap-blackout.eth',
  ensRpcs,
  universalResolver: networks.ens.universalResolver as `0x${string}`,
  token: (process.env.HIJACK_TOKEN ?? '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8') as `0x${string}`,
  chainId: 11155111,
});
const kitPort = Number(process.env.KIT_PORT ?? 8000);
await serve(kitPort, (_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(kitFile)));
console.log(`control  http://localhost:${h.ports.control}
site     http://demoswap.localhost:${h.ports.router}
rpc      http://localhost:${h.ports.rpc}   (primary RPC proxy)
kit      http://localhost:${kitPort}`);
