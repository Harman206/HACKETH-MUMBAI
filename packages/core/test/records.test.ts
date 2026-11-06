import { describe, expect, test } from 'vitest';
import {
  COPEYBARA_KEYS,
  RecordFormatError,
  formatBlocklist,
  formatSiteRecord,
  formatStatus,
  hostMatches,
  parseBlocklist,
  parseSiteRecord,
  parseStatus,
} from '../src';

const H1 = 'a'.repeat(64);
const H2 = '0123456789abcdef'.repeat(4);

describe('record keys', () => {
  test('all keys live under org.copeybara', () => {
    expect(COPEYBARA_KEYS).toEqual({
      release: 'org.copeybara.release',
      manifest: 'org.copeybara.manifest',
      site: 'org.copeybara.site',
      extension: 'org.copeybara.extension',
      status: 'org.copeybara.status',
      blocklist: 'org.copeybara.blocklist',
    });
  });
});

describe('status record', () => {
  test('empty means ok', () => {
    expect(parseStatus('')).toEqual({ state: 'ok' });
    expect(parseStatus('   ')).toEqual({ state: 'ok' });
  });
  test('round-trips with a note that needs escaping', () => {
    const r = { state: 'compromised' as const, at: 1793965507, note: 'Site serves 2 unknown scripts; use the kit; 100% sure=yes' };
    const s = formatStatus(r);
    expect(s).toBe('v=1;state=compromised;at=1793965507;note=Site%20serves%202%20unknown%20scripts%3B%20use%20the%20kit%3B%20100%25%20sure%3Dyes');
    expect(parseStatus(s)).toEqual(r);
  });
  test('ok and degraded without extras', () => {
    expect(parseStatus('v=1;state=ok')).toEqual({ state: 'ok' });
    expect(parseStatus('v=1;state=degraded;at=5')).toEqual({ state: 'degraded', at: 5 });
  });
  test('notes are capped at 200 characters when formatting', () => {
    const s = formatStatus({ state: 'degraded', note: 'x'.repeat(500) });
    expect(parseStatus(s).note).toHaveLength(200);
  });
  test.each([
    'state=compromised',
    'v=2;state=ok',
    'v=1;state=burning',
    'v=1;state=ok;at=-1',
    'v=1;state=ok;at=1.5',
    'v=1;state=ok;note=%E0%A4%A',
    'v=1;state=ok;state=compromised',
    'v=1;state=ok;color=red',
  ])('rejects %s', (s) => {
    expect(() => parseStatus(s)).toThrow(RecordFormatError);
  });
});

describe('blocklist record', () => {
  test('empty means no domains', () => {
    expect(parseBlocklist('')).toEqual([]);
  });
  test('parses, lowercases and de-duplicates', () => {
    expect(parseBlocklist('{"v":1,"domains":["Demoswap-Rewards.xyz","demoswap-rewards.xyz","app.evil.example"]}')).toEqual([
      'demoswap-rewards.xyz',
      'app.evil.example',
    ]);
  });
  test('format is canonical JSON', () => {
    expect(formatBlocklist(['b.example', 'a.example', 'b.example'])).toBe('{"v":1,"domains":["a.example","b.example"]}');
  });
  test.each([
    '{"v":2,"domains":[]}',
    '{"v":1}',
    '{"v":1,"domains":["https://evil.example"]}',
    '{"v":1,"domains":["evil.example/path"]}',
    '{"v":1,"domains":["*.evil.example"]}',
    '{"v":1,"domains":["localhost:8082"]}',
    '{"v":1,"domains":[""]}',
    'not json',
  ])('rejects %s', (s) => {
    expect(() => parseBlocklist(s)).toThrow(RecordFormatError);
  });
  test('accepts single-label hosts used by local demos', () => {
    expect(parseBlocklist('{"v":1,"domains":["rewards-demoswap.localhost"]}')).toEqual(['rewards-demoswap.localhost']);
  });
});

describe('hostMatches', () => {
  test.each([
    ['demoswap.localhost', 'demoswap.localhost', true],
    ['app.x.com', 'x.com', true],
    ['a.b.x.com', 'x.com', true],
    ['ax.com', 'x.com', false],
    ['evil-demoswap.localhost', 'demoswap.localhost', false],
    ['demoswap.localhost.evil.example', 'demoswap.localhost', false],
    ['X.COM', 'x.com', true],
    ['x.com.', 'x.com', true],
  ])('%s vs %s → %s', (host, domain, want) => {
    expect(hostMatches(host, domain)).toBe(want);
  });
});

describe('site record', () => {
  test('empty → null (no fingerprint published)', () => {
    expect(parseSiteRecord('')).toBeNull();
  });
  test('legacy single hash', () => {
    expect(parseSiteRecord(`sha256:${H1}`)).toEqual([H1]);
  });
  test('v2 set, normalised to lowercase and de-duplicated', () => {
    expect(parseSiteRecord(`v=2;sha256=${H2},${H1.toUpperCase()},${H2}`)).toEqual([H2, H1]);
  });
  test('format sorts and de-duplicates', () => {
    expect(formatSiteRecord([H2, H1, H2])).toBe(`v=2;sha256=${H2},${H1}`);
  });
  test.each(['sha256:abc', `v=2;sha256=${H1},zz`, `v=3;sha256=${H1}`, 'v=2;sha256=', `v=2;${H1}`])('rejects %s', (s) => {
    expect(() => parseSiteRecord(s)).toThrow(RecordFormatError);
  });
});
