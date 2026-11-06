import { describe, expect, test } from 'vitest';
import { COPEYBARA_KEYS } from '@copeybara/core';
import { certifyLive, compare, failed, ROLE_SET_TEXT, kitProblems, type OnChainState } from '../src';
import { roleCases, runRoleCases, type Probe } from '../src/roles';
import { loaded, RESOLVER, SAFE, WATCHER, WEB } from './helpers';

const K = COPEYBARA_KEYS;
const H = 'ab'.repeat(32);
const SITE = `v=2;sha256=${'cd'.repeat(32)}`;
const state = (over: Partial<OnChainState> = {}, roles: Record<string, Record<string, bigint>> = {}): OnChainState => ({
  block: 1n,
  resolver: RESOLVER,
  texts: { url: 'https://x', [K.release]: `sha256:${H};v=3`, [K.manifest]: 'M', [K.exits]: 'E', [K.site]: SITE, [K.status]: '', [K.blocklist]: '', [K.extension]: '' },
  roles: { [WEB.toLowerCase()]: { root: 0n, url: ROLE_SET_TEXT }, [WATCHER.toLowerCase()]: { root: 0n, [K.status]: ROLE_SET_TEXT, [K.blocklist]: ROLE_SET_TEXT }, ...roles },
  safe: { threshold: 2n, owners: [SAFE, SAFE, SAFE], nonce: 0n },
  owner: SAFE,
  ...over,
});
const expected = { name: 'x.eth', resolver: RESOLVER, safe: SAFE, websiteKey: WEB, watcher: WATCHER, kit: { sha256: H, version: 3 }, manifest: 'M', exits: 'E' };

describe('copeybara verify', () => {
  test('all MATCH', () => {
    const cs = compare(expected, state());
    expect(failed(cs)).toBe(false);
    expect(cs.find((c) => c.name === 'release')!.detail).toMatch(/^MATCH v=3/);
  });
  test.each([
    ['kit bytes differ', { ...expected, kit: { sha256: 'ef'.repeat(32), version: 3 } }, state(), 'release'],
    ['manifest differs', { ...expected, manifest: 'M2' }, state(), 'manifest'],
    ['exit spec published but not in config', { ...expected, exits: '' }, state(), 'exits'],
    ['site fingerprint differs from the build', { ...expected, site: ['ef'.repeat(32)] }, state(), 'site'],
    ['website key can also write release', expected, state({}, { [WEB.toLowerCase()]: { root: 0n, url: ROLE_SET_TEXT, [K.release]: ROLE_SET_TEXT } }), 'website key'],
    ['website key holds root setText', expected, state({}, { [WEB.toLowerCase()]: { root: ROLE_SET_TEXT } }), 'website key'],
    ['watcher can write the manifest', expected, state({}, { [WATCHER.toLowerCase()]: { root: 0n, [K.status]: ROLE_SET_TEXT, [K.manifest]: ROLE_SET_TEXT } }), 'watcher key'],
    ['resolver moved', expected, state({ resolver: SAFE }), 'resolver'],
    ['owner is not a Safe', expected, state({ safe: null }), 'safe'],
    ['the name is owned by someone else', expected, state({ owner: WEB }), 'owner'],
  ])('MISMATCH: %s → exit 1', (_n, e, s, name) => {
    const cs = compare(e, s);
    expect(failed(cs)).toBe(true);
    expect(cs.find((c) => c.level === 'fail')!.name).toBe(name);
  });
  test('compromised status and a 1-of-n Safe warn but do not fail verify', () => {
    const cs = compare(expected, state({ safe: { threshold: 1n, owners: [SAFE], nonce: 0n }, texts: { ...state().texts, [K.status]: 'v=1;state=compromised;at=1' } }));
    expect(failed(cs)).toBe(false);
    expect(cs.filter((c) => c.level === 'warn').map((c) => c.name).sort()).toEqual(['safe', 'status']);
  });
});

describe('Copeybara certified (live checks)', () => {
  const records = { problems: [], release: { sha256: H, version: 3 }, manifest: { v: 1, chains: { '1': {} } } } as never;
  const e = { safe: SAFE, resolver: RESOLVER, websiteKey: WEB, watcher: WATCHER };
  test('passes for a scoped, Safe-owned, watched name', () => {
    expect(failed(certifyLive(e, state(), records))).toBe(false);
  });
  test.each([
    ['name owned by another account', state({ owner: WEB }), records],
    ['owner not readable', state({ owner: null }), records],
    ['1-of-n Safe', state({ safe: { threshold: 1n, owners: [SAFE], nonce: 0n } }), records],
    ['no watcher role', state({}, { [WATCHER.toLowerCase()]: { root: 0n } }), records],
    ['website key over-privileged', state({}, { [WEB.toLowerCase()]: { root: ROLE_SET_TEXT } }), records],
    ['no site fingerprint', state({ texts: { ...state().texts, [K.site]: '' } }), records],
    ['status compromised', state({ texts: { ...state().texts, [K.status]: 'v=1;state=compromised;at=1' } }), records],
    ['records the kit cannot read', state(), new Error('no release record')],
  ])('suspended: %s', (_n, s, r) => {
    expect(failed(certifyLive(e, s, r as never))).toBe(true);
  });
});

describe('copeybara roles-check', () => {
  const { cfg } = loaded();
  const cases = roleCases(cfg);
  /** A resolver that enforces exactly the scoped grants. */
  const honest: Probe = async (from, data) => {
    const c = cases.find((x) => x.from === from && x.data === data)!;
    if (from === SAFE) return 'ok';
    return c.expect;
  };
  test('every forbidden write is paired with a Safe control and escalations are covered', () => {
    expect(cases.filter((c) => c.who === 'Safe (control)').length).toBe(cases.filter((c) => c.who !== 'Safe (control)' && c.action.startsWith('write') && c.expect === 'reverted').length);
    expect(cases.filter((c) => /grant itself|upgrade/.test(c.action))).toHaveLength(6);
  });
  test('an honest resolver passes; a resolver that lets the website key write release fails', async () => {
    expect((await runRoleCases(cases, honest)).every((r) => r.pass)).toBe(true);
    const leaky: Probe = async (from, data) => (from === WEB && cases.find((c) => c.data === data)!.action === `write ${K.release}` ? 'ok' : honest(from, data));
    expect((await runRoleCases(cases, leaky)).filter((r) => !r.pass).map((r) => r.action)).toEqual([`write ${K.release}`]);
  });
  test('a resolver that reverts everything fails on the Safe controls (no false pass)', async () => {
    const res = await runRoleCases(cases, async () => 'reverted');
    expect(res.some((r) => r.who === 'Safe (control)' && !r.pass)).toBe(true);
  });
});

describe('copeybara release: kit checks', () => {
  const ok = `<!doctype html><html><head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-abc='">\n</head><body><script type="module">1</script></body></html>`;
  test('a single-file kit passes', () => expect(kitProblems(ok)).toEqual([]));
  test('an external script, a second script, a remote link or no CSP pin fail', () => {
    expect(kitProblems(ok.replace('<script type="module">', '<script src="https://cdn.x/a.js">'))).not.toEqual([]);
    expect(kitProblems(ok.replace('</body>', '<script>2</script></body>'))).not.toEqual([]);
    expect(kitProblems(ok.replace('</head>', '<link rel="stylesheet" href="https://fonts.x/a.css"></head>'))).not.toEqual([]);
    expect(kitProblems(ok.replace("script-src 'sha256-abc='", "script-src 'self'"))).not.toEqual([]);
  });
});
