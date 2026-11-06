import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { concatHex, encodeFunctionData, getAddress, parseAbi, type Hex } from 'viem';
import { BANNED_SELECTORS, EXIT_SELECTORS, erc4626Kind, specExitSelector, type Address, type ExitSpec, type Manifest } from '@copeybara/core';
import { explain, guard, type GuardCtx } from '../src';
import { BANNED_CORPUS } from './corpus';
import { approveData, multicallData, USER } from './helpers';
import { MANIFEST, tx } from './manifest-fixture';

const RUNS = 10_000;
const VAULT: Address = '0x5555555555555555555555555555555555555555';
const KIND = erc4626Kind('Demo vault');
const SPEC: ExitSpec = { v: 1, kinds: { vault: KIND } };
const SPEC_MANIFEST: Manifest = {
  v: 1,
  chains: { ...MANIFEST.chains, '1': { ...MANIFEST.chains['1'], spec: { vault: { address: VAULT, selectors: [specExitSelector(KIND)] } } } },
};
const ctx: GuardCtx = { account: USER, chainId: 1, manifest: SPEC_MANIFEST, exitSpec: SPEC };
const vaultAbi = parseAbi(['function redeem(uint256 shares, address receiver, address owner) returns (uint256)', 'function withdraw(uint256,address,address)', 'function deposit(uint256,address)']);
const redeem = (shares: bigint, receiver: Address = USER, owner: Address = USER): Hex =>
  encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [shares, receiver, owner] });

const codes = (t: Parameters<typeof guard>[0], c = ctx) => guard(t, c).reasons.map((r) => r.code);

describe('declarative exit spec: Guard decoding', () => {
  test('a redeem paying the user, from the user, value 0, passes', () => {
    expect(guard(tx(VAULT, redeem(10n ** 18n)), ctx)).toEqual({ ok: true, reasons: [] });
  });

  // The acceptance cases: wrong recipient index, extra approve, value > 0, unknown action.
  const evil = getAddress('0xbadbadbadbadbadbadbadbadbadbadbadbadbad0');
  const cases: [string, Parameters<typeof guard>[0], string[]][] = [
    ['receiver (recipient index 1) is someone else', tx(VAULT, redeem(1n, evil)), ['RECIPIENT']],
    ['owner (self index 2) is someone else', tx(VAULT, redeem(1n, USER, evil)), ['RECIPIENT']],
    ['receiver and owner swapped to someone else', tx(VAULT, redeem(1n, evil, evil)), ['RECIPIENT', 'RECIPIENT']],
    ['extra approve to the vault', tx(VAULT, approveData(VAULT)), ['SELECTOR', 'BANNED']],
    ['approve wrapped in a multicall to the vault', tx(VAULT, multicallData([redeem(1n), approveData()])), ['DECODE']],
    ['value > 0', tx(VAULT, redeem(1n), { value: 1n }), ['VALUE']],
    ['unknown action: withdraw(uint256,address,address)', tx(VAULT, encodeFunctionData({ abi: vaultAbi, functionName: 'withdraw', args: [1n, USER, USER] })), ['DECODE']],
    ['unknown action: deposit', tx(VAULT, encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [1n, USER] })), ['DECODE']],
    ['trailing bytes after a valid redeem', tx(VAULT, concatHex([redeem(1n), '0xdeadbeef'])), ['DECODE']],
    ['truncated redeem', tx(VAULT, redeem(1n).slice(0, 74) as Hex), ['DECODE']],
    ['dirty high bits in an address word', tx(VAULT, (redeem(1n).slice(0, 74) + 'ff' + redeem(1n).slice(76)) as Hex), ['DECODE']],
    ['sent by someone else (the spec pays the receiver, so only the owner check catches this)', tx(VAULT, redeem(1n), { from: evil }), []],
    ['a redeem to a contract that is not in the manifest', tx(evil, redeem(1n)), ['DECODE']],
    ['the Aave withdraw selector sent to the vault', tx(VAULT, EXIT_SELECTORS['aave-v3'].pool[0]! + '0'.repeat(192) as Hex), ['DECODE']],
  ];
  test.each(cases)('%s', (_n, t, want) => {
    const r = guard(t, ctx);
    if (want.length === 0) {
      // The vault only moves the owner's shares, and the owner is pinned to the user: a third-party sender cannot use it.
      expect(r.ok).toBe(true);
      return;
    }
    expect(r.ok).toBe(false);
    for (const w of want) expect(codes(t)).toContain(w);
    expect(explain(r).length).toBeGreaterThan(0);
  });

  test('without the published spec, nothing sent to a spec contract passes', () => {
    const r = guard(tx(VAULT, redeem(1n)), { ...ctx, exitSpec: null });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]!.detail).toMatch(/no published exit description/);
  });

  test('a spec kind for another role does not unlock this contract', () => {
    const r = guard(tx(VAULT, redeem(1n)), { ...ctx, exitSpec: { v: 1, kinds: { other: KIND } } });
    expect(r.ok).toBe(false);
  });

  test('the whole existing banned corpus is still rejected with the spec in context', () => {
    expect(BANNED_CORPUS.filter((c) => guard(c.tx, ctx).ok).map((c) => c.name)).toEqual([]);
  });

  test('the banned corpus sent to the spec contract is rejected', () => {
    expect(BANNED_CORPUS.filter((c) => guard({ ...c.tx, to: VAULT }, ctx).ok).map((c) => c.name)).toEqual([]);
  });
});

const u256 = fc.bigInt({ min: 0n, max: 2n ** 256n - 1n });
const addr = fc.uint8Array({ minLength: 20, maxLength: 20 }).map((b) => getAddress(`0x${Buffer.from(b).toString('hex')}`) as Address);
const hex = (min: number, max: number) => fc.uint8Array({ minLength: min, maxLength: max }).map((b) => `0x${Buffer.from(b).toString('hex')}` as Hex);

describe('declarative exit spec: Guard properties (10,000 runs each)', () => {
  test('a redeem passes iff receiver, owner = user and value = 0', () => {
    fc.assert(
      fc.property(u256, fc.oneof(fc.constant(USER), addr), fc.oneof(fc.constant(USER), addr), fc.oneof(fc.constant(0n), u256), (shares, receiver, owner, value) => {
        const ok = guard(tx(VAULT, redeem(shares, receiver, owner), { value }), ctx).ok;
        const want = receiver.toLowerCase() === USER.toLowerCase() && owner.toLowerCase() === USER.toLowerCase() && value === 0n;
        return ok === want;
      }),
      { numRuns: RUNS },
    );
  });

  test('random calldata to the spec contract never passes unless it is a canonical redeem paying the user', () => {
    const sel = specExitSelector(KIND);
    fc.assert(
      fc.property(fc.oneof(hex(0, 200), hex(0, 96).map((b) => concatHex([sel, b])), hex(96, 96).map((b) => concatHex([sel, b]))), (data) => {
        const r = guard(tx(VAULT, data), ctx);
        if (!r.ok) return true;
        return data.toLowerCase() === redeem(BigInt(`0x${data.slice(10, 74)}`)).toLowerCase();
      }),
      { numRuns: RUNS },
    );
  });

  test('every banned selector with random arguments is rejected at the spec contract', () => {
    const banned = [...BANNED_SELECTORS];
    fc.assert(
      fc.property(fc.constantFrom(...banned), hex(0, 320), (sel, rest) => !guard(tx(VAULT, concatHex([sel, rest])), ctx).ok),
      { numRuns: RUNS },
    );
  });

  test('a valid redeem sent anywhere other than the vault, or on another chain, never passes', () => {
    fc.assert(
      fc.property(addr, fc.constantFrom(1, 10, 137, 11155111), u256, (to, chainId, shares) => {
        const r = guard(tx(to, redeem(shares), { chainId }), ctx);
        return to.toLowerCase() === VAULT.toLowerCase() && chainId === 1 ? r.ok : !r.ok;
      }),
      { numRuns: RUNS },
    );
  });
});
