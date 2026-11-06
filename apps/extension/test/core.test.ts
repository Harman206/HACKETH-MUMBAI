import { beforeEach, describe, expect, test } from 'vitest';
import { encodeFunctionData, parseAbi } from 'viem';
import type { CopeybaraRecords } from '@copeybara/ens';
import { scriptHash } from '@copeybara/sitecheck';
import { createCore, type ChromeLike } from '../src/background/core';

const EXT = 'chrome-extension://abc/';
const USER = '0x1111111111111111111111111111111111111111';
const NPM = '0x1238536071E1c677A632429e3655c799b22cDA52';
const TOKEN = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
const DRAINER = '0xbadbadbadbadbadbadbadbadbadbadbadbadbad0';
const NAME = 'demoswap-blackout.eth';
const SITE = 'http://demoswap.localhost:8080';
const APP = 'console.log("demoswap app")';

function fakeChrome() {
  const store: Record<string, unknown> = {};
  const calls = { tabsUpdate: [] as { tabId: number; url: string }[], tabsCreate: [] as string[], windows: [] as string[], removed: [] as number[], rules: [] as unknown[], badge: new Map<number, string>() };
  const chrome: ChromeLike = {
    runtime: { id: 'abc', getURL: (p) => EXT + p.replace(/^\//, '') },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (o) => void Object.assign(store, structuredClone(o)),
      },
    },
    tabs: {
      update: async (tabId, p) => void calls.tabsUpdate.push({ tabId, url: p.url }),
      create: async (p) => void calls.tabsCreate.push(p.url),
      sendMessage: async () => undefined,
    },
    windows: { create: async (o) => (calls.windows.push(o.url), { id: calls.windows.length }), remove: async (id) => void calls.removed.push(id) },
    action: {
      setBadgeText: async (o) => void calls.badge.set(o.tabId ?? -1, o.text),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    declarativeNetRequest: {
      getDynamicRules: async () => (calls.rules.at(-1) as { id: number }[] | undefined) ?? [],
      updateDynamicRules: async (o) => void calls.rules.push(o.addRules),
    },
  };
  return { chrome, store, calls };
}

let records: Partial<CopeybaraRecords>;
let readFails = false;
let reads = 0;
let now = 1_000_000;
const kitBytes = new TextEncoder().encode('<html>kit</html>');

async function setup(over: Partial<CopeybaraRecords> = {}) {
  const appHash = await scriptHash(APP);
  const kitSha = await (async () => {
    const d = await crypto.subtle.digest('SHA-256', kitBytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  })();
  records = {
    name: NAME,
    url: SITE,
    release: { sha256: kitSha, version: 5 },
    manifest: { v: 1, chains: { '11155111': { 'uniswap-v3': { positionManager: { address: NPM, selectors: ['0xac9650d8', '0x0c49ccbe', '0xfc6f7865'] } } } } },
    site: [appHash],
    extension: null,
    status: { state: 'ok' },
    blocklist: [],
    problems: [],
    block: 7n,
    resolver: '0x2222222222222222222222222222222222222222',
    ...over,
  };
  const f = fakeChrome();
  const core = createCore({
    chrome: f.chrome,
    readRecords: async (name) => {
      reads++;
      if (readFails) throw new Error('RPCs disagree');
      return { ...(records as CopeybaraRecords), name };
    },
    fetchBytes: async () => kitBytes,
    rpcChainId: async () => 11155111,
    now: () => now,
    defaultRpcs: ['https://a', 'https://b', 'https://c'],
    defaultKitUrl: 'https://kit.example/copeybara-kit.html',
    version: 'test',
    confirmTimeoutMs: 50,
    celebrateMs: 30,
  });
  const page = { id: 'abc', url: `${EXT}src/pages/dashboard.html` };
  await core.handleMessage({ t: 'settings', patch: { account: USER } }, page);
  await core.handleMessage({ t: 'follow', name: NAME }, page);
  return { core, ...f, page, appHash };
}

const tab = (tabId = 7, url = `${SITE}/`, frameId = 0) => ({ id: 'abc', url, origin: new URL(url).origin, tab: { id: tabId, url }, frameId });
const item = async (label: string, text: string) => ({ kind: 'src' as const, label, hash: await scriptHash(text) });

beforeEach(() => {
  readFails = false;
  reads = 0;
  now = 1_000_000;
});

describe('senders: a web page cannot speak for the extension', () => {
  test('a message from another extension or with no sender id is ignored', async () => {
    const { core } = await setup();
    expect(await core.handleMessage({ t: 'getState' }, { id: 'other', url: 'https://evil.example' })).toEqual({ error: 'unknown sender' });
    expect(await core.handleMessage({ t: 'follow', name: 'x.eth' }, {})).toEqual({ error: 'unknown sender' });
  });
  test('a content script cannot use page-only commands (follow, settings, confirmDecision): counted as page noise', async () => {
    const { core } = await setup();
    for (const m of [{ t: 'settings', patch: { account: DRAINER } }, { t: 'confirmDecision', id: 'x', allow: true }, { t: 'follow', name: 'evil.eth' }, { t: 'verdict', site: 'match' }]) {
      expect(await core.handleMessage(m, tab())).toEqual({ error: 'bad message' });
    }
    expect(core.publicState().stats.pageNoise).toBe(4);
    expect(core.publicState().settings.account).toBe(USER);
    expect(core.publicState().protocols.map((p) => p.name)).toEqual([NAME]);
  });
  test('malformed script items are rejected whole (no partial trust)', async () => {
    const { core } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    const r = await core.handleMessage({ t: 'scripts', items: [{ kind: 'src', label: 'x', hash: 'match' }], done: true }, tab());
    expect(r).toEqual({ error: 'bad message' });
    expect(core.publicState().stats.verified).toBe(0);
  });
});

describe('site fingerprint (scenario 2: DNS hijack)', () => {
  test('every script published → match, counted once', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'scripts', items: [await item(`${SITE}/app.js`, APP)], done: true }, tab());
    await core.handleMessage({ t: 'scripts', items: [], done: true }, tab());
    expect(core._tab(7)!.site).toMatchObject({ kind: 'protocol', verdict: 'match' });
    expect(calls.badge.get(7)).toBe('✓');
    const s = core.publicState().stats;
    expect([s.sitesChecked, s.verified]).toEqual([1, 1]);
  });
  test('an injected script → tab replaced by the warning page naming it; requests from that tab are blocked', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'scripts', items: [await item(`${SITE}/app.js`, APP), await item(`${SITE}/inject.js`, 'drain()')], done: false }, tab());
    expect(calls.tabsUpdate).toHaveLength(1);
    const u = new URL(calls.tabsUpdate[0]!.url);
    expect(u.pathname).toBe('/src/pages/warning.html');
    expect(u.searchParams.get('reason')).toBe('mismatch');
    expect(u.searchParams.get('unknown')).toBe(`${SITE}/inject.js`);
    const approve = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [DRAINER, 2n ** 256n - 1n] });
    const d = (await core.handleMessage({ t: 'request', id: '1', method: 'eth_sendTransaction', params: [{ from: USER, to: TOKEN, data: approve }], chainId: 11155111 }, tab())) as { decision: string };
    expect(d.decision).toBe('block');
    const s = core.publicState().stats;
    expect([s.mismatched, s.pagesBlocked.mismatch, s.requestsBlocked, s.verified]).toEqual([1, 1, 1, 0]);
  });
  test('a frame from another origin cannot change the protocol tab verdict', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    const r = await core.handleMessage({ t: 'scripts', items: [await item('https://ads.example/x.js', 'evil')], done: true }, tab(7, 'https://ads.example/frame', 3));
    expect(r).toEqual({ ignored: true });
    expect(calls.tabsUpdate).toHaveLength(0);
  });
  test('a script that could not be read → unverifiable (amber), never match', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'scripts', items: [await item(`${SITE}/app.js`, APP), { kind: 'src', label: 'https://cdn.example/x.js', hash: null }], done: true }, tab());
    expect(core._tab(7)!.site).toMatchObject({ verdict: 'unverifiable' });
    expect(calls.badge.get(7)).toBe('?');
  });
  test('no site record published → unset (grey), not mismatch', async () => {
    const { core, calls } = await setup({ site: null });
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'scripts', items: [await item(`${SITE}/app.js`, 'anything')], done: true }, tab());
    expect(core._tab(7)!.site).toMatchObject({ verdict: 'unset' });
    expect(calls.tabsUpdate).toHaveLength(0);
    expect(core.publicState().stats.unset).toBe(1);
  });
  test('ENS unreachable and the snapshot is old → stale (amber), never green', async () => {
    const { core } = await setup();
    now += 11 * 60_000;
    readFails = true;
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'scripts', items: [await item(`${SITE}/app.js`, APP)], done: true }, tab());
    expect(core._tab(7)!.site).toMatchObject({ verdict: 'stale' });
  });
  test('a malformed site record → stale, never match', async () => {
    const { core } = await setup({ site: null, problems: [{ key: 'org.copeybara.site', message: 'bad' }] });
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'scripts', items: [await item(`${SITE}/app.js`, APP)], done: true }, tab());
    expect(core._tab(7)!.site).toMatchObject({ verdict: 'stale' });
  });
  test('the service worker restarted mid-page → asks the content script to resend', async () => {
    const { core } = await setup();
    expect(await core.handleMessage({ t: 'scripts', items: [], done: true }, tab(99))).toEqual({ resend: true });
  });
  test('a look-alike origin is not the protocol (evil-demoswap.localhost)', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab(8, 'http://evil-demoswap.localhost:8080/'));
    expect(core._tab(8)!.site).toEqual({ kind: 'none' });
    expect(calls.tabsUpdate).toHaveLength(0);
  });
});

describe('ENS status + blocklist (authoritative blocks)', () => {
  test('status compromised → a DNR redirect rule for the site, and an open tab is moved off it', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    records.status = { state: 'compromised', at: 5, note: 'Site serves unknown scripts' };
    await core.sync();
    const rules = calls.rules.at(-1) as { condition: { requestDomains: string[] }; action: { type: string } }[];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.condition.requestDomains).toEqual(['demoswap.localhost']);
    expect(rules[0]!.action).toEqual({ type: 'block' });
    expect(calls.tabsUpdate.at(-1)!.url).toMatch(/reason=compromised/);
    expect(core.publicState().stats.pagesBlocked.compromised).toBe(1);
  });
  test('blocklisted look-alike → rule + block on navigation (subdomains too)', async () => {
    const { core, calls } = await setup({ blocklist: ['rewards-demoswap.localhost'] });
    expect((calls.rules.at(-1) as unknown[]).length).toBe(1);
    await core.handleMessage({ t: 'hello' }, tab(9, 'http://app.rewards-demoswap.localhost:8082/'));
    expect(calls.tabsUpdate.at(-1)!.url).toMatch(/reason=blocklist/);
    expect(core.publicState().stats.pagesBlocked.blocklist).toBe(1);
  });
  test('a navigation to a flagged site (request cancelled by the rule) moves the tab to the warning page, counted once', async () => {
    const { core, calls } = await setup({ status: { state: 'compromised', note: 'hijacked' } });
    await core.onNavigate(30, `${SITE}/pools`);
    await core.onNavigate(30, `${SITE}/pools`);
    expect(calls.tabsUpdate).toHaveLength(1);
    expect(calls.tabsUpdate[0]!.url).toMatch(/reason=compromised.*note=hijacked/);
    expect(core.publicState().stats.pagesBlocked.compromised).toBe(1);
    await core.onNavigate(31, 'https://fine.example/');
    expect(calls.tabsUpdate).toHaveLength(1);
  });
  test('unfollowing removes the rules', async () => {
    const { core, calls, page } = await setup({ blocklist: ['x.example'] });
    await core.handleMessage({ t: 'unfollow', name: NAME }, page);
    expect(calls.rules.at(-1)).toEqual([]);
  });
});

describe('wallet requests', () => {
  const approve = (spender: string) =>
    encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [spender as `0x${string}`, 2n ** 256n - 1n] });
  test('dangerous → confirm window; no answer → blocked', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab(10, 'https://somewhere.example/'));
    const d = (await core.handleMessage({ t: 'request', id: '1', method: 'eth_sendTransaction', params: [{ from: USER, to: TOKEN, data: approve(DRAINER) }], chainId: 11155111 }, tab(10, 'https://somewhere.example/'))) as { decision: string; verdict: string };
    expect(calls.windows[0]).toMatch(/confirm\.html\?id=/);
    expect(d).toMatchObject({ decision: 'block', verdict: 'dangerous' });
  });
  test('the user can allow from the trusted confirm window (and it is counted)', async () => {
    const { core, calls, page } = await setup();
    const p = core.handleMessage({ t: 'request', id: '1', method: 'eth_sendTransaction', params: [{ from: USER, to: TOKEN, data: approve(DRAINER) }], chainId: 11155111 }, tab(11, 'https://somewhere.example/'));
    await new Promise((r) => setTimeout(r, 5));
    const id = new URL(calls.windows[0]!).searchParams.get('id')!;
    expect(await core.handleMessage({ t: 'getConfirm', id }, page)).toMatchObject({ classification: { verdict: 'dangerous' } });
    await core.handleMessage({ t: 'confirmDecision', id, allow: true }, page);
    expect(await p).toMatchObject({ decision: 'allow' });
    expect(core.publicState().stats.requestsAllowedAfterWarning).toBe(1);
  });
  test('Cancel: the page is answered at once; the worker closes the confirm window itself after the "Saved by Copey" moment', async () => {
    const { core, calls, page } = await setup();
    const p = core.handleMessage({ t: 'request', id: '1', method: 'eth_sign', params: [USER, '0x' + 'aa'.repeat(32)], chainId: null }, tab(15, 'https://x.example/'));
    await new Promise((r) => setTimeout(r, 5));
    const id = new URL(calls.windows[0]!).searchParams.get('id')!;
    await core.handleMessage({ t: 'confirmDecision', id, allow: false }, page);
    expect(await p).toMatchObject({ decision: 'block' });
    expect(calls.removed).toEqual([]); // the celebration is showing
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.removed).toEqual([1]); // closed by the worker even if the page never says so
  });
  test('Done on the celebration (closeConfirm) closes the window at once, only once', async () => {
    const { core, calls, page } = await setup();
    const p = core.handleMessage({ t: 'request', id: '1', method: 'eth_sign', params: [USER, '0x' + 'aa'.repeat(32)], chainId: null }, tab(18, 'https://x.example/'));
    await new Promise((r) => setTimeout(r, 5));
    const id = new URL(calls.windows[0]!).searchParams.get('id')!;
    await core.handleMessage({ t: 'confirmDecision', id, allow: false }, page);
    await p;
    expect(await core.handleMessage({ t: 'closeConfirm', id }, page)).toEqual({ ok: true });
    expect(calls.removed).toEqual([1]);
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.removed).toEqual([1]);
    expect(await core.handleMessage({ t: 'closeConfirm', id }, tab(18, 'https://x.example/'))).toEqual({ error: 'bad message' }); // pages only
  });
  test('Continue: the window is closed at once', async () => {
    const { core, calls, page } = await setup();
    const p = core.handleMessage({ t: 'request', id: '1', method: 'eth_sign', params: [USER, '0x' + 'aa'.repeat(32)], chainId: null }, tab(16, 'https://x.example/'));
    await new Promise((r) => setTimeout(r, 5));
    await core.handleMessage({ t: 'confirmDecision', id: new URL(calls.windows[0]!).searchParams.get('id')!, allow: true }, page);
    expect(await p).toMatchObject({ decision: 'allow' });
    expect(calls.removed).toEqual([1]);
  });
  test('no answer before the timeout: blocked and the window is closed', async () => {
    const { core, calls } = await setup();
    expect(await core.handleMessage({ t: 'request', id: '1', method: 'eth_sign', params: [USER, '0x' + 'aa'.repeat(32)], chainId: null }, tab(17, 'https://x.example/'))).toMatchObject({ decision: 'block' });
    expect(calls.removed).toEqual([1]);
  });
  test('closing the confirm window blocks', async () => {
    const { core } = await setup();
    const p = core.handleMessage({ t: 'request', id: '1', method: 'eth_sign', params: [USER, '0x' + 'aa'.repeat(32)], chainId: null }, tab(12, 'https://x.example/'));
    await new Promise((r) => setTimeout(r, 5));
    core.onWindowRemoved(1);
    expect(await p).toMatchObject({ decision: 'block' });
  });
  test('a flood of risky requests: after 3 prompts a minute, the rest are blocked without a window', async () => {
    const { core, calls } = await setup();
    const t = tab(13, 'https://flood.example/');
    const all = await Promise.all(Array.from({ length: 6 }, (_, i) => core.handleMessage({ t: 'request', id: String(i), method: 'eth_sign', params: [], chainId: null }, t)));
    expect(calls.windows).toHaveLength(3);
    expect(all.every((d) => (d as { decision: string }).decision === 'block')).toBe(true);
    expect(core.publicState().stats.pageNoise).toBe(3);
  });
  test('plain sign-in and read methods pass without a prompt or a stat', async () => {
    const { core, calls } = await setup();
    const d = await core.handleMessage({ t: 'request', id: '1', method: 'personal_sign', params: ['0x48656c6c6f', USER], chainId: null }, tab(14, 'https://x.example/'));
    expect(d).toMatchObject({ decision: 'allow', verdict: 'pass' });
    expect(calls.windows).toHaveLength(0);
  });
  test('on the protocol site, an unknown contract call is escalated to risky (asks)', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    await core.handleMessage({ t: 'request', id: '1', method: 'eth_sendTransaction', params: [{ from: USER, to: DRAINER, data: '0xd0e30db0' }], chainId: 11155111 }, tab());
    expect(calls.windows).toHaveLength(1);
  });
});

describe('connect requests on look-alike sites (before the wallet shows its connect popup)', () => {
  const connect = (method = 'eth_requestAccounts') => ({ t: 'request', id: '1', method, params: [], chainId: null });
  test('a connect on an ordinary site or the official site passes without a prompt', async () => {
    const { core, calls } = await setup();
    await core.handleMessage({ t: 'hello' }, tab());
    expect(await core.handleMessage(connect(), tab())).toMatchObject({ decision: 'allow', verdict: 'pass' });
    expect(await core.handleMessage(connect('wallet_requestPermissions'), tab(2, 'https://app.uniswap.org/'))).toMatchObject({ decision: 'allow' });
    expect(await core.handleMessage(connect(), tab(3, 'http://127.0.0.1:9000/'))).toMatchObject({ decision: 'allow' });
    expect(await core.handleMessage(connect(), tab(4, 'http://app.demoswap.localhost:8080/'))).toMatchObject({ decision: 'allow' });
    // a word that merely contains the label is not a token match
    expect(await core.handleMessage(connect(), tab(5, 'https://mydemoswapper.example/'))).toMatchObject({ decision: 'allow' });
    expect(calls.windows).toHaveLength(0);
  });
  for (const host of ['demoswap-airdrop.localhost:8090', 'demoswap-rewards.localhost', 'app-demoswap.xyz', 'claim.demoswap.io', 'demoswap-blackout-claim.example']) {
    test(`${host} imitates the protocol: the confirm window opens first, as risky, naming the official origin`, async () => {
      const { core, calls, page } = await setup();
      const p = core.handleMessage(connect(), tab(40, `http://${host}/drainer`));
      await new Promise((r) => setTimeout(r, 5));
      expect(calls.windows).toHaveLength(1);
      const id = new URL(calls.windows[0]!).searchParams.get('id')!;
      const pending = (await core.handleMessage({ t: 'getConfirm', id }, page)) as { classification: { verdict: string; method: string; reasons: string[] } };
      expect(pending.classification.verdict).toBe('risky');
      expect(pending.classification.method).toBe('eth_requestAccounts');
      expect(pending.classification.reasons[0]).toBe(`This site imitates ${NAME} but is not its official address (${SITE} from ENS). Don't connect your wallet here.`);
      await core.handleMessage({ t: 'confirmDecision', id, allow: false }, page);
      expect(await p).toMatchObject({ decision: 'block', verdict: 'risky' });
    });
  }
  test('wallet_requestPermissions is checked the same way', async () => {
    const { core, calls } = await setup();
    expect(await core.handleMessage(connect('wallet_requestPermissions'), tab(41, 'http://demoswap-airdrop.localhost:8090/'))).toMatchObject({ decision: 'block' });
    expect(calls.windows).toHaveLength(1);
  });
  test('a host on a followed blocklist asks too (even with no look-alike name)', async () => {
    const { core, calls } = await setup({ blocklist: ['totally-legit.example'] });
    expect(await core.handleMessage(connect(), tab(42, 'https://totally-legit.example/'))).toMatchObject({ decision: 'block', verdict: 'risky' });
    expect(calls.windows).toHaveLength(1);
  });
  test('after the user chooses to connect anyway, later connects from that tab do not ask again; the drainer request still does', async () => {
    const { core, calls, page } = await setup();
    const t = tab(43, 'http://demoswap-airdrop.localhost:8090/drainer');
    const p = core.handleMessage(connect(), t);
    await new Promise((r) => setTimeout(r, 5));
    await core.handleMessage({ t: 'confirmDecision', id: new URL(calls.windows[0]!).searchParams.get('id')!, allow: true }, page);
    expect(await p).toMatchObject({ decision: 'allow' });
    expect(await core.handleMessage(connect(), t)).toMatchObject({ decision: 'allow' });
    expect(calls.windows).toHaveLength(1);
    const approve = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [DRAINER, 2n ** 256n - 1n] });
    const d = core.handleMessage({ t: 'request', id: '2', method: 'eth_sendTransaction', params: [{ from: USER, to: TOKEN, data: approve }], chainId: 11155111 }, t);
    await new Promise((r) => setTimeout(r, 5));
    expect(calls.windows).toHaveLength(2);
    expect(await d).toMatchObject({ decision: 'block', verdict: 'dangerous' });
  });
});

describe('setup & kit', () => {
  test('the kit hands over an address; it is only used after the user accepts it on a trusted page', async () => {
    const { core, page } = await setup();
    await core.handleMessage({ t: 'kit-address', address: DRAINER }, tab(20, 'https://kit.example/copeybara-kit.html'));
    expect(core.publicState().settings.account).toBe(USER);
    expect(core.publicState().pendingAddress?.address).toBe(DRAINER);
    await core.handleMessage({ t: 'acceptAddress' }, page);
    expect(core.publicState().settings.account).toBe(DRAINER);
  });
  test('Exit safely opens the kit only when its bytes match the release', async () => {
    const { core, calls, page } = await setup();
    expect(await core.handleMessage({ t: 'openKit', name: NAME }, page)).toEqual({ ok: true });
    expect(calls.tabsCreate[0]).toBe(`https://kit.example/copeybara-kit.html?ens=${NAME}`);
    records.release = { sha256: 'ee'.repeat(32), version: 6 };
    now += FRESH;
    const r = (await core.handleMessage({ t: 'openKit', name: NAME }, page)) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not match/);
    expect(calls.tabsCreate).toHaveLength(1);
  });
  test('settings patches are validated (no javascript: kit URL)', async () => {
    const { core, page } = await setup();
    expect(await core.handleMessage({ t: 'settings', patch: { kitUrl: 'javascript:alert(1)' } }, page)).toEqual({ error: 'bad message' });
  });
  test('state survives a worker restart (storage)', async () => {
    const { store, chrome } = (await setup()) as unknown as { store: Record<string, unknown>; chrome: ChromeLike };
    const again = createCore({ chrome, readRecords: async () => records as CopeybaraRecords, fetchBytes: async () => kitBytes, rpcChainId: async () => 1, now: () => now, defaultRpcs: [], defaultKitUrl: 'x', version: 't' });
    await again.load();
    expect(again.publicState().protocols.map((p) => p.name)).toEqual([NAME]);
    expect(store.settings).toMatchObject({ account: USER });
  });
});

const FRESH = 61_000;
