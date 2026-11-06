// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, rpcUrlsFor, saveSettings } from '../src/settings';
import { maxSeenVersion, recordSeenVersion, safeGet, safeSet } from '../src/storage';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('storage', () => {
  test('safeGet returns null and safeSet is a no-op when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(safeGet('x')).toBeNull();
    expect(() => safeSet('x', 'y')).not.toThrow();
  });

  test('highest seen release version per name, for rollback warnings', () => {
    expect(maxSeenVersion('a.eth')).toBe(0);
    recordSeenVersion('a.eth', 3);
    recordSeenVersion('a.eth', 2);
    expect(maxSeenVersion('a.eth')).toBe(3);
    expect(maxSeenVersion('b.eth')).toBe(0);
  });
});

describe('settings', () => {
  test('defaults on empty or corrupt storage', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem('copeybara.settings.v1', '{nope');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test('round trip, and invalid fields fall back to defaults', () => {
    saveSettings({ ...DEFAULT_SETTINGS, ensName: 'demoswap-blackout.eth', userRpcs: { '11155111': ['https://my.rpc'] } });
    expect(loadSettings().ensName).toBe('demoswap-blackout.eth');
    expect(loadSettings().userRpcs['11155111']).toEqual(['https://my.rpc']);
    localStorage.setItem('copeybara.settings.v1', JSON.stringify({ slippageBps: 99999, userRpcs: { '1': ['javascript:alert(1)'] } }));
    expect(loadSettings().slippageBps).toBe(DEFAULT_SETTINGS.slippageBps);
    expect(loadSettings().userRpcs['1']).toEqual([]);
  });

  test('useDefaultRpcs defaults to true and round trips', () => {
    expect(DEFAULT_SETTINGS.useDefaultRpcs).toBe(true);
    saveSettings({ ...DEFAULT_SETTINGS, useDefaultRpcs: false });
    expect(loadSettings().useDefaultRpcs).toBe(false);
    localStorage.setItem('copeybara.settings.v1', JSON.stringify({ useDefaultRpcs: 'no' }));
    expect(loadSettings().useDefaultRpcs).toBe(true);
  });

  test('rpcUrlsFor puts user endpoints first, then defaults unless disabled', () => {
    const s = { ...DEFAULT_SETTINGS, userRpcs: { '1': ['https://mine'] } };
    expect(rpcUrlsFor(s, 1, { '1': ['https://a', 'https://mine'] })).toEqual(['https://mine', 'https://a']);
    expect(rpcUrlsFor({ ...s, useDefaultRpcs: false }, 1, { '1': ['https://a'] })).toEqual(['https://mine']);
  });

  test('drillUrl accepts only localhost http URLs', () => {
    saveSettings({ ...DEFAULT_SETTINGS, drillUrl: 'http://localhost:8090' });
    expect(loadSettings().drillUrl).toBe('http://localhost:8090');
    localStorage.setItem('copeybara.settings.v1', JSON.stringify({ drillUrl: 'https://evil.example' }));
    expect(loadSettings().drillUrl).toBe('');
  });

  test('default ENS name is empty: it must come from the protocol docs, not the kit', () => {
    expect(DEFAULT_SETTINGS.ensName).toBe('');
  });
});

describe('settings from the URL (Attack Theater links)', () => {
  test('?ens= and ?drill= (localhost only) override the stored settings', async () => {
    const { settingsFromUrl } = await import('../src/settings');
    expect(settingsFromUrl('http://localhost:8000/?ens=demoswap-blackout.eth&drill=http%3A%2F%2Flocalhost%3A8090')).toEqual({ ensName: 'demoswap-blackout.eth', drillUrl: 'http://localhost:8090' });
    expect(settingsFromUrl('http://localhost:8000/?drill=https%3A%2F%2Fevil.example')).toEqual({});
    expect(settingsFromUrl('http://localhost:8000/')).toEqual({});
  });
});

describe('review #2: a protocol name from a link is never silent and never persisted', () => {
  test('URL ens differing from the saved one → used for this session, flagged, saved name untouched', async () => {
    const { mergeUrlSettings } = await import('../src/settings');
    const saved = { ...DEFAULT_SETTINGS, ensName: 'real-protocol.eth' };
    const r = mergeUrlSettings(saved, { ensName: 'evil.eth' });
    expect(r.settings.ensName).toBe('evil.eth');
    expect(r.ensFromLink).toBe('evil.eth');
    expect(r.persist.ensName).toBe('real-protocol.eth');
  });
  test('URL ens equal to the saved one → no flag', async () => {
    const { mergeUrlSettings } = await import('../src/settings');
    const r = mergeUrlSettings({ ...DEFAULT_SETTINGS, ensName: 'a.eth' }, { ensName: 'a.eth' });
    expect(r.ensFromLink).toBeNull();
  });
  test('drill URL (localhost only) is applied without a flag', async () => {
    const { mergeUrlSettings } = await import('../src/settings');
    const r = mergeUrlSettings(DEFAULT_SETTINGS, { drillUrl: 'http://localhost:8090' });
    expect(r.settings.drillUrl).toBe('http://localhost:8090');
    expect(r.ensFromLink).toBeNull();
  });
});
