/**
 * Run the Copeybara watcher.
 *   WATCHER_KEY=0x… WATCH_NAMES=demoswap-blackout.eth pnpm --filter @copeybara/watcher start
 * Env:
 *   WATCHER_KEY        key holding ONLY the status + blocklist setter roles (contracts: grantWatcherRoles)
 *   WATCH_NAMES        comma-separated ENS names
 *   WATCHER_ADDRESS    optional: refuse to start unless WATCHER_KEY is this address (set by `copeybara watcher`)
 *   CANDIDATES         look-alike URLs per name: "name=url,url;name2=url"
 *   RPCS               comma-separated Sepolia RPCs for reads (default: config/networks.json); WRITE_RPC for sends
 *   INTERVAL_MS        default 15000
 *   STATUS_PORT        if set, GET /status returns the watcher state as JSON (used by the theater); GET /healthz is 200
 *                      while checks complete, 503 after 4 missed intervals. STATUS_HOST defaults to 127.0.0.1
 *   ANTHROPIC_API_KEY  optional: Claude writes the plain-language incident note from structured facts
 *   AGENT_NAME         this watcher's ENS identity (default watcher.<first WATCH_NAMES>; contracts/script/RegisterAgent.s.sol)
 */
import { createServer } from 'node:http';
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';
import type { Address } from '@copeybara/core';
import { readCopeybaraRecords } from '@copeybara/ens';
import { createQuorum } from '@copeybara/quorum';
import networks from '../../../config/networks.json';
import { ensReaders, identityLine, readAgentIdentity, type AgentIdentity } from './identity';
import { health } from './health';
import { claudeNote } from './note';
import { createWatcher } from './watcher';

const env = process.env;
const key = env.WATCHER_KEY as Hex | undefined;
if (!key) throw new Error('WATCHER_KEY is required (the key granted only the status + blocklist roles).');
const names = (env.WATCH_NAMES ?? 'demoswap-blackout.eth').split(',').map((s) => s.trim()).filter(Boolean);
const rpcs = (env.RPCS ?? networks.defaultRpcs['11155111'].join(',')).split(',');
const writeRpc = env.WRITE_RPC ?? rpcs[0]!;
const candidates = Object.fromEntries(
  (env.CANDIDATES ?? '')
    .split(';')
    .filter(Boolean)
    .map((p) => {
      const [n, urls] = p.split('=');
      return [n!.trim(), (urls ?? '').split(',').map((u) => u.trim()).filter(Boolean)];
    }),
);

const account = privateKeyToAccount(key);
if (env.WATCHER_ADDRESS && env.WATCHER_ADDRESS.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`WATCHER_KEY is for ${account.address}, but the config names the watcher ${env.WATCHER_ADDRESS}. Refusing to start.`);
}
const chain = { ...sepolia, rpcUrls: { default: { http: [writeRpc] } } };
const wallet = createWalletClient({ account, chain, transport: http(writeRpc) });
const pub = createPublicClient({ chain, transport: http(writeRpc) });
const setText = parseAbi([
  'function setText(bytes name, string key, string value)',
  'error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)',
]);
const rolesAbi = parseAbi(['function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)']);
const ROLE_SET_TEXT = 1n << 4n;
const WRITABLE = ['org.copeybara.status', 'org.copeybara.blocklist'];
const q = createQuorum({ urls: rpcs, expectedChainId: 11155111, timeoutMs: 8000 });

const watcher = createWatcher({
  names,
  candidates,
  readRecords: (name) => readCopeybaraRecords(name, q, { universalResolver: networks.ens.universalResolver as Address }),
  fetchText: (url) => {
    // RFC 6761: *.localhost is loopback. Browsers resolve it; Node's resolver may not (booth demo URLs).
    const u = new URL(url);
    if (u.hostname.endsWith('.localhost')) u.hostname = '127.0.0.1';
    return fetch(u.href, { signal: AbortSignal.timeout(8000) }); // follow redirects like a browser (CDNs redirect)
  },
  writeText: async (name, resolver, k, value) => {
    const hash = await wallet.writeContract({ address: resolver, abi: setText, functionName: 'setText', args: [toHex(packetToBytes(name)), k, value] });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`setText(${k}) reverted in ${hash}`);
    return hash;
  },
  writeNote: env.ANTHROPIC_API_KEY ? claudeNote : undefined,
  canWrite: async (_name, resolver) => {
    const held = await Promise.all(
      WRITABLE.map((k) =>
        pub.readContract({ address: resolver, abi: rolesAbi, functionName: 'hasRoles', args: [BigInt(keccak256(toHex(k))), ROLE_SET_TEXT, account.address] }),
      ),
    );
    return held.every(Boolean);
  },
  now: () => Date.now(),
  log: (l) => console.log(new Date().toISOString(), l),
});

const agentName = env.AGENT_NAME ?? `watcher.${names[0]}`;
let identity: AgentIdentity | null = null;
const ens = ensReaders(q, networks.ens.universalResolver as Address);
void readAgentIdentity(agentName, ens.readText, ens.readAddr, account.address).then((id) => {
  identity = id;
  console.log(new Date().toISOString(), identityLine(id));
});

console.log(`watcher ${account.address} watching ${names.join(', ')} every ${Number(env.INTERVAL_MS ?? 15000) / 1000} s${env.ANTHROPIC_API_KEY ? ' (Claude notes on)' : ''}`);
const intervalMs = Number(env.INTERVAL_MS ?? 15000);
let lastOkAt: number | null = null;
if (env.STATUS_PORT) {
  createServer((req, res) => {
    if (req.url === '/healthz') {
      const h = health(lastOkAt, Date.now(), intervalMs);
      return void res.writeHead(h.ok ? 200 : 503, { 'content-type': 'text/plain' }).end(h.detail);
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ watcher: account.address, identity, revoked: watcher.revoked(), names: watcher.state() }));
  }).listen(Number(env.STATUS_PORT), env.STATUS_HOST ?? '127.0.0.1');
}
const loop = async () => {
  try {
    await watcher.tick();
    lastOkAt = Date.now();
  } catch (e) {
    console.error('tick failed', e);
  }
  setTimeout(loop, intervalMs);
};
void loop();
