import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAddress } from 'viem';
import { COPEYBARA_KEYS } from '@copeybara/core';
import { ROLE_SET_TEXT, type OnChainState } from '@copeybara/protocol-cli/onchain';
import { parseRoute } from '../src/router';
import { CERTIFIED, RULE, checkCertified, findCertified } from '../src/certified';
import { CLI, ONBOARDING, VERIFY_OUTPUT } from '../src/developers';

const REPO = join(__dirname, '..', '..', '..');
const K = COPEYBARA_KEYS;

describe('routes', () => {
  test.each([
    ['', { page: 'home' }],
    ['#how', { page: 'home' }],
    ['#/developers', { page: 'developers' }],
    ['#/developers/onboarding', { page: 'developers', section: 'onboarding' }],
    ['#/developers/<script>', { page: 'developers' }],
    ['#/extension', { page: 'extension' }],
    ['#/certified', { page: 'certified', name: null }],
    ['#/certified/DemoSwap-Blackout.eth', { page: 'certified', name: 'demoswap-blackout.eth' }],
    ['#/nope', { page: 'home' }],
  ])('%s', (hash, want) => expect(parseRoute(hash)).toEqual(want));
});

describe('Copeybara certified registry', () => {
  test('every entry is well formed; the demo entry matches the deployment', () => {
    for (const e of CERTIFIED) {
      expect(e.name).toMatch(/^[a-z0-9-]+\.eth$/);
      for (const a of [e.safe, e.resolver, e.websiteKey, e.watcher]) expect(isAddress(a), a).toBe(true);
      expect(e.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const d = JSON.parse(readFileSync(join(REPO, 'contracts', 'deployments', 'sepolia.json'), 'utf8'));
    expect(findCertified('demoswap-blackout.eth')).toMatchObject({ safe: d.safe, resolver: d.resolver, websiteKey: d.webKey, watcher: d.copeybara.watcher });
    expect(findCertified('evil-swap.eth')).toBeNull();
  });

  const e = CERTIFIED[0]!;
  const state = (over: Partial<OnChainState> = {}): OnChainState => ({
    block: 7n,
    resolver: e.resolver,
    owner: e.safe,
    texts: { [K.site]: `v=2;sha256=${'ab'.repeat(32)}`, [K.status]: 'v=1;state=degraded;at=1;note=Official%20site%20is%20unreachable.' },
    roles: { [e.websiteKey.toLowerCase()]: { root: 0n, url: ROLE_SET_TEXT }, [e.watcher.toLowerCase()]: { root: 0n, [K.status]: ROLE_SET_TEXT, [K.blocklist]: ROLE_SET_TEXT } },
    safe: { threshold: 2n, owners: [e.safe, e.safe, e.safe], nonce: 0n },
    ...over,
  });
  const records = async () => ({ problems: [], release: { sha256: 'ab'.repeat(32), version: 6 }, manifest: { v: 1, chains: { '11155111': {} } } }) as never;

  test('the tick is computed from what ENS says now, never cached', async () => {
    const v = await checkCertified(e, {} as never, { readOnChain: async () => state(), readRecords: records });
    expect(v).toMatchObject({ certified: true, block: 7n });
    expect(v.checks.map((c) => c.name).every((n) => n in RULE)).toBe(true);
    expect(v.checks.find((c) => c.name === 'status')!.detail).toBe('degraded: Official site is unreachable.');
  });
  test.each([
    ['the Safe no longer owns the name', state({ owner: e.websiteKey })],
    ['the website key can write the release', state({ roles: { ...state().roles, [e.websiteKey.toLowerCase()]: { root: 0n, url: ROLE_SET_TEXT, [K.release]: ROLE_SET_TEXT } } })],
    ['a 1-of-1 Safe', state({ safe: { threshold: 1n, owners: [e.safe], nonce: 0n } })],
    ['status compromised', state({ texts: { ...state().texts, [K.status]: 'v=1;state=compromised;at=1' } })],
  ])('suspended when %s', async (_n, s) => {
    expect((await checkCertified(e, {} as never, { readOnChain: async () => s, readRecords: records })).certified).toBe(false);
  });
});

describe('developer page copy', () => {
  test('lists every CLI command the tool has', () => {
    const help = readFileSync(join(REPO, 'packages', 'protocol-cli', 'src', 'main.ts'), 'utf8').match(/const HELP = `([\s\S]*?)`;/)![1]!;
    const commands = [...help.matchAll(/^ {2}([a-z-]+(?: new)?)\b/gm)].map((m) => m[1]);
    for (const c of commands) expect(CLI.some(([x]) => x.startsWith(c!)), c).toBe(true);
  });
  test('the verify output shown is the demo’s published release', () => {
    const d = JSON.parse(readFileSync(join(REPO, 'contracts', 'deployments', 'sepolia.json'), 'utf8'));
    expect(VERIFY_OUTPUT).toContain(`MATCH v=${d.kitReleaseVersion} ${d.kitRelease}`);
    expect(VERIFY_OUTPUT).toContain('verify: OK');
  });
  test('onboarding: every command and flag is one the CLI has', () => {
    const main = readFileSync(join(REPO, 'packages', 'protocol-cli', 'src', 'main.ts'), 'utf8');
    const options = main.match(/options: \{([\s\S]*?)\n {4}\},\n {2}\}\);/)![1]!;
    const flags = new Set([...options.matchAll(/^\s+'?([a-z-]+)'?: \{ type/gm)].map((m) => m[1]));
    let n = 0;
    for (const s of ONBOARDING) {
      for (const c of s.cmds) {
        for (const line of c.code.split('\n')) {
          const m = line.match(/^pnpm copeybara ([a-z-]+)(.*)$/);
          if (!m) continue;
          n++;
          expect(m[1] === 'help' || CLI.some(([x]) => x.split(' ')[0] === m[1]), `${s.id}: ${m[1]}`).toBe(true);
          for (const f of m[2]!.matchAll(/--([a-z-]+)/g)) expect(flags.has(f[1]), `${s.id}: --${f[1]}`).toBe(true);
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(12);
  });
  test('onboarding: the flow a protocol team follows, in order, each step with a command (or the Safe), output and a done check', () => {
    expect(ONBOARDING.map((s) => s.id)).toEqual(['install', 'init', 'exits', 'fingerprint', 'propose', 'sign', 'verify', 'certify', 'widget', 'watcher', 'runbook']);
    for (const s of ONBOARDING) {
      expect(s.cmds.length, s.id).toBeGreaterThan(0);
      expect(s.see.length, s.id).toBeGreaterThan(20);
      expect(s.done.length, s.id).toBeGreaterThan(5);
      for (const l of s.links ?? []) expect(l.href, s.id).toMatch(/^(https:\/\/github\.com\/|#)/);
    }
  });
  test('onboarding: the output shown is what the CLI prints', () => {
    const src = (f: string) => readFileSync(join(REPO, 'packages', 'protocol-cli', 'src', f), 'utf8');
    const all = ['main.ts', 'watcher.ts', 'roles.ts'].map(src).join('\n');
    const see = (id: string) => ONBOARDING.find((s) => s.id === id)!.see;
    expect(all).toContain('fill in the addresses, then run copeybara manifest');
    expect(see('init')).toContain('fill in the addresses, then run copeybara manifest');
    expect(all).toContain('Transaction Builder file → ');
    expect(see('propose')).toContain('Transaction Builder file → .copeybara/safe-batch.json');
    expect(see('watcher')).toContain('wrote .copeybara/watcher/compose.yml and watcher.env.example');
    expect(all).toContain('certify: PASS — send certification.json to Copeybara to be listed with the certified tick.');
    expect(see('certify')).toContain('certify: PASS — send certification.json to Copeybara to be listed with the certified tick.');
    expect(see('verify')).toContain(VERIFY_OUTPUT);
  });
});
