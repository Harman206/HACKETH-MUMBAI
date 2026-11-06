/**
 * Benchmark helpers (docs/benchmarks). Not product code: network access, throttling, small JSON cache.
 * Data sources: Routescan's free Etherscan-compatible API (log + txlist search over full history),
 * ethereum-rpc.publicnode.com / eth.drpc.org for tx lookups and latest-block eth_call.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATA = join(REPO, 'docs', 'benchmarks', 'data');
export const CACHE = join(REPO, 'node_modules', '.cache', 'copeybara-bench');
mkdirSync(CACHE, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

async function cached<T>(k: string, f: () => Promise<T>): Promise<T> {
  const p = join(CACHE, key(k) + '.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as T;
  const v = await f();
  writeFileSync(p, JSON.stringify(v));
  return v;
}

let lastScan = 0;
/** Routescan Etherscan-compatible API (free tier ≈ 2 req/s). Returns `result` or [] on "No records/logs found". */
export async function scan(params: Record<string, string | number>): Promise<any[]> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?${qs}`;
  return cached(url, async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = lastScan + 600 - Date.now();
      if (wait > 0) await sleep(wait);
      lastScan = Date.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (r.status === 429) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
        const j = (await r.json()) as { status: string; message: string; result: unknown };
        if (Array.isArray(j.result)) return j.result;
        if (/no (records|logs|transactions) found/i.test(j.message) || j.result === null) return [];
        if (/rate|limit/i.test(String(j.result) + j.message)) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
        throw new Error(`routescan: ${j.message} ${String(j.result).slice(0, 200)}`);
      } catch (e) {
        if (attempt === 5) throw e;
        await sleep(2000);
      }
    }
    throw new Error('routescan: gave up');
  });
}

const RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'];
let lastRpc = 0;
export async function rpc<T = any>(method: string, params: unknown[], cache = true): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const run = async () => {
    let err: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      const url = RPCS[attempt % RPCS.length]!;
      const wait = lastRpc + 120 - Date.now();
      if (wait > 0) await sleep(wait);
      lastRpc = Date.now();
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(30_000) });
        const j = (await r.json()) as { result?: T; error?: { message: string } };
        if (j.error) throw new Error(j.error.message);
        return j.result as T;
      } catch (e) {
        err = e;
        await sleep(500 * (attempt + 1));
      }
    }
    throw err;
  };
  return cache ? cached(body, run) : run();
}

export const writeJson = (name: string, v: unknown) => writeFileSync(join(DATA, name), JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 1) + '\n');
export const readJson = <T = any>(name: string): T => JSON.parse(readFileSync(join(DATA, name), 'utf8')) as T;

/** Deterministic shuffle (mulberry32) so the sample is reproducible. */
export function shuffle<T>(xs: T[], seed = 1): T[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const topicAddr = (a: string) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export const addrTopic = (t: string) => '0x' + t.slice(-40);
export const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
