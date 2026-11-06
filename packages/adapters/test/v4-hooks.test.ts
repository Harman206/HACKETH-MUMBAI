import { describe, expect, test } from 'vitest';
import { getAddress, pad, toHex } from 'viem';
import { HOOK_FLAGS, hookBadges, hookFlags } from '../src/v4-math';

/** A hook address whose low 14 bits are `flags` (Hooks.sol: permissions live in the address itself). */
const hookAt = (flags: number, high = 0x12n) => getAddress(pad(toHex((high << 152n) | BigInt(flags)), { size: 20 }));
const ZERO = '0x0000000000000000000000000000000000000000';
const WITHDRAW = "This pool's hook runs when you withdraw and can block or delay exits";
const DELTA = "This pool's hook can change how much you receive when you withdraw";

describe('v4 hook permission bits (v4-core Hooks.sol)', () => {
  test('bit layout matches Hooks.sol: BEFORE_INITIALIZE = 1<<13 … AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA = 1<<0', () => {
    expect(HOOK_FLAGS).toEqual({
      BEFORE_INITIALIZE: 1 << 13,
      AFTER_INITIALIZE: 1 << 12,
      BEFORE_ADD_LIQUIDITY: 1 << 11,
      AFTER_ADD_LIQUIDITY: 1 << 10,
      BEFORE_REMOVE_LIQUIDITY: 1 << 9,
      AFTER_REMOVE_LIQUIDITY: 1 << 8,
      BEFORE_SWAP: 1 << 7,
      AFTER_SWAP: 1 << 6,
      BEFORE_DONATE: 1 << 5,
      AFTER_DONATE: 1 << 4,
      BEFORE_SWAP_RETURNS_DELTA: 1 << 3,
      AFTER_SWAP_RETURNS_DELTA: 1 << 2,
      AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1 << 1,
      AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 1 << 0,
    });
  });
  test('flags are read from the low 14 bits only', () => {
    expect(hookFlags(hookAt(0))).toEqual([]);
    expect(hookFlags(hookAt(0x3fff)).length).toBe(14);
    expect(hookFlags(hookAt(1 << 9))).toEqual(['BEFORE_REMOVE_LIQUIDITY']);
    expect(hookFlags(getAddress('0xffffffffffffffffffffffffffffffffffffc000'))).toEqual([]); // bit 14 and up are not flags
  });
});

describe('hook badges', () => {
  test('no hook → none', () => {
    expect(hookBadges(ZERO)).toEqual([]);
  });
  test('a hook with only swap / add flags → one info badge with the short address', () => {
    const h = hookAt(HOOK_FLAGS.BEFORE_SWAP | HOOK_FLAGS.AFTER_SWAP | HOOK_FLAGS.BEFORE_ADD_LIQUIDITY);
    expect(hookBadges(h)).toEqual([{ tone: 'info', text: `Hook ${h.slice(0, 6)}…${h.slice(-4)}` }]);
  });
  test('a hook with no flags at all still gets the info badge (it is still a contract in the pool key)', () => {
    expect(hookBadges(hookAt(0))).toEqual([{ tone: 'info', text: 'Hook 0x1200…0000' }]);
  });
  test.each([
    ['BEFORE_REMOVE_LIQUIDITY', HOOK_FLAGS.BEFORE_REMOVE_LIQUIDITY, [WITHDRAW]],
    ['AFTER_REMOVE_LIQUIDITY', HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY, [WITHDRAW]],
    ['both remove hooks (one warning, not two)', HOOK_FLAGS.BEFORE_REMOVE_LIQUIDITY | HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY, [WITHDRAW]],
    ['AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA', HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY | HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA, [WITHDRAW, DELTA]],
    ['RETURNS_DELTA bit alone (not a valid hook, still warned)', HOOK_FLAGS.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA, [DELTA]],
    ['add-liquidity delta does not touch withdrawals', HOOK_FLAGS.AFTER_ADD_LIQUIDITY | HOOK_FLAGS.AFTER_ADD_LIQUIDITY_RETURNS_DELTA, []],
  ])('%s', (_n, flags, warns) => {
    const b = hookBadges(hookAt(flags));
    expect(b[0]!.tone).toBe('info');
    expect(b.slice(1)).toEqual(warns.map((text) => ({ tone: 'warn', text })));
  });
  test('exhaustive over all 2^14 flag sets: a warn badge appears exactly when a remove-liquidity bit (9, 8 or 0) is set', () => {
    for (let flags = 0; flags <= 0x3fff; flags++) {
      const warns = hookBadges(hookAt(flags)).filter((b) => b.tone === 'warn').length;
      expect(warns, flags.toString(16)).toBe((flags & 0x300 ? 1 : 0) + (flags & 0x1 ? 1 : 0));
    }
  });
});
