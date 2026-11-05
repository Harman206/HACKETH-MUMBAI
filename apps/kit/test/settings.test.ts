// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings';
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
    localStorage.setItem('blackout.settings.v1', '{nope');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test('round trip, and invalid fields fall back to defaults', () => {
    saveSettings({ ...DEFAULT_SETTINGS, ensName: 'demoswap-blackout.eth', userRpcs: { '11155111': ['https://my.rpc'] } });
    expect(loadSettings().ensName).toBe('demoswap-blackout.eth');
    expect(loadSettings().userRpcs['11155111']).toEqual(['https://my.rpc']);
    localStorage.setItem('blackout.settings.v1', JSON.stringify({ slippageBps: 99999, userRpcs: { '1': ['javascript:alert(1)'] } }));
    expect(loadSettings().slippageBps).toBe(DEFAULT_SETTINGS.slippageBps);
    expect(loadSettings().userRpcs['1']).toEqual([]);
  });

  test('default ENS name is empty: it must come from the protocol docs, not the kit', () => {
    expect(DEFAULT_SETTINGS.ensName).toBe('');
  });
});
