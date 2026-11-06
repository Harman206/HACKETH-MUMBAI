import { describe, expect, test } from 'vitest';
import { identityLine, parseAgentRecord, readAgentIdentity, type AgentIdentity } from '../src/identity';

const SAFE = '0x3ae03951044Ced07F7fa12072CfE7F95827A057F';
const ME = '0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8';
const NAME = 'watcher.demoswap-blackout.eth';
const JSON_REC = `{"role":"watcher","may_write":["org.copeybara.status","org.copeybara.blocklist"],"of":"demoswap-blackout.eth","operator":"${SAFE}","code":"apps/watcher","version":1}`;

describe('org.copeybara.agent record', () => {
  test('parses the record the Safe writes (contracts: watcherAgentJson)', () => {
    expect(parseAgentRecord(JSON_REC)).toEqual({
      role: 'watcher',
      may_write: ['org.copeybara.status', 'org.copeybara.blocklist'],
      of: 'demoswap-blackout.eth',
      operator: SAFE,
      code: 'apps/watcher',
      version: 1,
    });
  });
  test.each([
    ['not json', 'role=watcher'],
    ['not an object', '[1,2]'],
    ['missing role', JSON_REC.replace('"role":"watcher",', '')],
    ['may_write not a list of strings', JSON_REC.replace('["org.copeybara.status","org.copeybara.blocklist"]', '"org.copeybara.status"')],
    ['bad operator', JSON_REC.replace(SAFE, '0x1234')],
    ['unknown version', JSON_REC.replace('"version":1', '"version":2')],
  ])('rejects %s', (_why, s) => {
    expect(() => parseAgentRecord(s)).toThrow();
  });
  test('ignores unknown extra fields (forward compatible within version 1)', () => {
    expect(parseAgentRecord(JSON_REC.replace('"version":1', '"version":1,"model":"x"')).role).toBe('watcher');
  });
});

describe('reading the identity from ENS', () => {
  const texts: Record<string, string> = { description: 'Copeybara watcher agent', url: 'https://example.org/apps/watcher', 'org.copeybara.agent': JSON_REC };
  const readers = (over: Partial<Record<string, string>> = {}, addr: string | null = ME) => ({
    readText: async (n: string, k: string) => (n === NAME ? ({ ...texts, ...over } as Record<string, string>)[k] ?? '' : ''),
    readAddr: async (n: string) => (n === NAME ? addr : null),
  });

  test('verified when addr is my key and the agent record parses', async () => {
    const r = readers();
    const id = await readAgentIdentity(NAME, r.readText, r.readAddr, ME);
    expect(id).toMatchObject({ name: NAME, addr: ME, verified: true, problems: [], description: 'Copeybara watcher agent', url: 'https://example.org/apps/watcher' });
    expect(id.agent?.may_write).toEqual(['org.copeybara.status', 'org.copeybara.blocklist']);
    expect(identityLine(id)).toBe(
      `I am ${NAME}, allowed to write org.copeybara.status, org.copeybara.blocklist on demoswap-blackout.eth (operator ${SAFE}; identity verified on ENS)`,
    );
  });
  test('address comparison is case-insensitive', async () => {
    const r = readers({}, ME.toLowerCase());
    expect((await readAgentIdentity(NAME, r.readText, r.readAddr, ME)).verified).toBe(true);
  });
  test('addr pointing elsewhere: not verified, and the line says so', async () => {
    const r = readers({}, '0x000000000000000000000000000000000000dEaD');
    const id = await readAgentIdentity(NAME, r.readText, r.readAddr, ME);
    expect(id.verified).toBe(false);
    expect(identityLine(id)).toMatch(/NOT verified/);
    expect(id.problems.join(' ')).toMatch(/0x000000000000000000000000000000000000dEaD/);
  });
  test('no records at all: not verified, no throw', async () => {
    const id = await readAgentIdentity('nobody.eth', readers().readText, readers().readAddr, ME);
    expect(id).toMatchObject({ verified: false, agent: null, addr: null });
    expect(identityLine(id)).toMatch(/no ENS identity/);
  });
  test('malformed agent record is reported, not fatal', async () => {
    const r = readers({ 'org.copeybara.agent': '{oops' });
    const id: AgentIdentity = await readAgentIdentity(NAME, r.readText, r.readAddr, ME);
    expect(id.verified).toBe(false);
    expect(id.problems.some((p) => p.startsWith('org.copeybara.agent'))).toBe(true);
  });
  test('a read failure (RPC down) is reported, not fatal', async () => {
    const id = await readAgentIdentity(NAME, async () => Promise.reject(new Error('quorum: no agreement')), async () => ME, ME);
    expect(id.verified).toBe(false);
    expect(id.problems.join(' ')).toMatch(/quorum/);
  });
});
