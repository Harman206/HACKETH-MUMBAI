import { describe, expect, test } from 'vitest';
import type { CopeybaraRecords } from '@copeybara/ens';
import { scriptHash } from '@copeybara/sitecheck';
import { createWatcher, deterministicNote, type WatcherDeps } from '../src/watcher';

const NAME = 'demoswap-blackout.eth';
const SITE = 'http://demoswap.localhost:8080/';
const APP = 'console.log("app")';
const OK_HTML = '<html><script src="/app.js"></script></html>';
const HIJACK_HTML = '<html><script src="/app.js"></script><script>window.__HIJACK_REQUEST__={}</script><script src="/inject.js"></script></html>';

function world() {
  let html = OK_HTML;
  let siteUp = true;
  let lookalikeUp = false;
  const chain: Record<string, string> = {};
  const writes: { key: string; value: string }[] = [];
  let failWrites = 0;
  const deps: WatcherDeps = {
    names: [NAME],
    candidates: { [NAME]: ['http://demoswap-rewards.localhost:8082/', 'http://demoswap-app.localhost:8083/'] },
    readRecords: async (name) =>
      ({
        name,
        url: SITE,
        site: [await scriptHash(APP)],
        status: chain['org.copeybara.status'] ? (await import('@copeybara/core')).parseStatus(chain['org.copeybara.status']) : { state: 'ok' },
        blocklist: chain['org.copeybara.blocklist'] ? (await import('@copeybara/core')).parseBlocklist(chain['org.copeybara.blocklist']) : [],
        resolver: '0x2222222222222222222222222222222222222222',
      }) as unknown as CopeybaraRecords,
    fetchText: async (url) => {
      if (url.startsWith('http://demoswap-rewards')) return lookalikeUp ? { ok: true, status: 200, text: async () => HIJACK_HTML } : Promise.reject(new Error('ECONNREFUSED'));
      if (url.startsWith('http://demoswap-app')) return Promise.reject(new Error('ENOTFOUND'));
      if (!siteUp) return { ok: false, status: 502, text: async () => '' };
      if (url === SITE) return { ok: true, status: 200, text: async () => html };
      if (url.endsWith('/app.js')) return { ok: true, status: 200, text: async () => APP };
      if (url.endsWith('/inject.js')) return { ok: true, status: 200, text: async () => 'drain()' };
      return { ok: false, status: 404, text: async () => '' };
    },
    writeText: async (_name, _resolver, key, value) => {
      if (failWrites > 0) {
        failWrites--;
        throw new Error('nonce too low');
      }
      chain[key] = value;
      writes.push({ key, value });
      return `0x${String(writes.length).padStart(64, '0')}`;
    },
    now: () => 1_793_965_507_000,
  };
  return {
    deps,
    writes,
    chain,
    hijack: () => (html = HIJACK_HTML),
    restore: () => (html = OK_HTML),
    down: () => (siteUp = false),
    up: () => (siteUp = true),
    lookalike: () => (lookalikeUp = true),
    failNextWrite: () => (failWrites = 1),
  };
}

describe('watcher: site fingerprint → org.copeybara.status', () => {
  test('a clean site writes nothing', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    for (let i = 0; i < 3; i++) await watcher.tick();
    expect(w.writes).toEqual([]);
    expect(watcher.state()[NAME]).toMatchObject({ verdict: 'match', status: 'ok' });
  });
  test('two mismatches in a row → compromised, written once, with a note naming the unknown code', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    w.hijack();
    await watcher.tick();
    expect(w.writes).toEqual([]); // one bad read is not enough
    await watcher.tick();
    await watcher.tick();
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]!.key).toBe('org.copeybara.status');
    expect(w.writes[0]!.value).toMatch(/^v=1;state=compromised;at=1793965507;note=/);
    expect(decodeURIComponent(w.writes[0]!.value.split('note=')[1]!)).toMatch(/2 scripts/);
    expect(watcher.state()[NAME]!.events.at(-1)).toMatchObject({ kind: 'raised', tx: expect.stringMatching(/^0x/) });
  });
  test('the watcher clears only what it raised, after 5 clean checks in a row', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    w.hijack();
    await watcher.tick();
    await watcher.tick();
    w.restore();
    for (let i = 0; i < 4; i++) await watcher.tick();
    expect(w.writes).toHaveLength(1);
    await watcher.tick();
    expect(w.writes).toHaveLength(2);
    expect(w.writes[1]!.value).toMatch(/^v=1;state=ok;at=/);
  });
  test('a compromise raised by the Safe is never cleared by the watcher', async () => {
    const w = world();
    w.chain['org.copeybara.status'] = 'v=1;state=compromised;at=1;note=keys%20leaked';
    const watcher = createWatcher(w.deps);
    for (let i = 0; i < 8; i++) await watcher.tick();
    expect(w.writes).toEqual([]);
  });
  test('site down 3 times → degraded ("use the exit kit"); back up → ok', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    w.down();
    for (let i = 0; i < 3; i++) await watcher.tick();
    expect(w.writes.map((x) => x.value.split(';')[1])).toEqual(['state=degraded']);
    w.up();
    for (let i = 0; i < 5; i++) await watcher.tick();
    expect(w.writes.map((x) => x.value.split(';')[1])).toEqual(['state=degraded', 'state=ok']);
  });
  test('a failed write is retried on the next tick, not lost', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    w.hijack();
    w.failNextWrite();
    await watcher.tick();
    await watcher.tick();
    expect(w.writes).toHaveLength(0);
    expect(watcher.state()[NAME]!.events.at(-1)).toMatchObject({ kind: 'write-failed' });
    await watcher.tick();
    expect(w.writes).toHaveLength(1);
  });
});

describe('watcher: look-alike domains → org.copeybara.blocklist', () => {
  test('a candidate that serves pages is added (host only); dead candidates are not', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    await watcher.tick();
    expect(w.writes).toEqual([]);
    w.lookalike();
    await watcher.tick();
    expect(w.writes).toEqual([{ key: 'org.copeybara.blocklist', value: '{"v":1,"domains":["demoswap-rewards.localhost"]}' }]);
    await watcher.tick();
    expect(w.writes).toHaveLength(1); // already listed: no repeat write
  });
});

describe('incident note', () => {
  test('deterministic note: plain words, ≤200 chars, no page content', () => {
    const n = deterministicNote({ protocol: NAME, kind: 'mismatch', unknown: ['inline script #1', 'http://demoswap.localhost:8080/inject.js'], url: SITE });
    expect(n.length).toBeLessThanOrEqual(200);
    expect(n).toMatch(/2 scripts/);
    expect(n).toMatch(/exit kit/);
  });
  test('an LLM note is used when provided, capped at 200 chars; if it fails, the deterministic note is used', async () => {
    const w = world();
    const long = 'x'.repeat(500);
    const watcher = createWatcher({ ...w.deps, writeNote: async () => long });
    w.hijack();
    await watcher.tick();
    await watcher.tick();
    expect(decodeURIComponent(w.writes[0]!.value.split('note=')[1]!)).toHaveLength(200);

    const w2 = world();
    const watcher2 = createWatcher({ ...w2.deps, writeNote: async () => Promise.reject(new Error('no key')) });
    w2.hijack();
    await watcher2.tick();
    await watcher2.tick();
    expect(decodeURIComponent(w2.writes[0]!.value.split('note=')[1]!)).toMatch(/2 scripts/);
  });
});
