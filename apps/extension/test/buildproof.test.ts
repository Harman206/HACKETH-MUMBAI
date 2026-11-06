import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import type { CopeybaraRecords } from '@copeybara/ens';
import type { ReleaseRecord } from '@copeybara/core';
import { createCore, type ChromeLike } from '../src/background/core';
import { BUILD_FILES, parseBuildFiles, treeHash, treeLines } from '../src/shared/buildproof';
import { parsePageMsg } from '../src/shared/messages';

const EXT = 'chrome-extension://abc/';
const NAME = 'demoswap-blackout.eth';
const OTHER = 'other-protocol.eth';
const hex = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const enc = (s: string) => new TextEncoder().encode(s);

describe('tree hash', () => {
  test('= sha256 over the sorted "<path>\\t<sha256>\\n" lines (order of input does not matter)', async () => {
    const a = { path: 'manifest.json', sha256: hex('{}') };
    const b = { path: 'assets/x.js', sha256: hex('x') };
    const lines = `assets/x.js\t${hex('x')}\nmanifest.json\t${hex('{}')}\n`;
    expect(treeLines([a, b])).toBe(lines);
    expect(await treeHash([a, b])).toBe(hex(lines));
    expect(await treeHash([b, a])).toBe(hex(lines));
  });
  test('refuses duplicate paths and malformed hashes', () => {
    expect(() => treeLines([{ path: 'a', sha256: hex('1') }, { path: 'a', sha256: hex('2') }])).toThrow(/twice/);
    expect(() => treeLines([{ path: 'a', sha256: 'zz' }])).toThrow(/hash/);
  });
});

describe('build-files.json', () => {
  const ok = { v: 1, files: [BUILD_FILES, 'assets/a.js', 'manifest.json'].sort() };
  test('a sorted list of relative paths that includes manifest.json and itself', () => {
    expect(parseBuildFiles(JSON.stringify(ok))).toEqual(ok.files);
  });
  test.each([
    ['not JSON', '{'],
    ['wrong version', JSON.stringify({ ...ok, v: 2 })],
    ['missing itself', JSON.stringify({ v: 1, files: ['manifest.json'] })],
    ['missing manifest', JSON.stringify({ v: 1, files: [BUILD_FILES] })],
    ['parent path', JSON.stringify({ v: 1, files: ['../x', BUILD_FILES, 'manifest.json'] })],
    ['absolute path', JSON.stringify({ v: 1, files: ['/etc', BUILD_FILES, 'manifest.json'] })],
    ['backslash', JSON.stringify({ v: 1, files: [BUILD_FILES, 'a\\b', 'manifest.json'] })],
    ['unsorted', JSON.stringify({ v: 1, files: ['manifest.json', BUILD_FILES] })],
    ['duplicate', JSON.stringify({ v: 1, files: [BUILD_FILES, 'manifest.json', 'manifest.json'] })],
    ['non-ASCII', JSON.stringify({ v: 1, files: [BUILD_FILES, 'manifest.json', 'ü.js'] })],
  ])('rejects %s', (_, text) => {
    expect(() => parseBuildFiles(text)).toThrow();
  });
});

// ---------- the worker's {t:'buildProof'} ----------

const FILES: Record<string, string> = {
  'manifest.json': '{"manifest_version":3,"version":"0.1.0"}\n',
  'background.js': 'console.log("worker")',
  'assets/sidepanel-abc.js': 'console.log("panel")',
};
FILES[BUILD_FILES] = JSON.stringify({ v: 1, files: [...Object.keys(FILES), BUILD_FILES].sort() }) + '\n';
const goodTree = hex(
  Object.keys(FILES)
    .sort()
    .map((p) => `${p}\t${hex(FILES[p]!)}\n`)
    .join(''),
);
const ZIP = 'ab'.repeat(32);

async function setup(opts: { extension?: Record<string, ReleaseRecord | null>; files?: Record<string, string>; follow?: string[] } = {}) {
  const files = opts.files ?? FILES;
  const fetched: string[] = [];
  const store: Record<string, unknown> = {};
  const chrome: ChromeLike = {
    runtime: { id: 'abc', getURL: (p) => EXT + p.replace(/^\//, ''), getManifest: () => ({ version: '0.1.0' }) },
    storage: { local: { get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])), set: async (o) => void Object.assign(store, structuredClone(o)) } },
    tabs: { update: async () => undefined, create: async () => undefined, sendMessage: async () => undefined },
    windows: { create: async () => ({ id: 1 }) },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
  };
  const core = createCore({
    chrome,
    readRecords: async (name) =>
      ({
        name,
        url: `https://${name}.example`,
        release: { sha256: ZIP, version: 1 },
        manifest: { v: 1, chains: {} },
        site: null,
        extension: opts.extension?.[name] ?? null,
        status: { state: 'ok' },
        blocklist: [],
        problems: [],
        block: 1n,
        resolver: '0x2222222222222222222222222222222222222222',
      }) as CopeybaraRecords,
    fetchBytes: async (url) => {
      fetched.push(url);
      if (!url.startsWith(EXT)) throw new Error('not an extension URL');
      const f = files[url.slice(EXT.length)];
      if (f === undefined) throw new Error('net::ERR_FILE_NOT_FOUND');
      return enc(f);
    },
    rpcChainId: async () => 11155111,
    now: () => 1_000_000,
    defaultRpcs: ['https://a', 'https://b', 'https://c'],
    defaultKitUrl: 'https://kit.example/copeybara-kit.html',
    version: 'test',
  });
  const page = { id: 'abc', url: `${EXT}src/pages/dashboard.html` };
  for (const n of opts.follow ?? [NAME]) await core.handleMessage({ t: 'follow', name: n }, page);
  return { core, page, fetched };
}

describe("worker: {t:'buildProof'}", () => {
  test('page-only message, validated', () => {
    expect(parsePageMsg({ t: 'buildProof' })).toEqual({ t: 'buildProof' });
  });
  test('a content script cannot ask for it', async () => {
    const { core } = await setup();
    const url = 'https://site.example/';
    expect(await core.handleMessage({ t: 'buildProof' }, { id: 'abc', url, origin: 'https://site.example', tab: { id: 3, url }, frameId: 0 })).toEqual({ error: 'bad message' });
  });
  test('installed files hash to the tree in the ENS record → match; every file read from the extension itself', async () => {
    const { core, page, fetched } = await setup({ extension: { [NAME]: { sha256: ZIP, version: 4, tree: goodTree } } });
    const r = await core.handleMessage({ t: 'buildProof' }, page);
    expect(r).toEqual({ version: '0.1.0', treeHash: goodTree, files: 4, ens: { name: NAME, version: 4, tree: goodTree, zip: ZIP }, verdict: 'match' });
    expect(fetched.sort()).toEqual(Object.keys(FILES).map((p) => EXT + p).sort());
  });
  test('one changed byte in an installed file → mismatch', async () => {
    const { core, page } = await setup({ extension: { [NAME]: { sha256: ZIP, version: 4, tree: goodTree } }, files: { ...FILES, 'background.js': 'console.log("worker!")' } });
    const r = (await core.handleMessage({ t: 'buildProof' }, page)) as { verdict: string; treeHash: string };
    expect(r.verdict).toBe('mismatch');
    expect(r.treeHash).not.toBe(goodTree);
  });
  test('an edited build-files.json (a file dropped from the list) also changes the tree → mismatch', async () => {
    const list = JSON.stringify({ v: 1, files: ['background.js', BUILD_FILES, 'manifest.json'] }) + '\n';
    const { core, page } = await setup({ extension: { [NAME]: { sha256: ZIP, version: 4, tree: goodTree } }, files: { ...FILES, [BUILD_FILES]: list } });
    expect(((await core.handleMessage({ t: 'buildProof' }, page)) as { verdict: string }).verdict).toBe('mismatch');
  });
  test('a record written before tree hashes existed → old-record (zip hash only, cannot compare from inside)', async () => {
    const { core, page } = await setup({ extension: { [NAME]: { sha256: ZIP, version: 2 } } });
    expect(await core.handleMessage({ t: 'buildProof' }, page)).toMatchObject({ treeHash: goodTree, ens: { name: NAME, version: 2, tree: null, zip: ZIP }, verdict: 'old-record' });
  });
  test('followed protocols publish no extension record → no-record', async () => {
    const { core, page } = await setup();
    expect(await core.handleMessage({ t: 'buildProof' }, page)).toMatchObject({ treeHash: goodTree, ens: null, verdict: 'no-record' });
  });
  test('nothing followed → no-record (no name is assumed)', async () => {
    const { core, page } = await setup({ follow: [] });
    expect(await core.handleMessage({ t: 'buildProof' }, page)).toMatchObject({ ens: null, verdict: 'no-record' });
  });
  test('several protocols publish one: the one whose tree matches is reported', async () => {
    const { core, page } = await setup({
      follow: [OTHER, NAME],
      extension: { [OTHER]: { sha256: ZIP, version: 1, tree: 'ee'.repeat(32) }, [NAME]: { sha256: ZIP, version: 4, tree: goodTree } },
    });
    expect(await core.handleMessage({ t: 'buildProof' }, page)).toMatchObject({ ens: { name: NAME }, verdict: 'match' });
  });
  test('a listed file that cannot be read → error, never a verdict', async () => {
    const { ['background.js']: _, ...missing } = FILES;
    const { core, page } = await setup({ extension: { [NAME]: { sha256: ZIP, version: 4, tree: goodTree } }, files: missing });
    expect(await core.handleMessage({ t: 'buildProof' }, page)).toEqual({ error: expect.stringMatching(/background\.js/) });
  });
  test('an unreadable build-files.json → error', async () => {
    const { core, page } = await setup({ files: { ...FILES, [BUILD_FILES]: '{' } });
    expect(await core.handleMessage({ t: 'buildProof' }, page)).toEqual({ error: expect.stringMatching(/build-files\.json/) });
  });
});
