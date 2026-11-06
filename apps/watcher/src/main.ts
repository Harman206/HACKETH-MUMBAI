/**
 * Run the Copeybara watcher.
 *   WATCHER_KEY=0x… WATCH_NAMES=demoswap-blackout.eth pnpm --filter @copeybara/watcher start
 * Env:
 *   WATCHER_KEY        key holding ONLY the status + blocklist setter roles (contracts: grantWatcherRoles)
 *   WATCH_NAMES        comma-separated ENS names
 *   CANDIDATES         look-alike URLs per name: "name=url,url;name2=url"
 *   RPCS               comma-separated Sepolia RPCs for reads (default: config/networks.json); WRITE_RPC for sends
 *   INTERVAL_MS        default 15000
 *   STATUS_PORT        if set, GET /status returns the watcher state as JSON (used by the theater)
 *   ANTHROPIC_API_KEY  optional: Claude writes the plain-language incident note from structured facts
 */
import { createServer } from 'node:http';
import { createPublicClient, createWalletClient, http, parseAbi, toHex, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { packetToBytes } from 'viem/ens';
import type { Address } from '@copeybara/core';
import { readCopeybaraRecords } from '@copeybara/ens';
import { createQuorum } from '@copeybara/quorum';
import networks from '../../../config/networks.json';
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
const chain = { ...sepolia, rpcUrls: { default: { http: [writeRpc] } } };
const wallet = createWalletClient({ account, chain, transport: http(writeRpc) });
const pub = createPublicClient({ chain, transport: http(writeRpc) });
const setText = parseAbi(['function setText(bytes name, string key, string value)']);
const q = createQuorum({ urls: rpcs, expectedChainId: 11155111, timeoutMs: 8000 });

const watcher = createWatcher({
  names,
  candidates,
  readRecords: (name) => readCopeybaraRecords(name, q, { universalResolver: networks.ens.universalResolver as Address }),
  fetchText: (url) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) }),
  writeText: async (name, resolver, k, value) => {
    const hash = await wallet.writeContract({ address: resolver, abi: setText, functionName: 'setText', args: [toHex(packetToBytes(name)), k, value] });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== 'success') throw new Error(`setText(${k}) reverted in ${hash}`);
    return hash;
  },
  writeNote: env.ANTHROPIC_API_KEY ? claudeNote : undefined,
  now: () => Date.now(),
  log: (l) => console.log(new Date().toISOString(), l),
});

console.log(`watcher ${account.address} watching ${names.join(', ')} every ${Number(env.INTERVAL_MS ?? 15000) / 1000} s${env.ANTHROPIC_API_KEY ? ' (Claude notes on)' : ''}`);
if (env.STATUS_PORT) {
  createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ watcher: account.address, names: watcher.state() }));
  }).listen(Number(env.STATUS_PORT), '127.0.0.1');
}
const loop = async () => {
  try {
    await watcher.tick();
  } catch (e) {
    console.error('tick failed', e);
  }
  setTimeout(loop, Number(env.INTERVAL_MS ?? 15000));
};
void loop();
