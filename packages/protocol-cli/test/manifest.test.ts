import { describe, expect, test } from 'vitest';
import { EXIT_SELECTORS, erc4626Kind, parseExitSpec, parseManifest } from '@copeybara/core';
import { buildManifest, bytecodeHasSelector, canonicalFn } from '../src';
import { loaded, VAULT } from './helpers';

describe('copeybara manifest', () => {
  test('a spec vault with an ABI builds a manifest + exit spec the kit codecs accept', async () => {
    const b = await buildManifest(loaded());
    expect(b.problems).toEqual([]);
    expect(parseManifest(b.text).chains['11155111']!.spec!.vault).toEqual({ address: VAULT, selectors: ['0xba087652'] });
    expect(parseExitSpec(b.specText)).toEqual({ v: 1, kinds: { vault: erc4626Kind('Demo vault') } });
  });

  test('built-in adapters use their known exit selectors; no ABI needed', async () => {
    const b = await buildManifest(
      loaded({ exits: undefined, chains: { '1': { 'aave-v3': { pool: { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', functions: ['withdraw(address,uint256,address)'] } } } } }),
    );
    expect(b.problems).toEqual([]);
    expect(b.manifest.chains['1']!['aave-v3']!.pool!.selectors).toEqual([...EXIT_SELECTORS['aave-v3'].pool]);
  });

  const bad: [string, Parameters<typeof loaded>[0], RegExp][] = [
    ['a function missing from the ABI', { chains: { '1': { spec: { vault: { address: VAULT, functions: ['redeem(uint256,address,address)'], abi: 'Vault.json' } } } }, exits: { vault: { ...erc4626Kind('x'), exit: { ...erc4626Kind('x').exit, fn: 'withdraw(uint256,address,address)' } } } }, /not exits.vault.exit.fn|not in the ABI/],
    ['an approval', { chains: { '1': { spec: { vault: { address: VAULT, functions: ['approve(address,uint256)'], abi: 'Vault.json' } } } } }, /moves or approves tokens/],
    ['a non-canonical signature', { chains: { '1': { spec: { vault: { address: VAULT, functions: ['redeem(uint, address, address)'], abi: 'Vault.json' } } } } }, /canonical form/],
    ['a spec contract with no exit kind', { exits: undefined }, /no exit kind "vault"/],
    ['a spec contract with two functions', { chains: { '1': { spec: { vault: { address: VAULT, functions: ['redeem(uint256,address,address)', 'balanceOf(address)'], abi: 'Vault.json' } } } } }, /exactly one function/],
    ['a built-in adapter with a function the Guard cannot decode', { exits: undefined, chains: { '1': { 'aave-v3': { pool: { address: VAULT, functions: ['borrow(address,uint256,uint256,uint16,address)'] } } } } }, /Guard cannot check who/],
    ['an unknown protocol id', { exits: undefined, chains: { '1': { morpho: { m: { address: VAULT, functions: [] } } } as never } }, /unknown protocol/],
    ['an unknown role', { exits: undefined, chains: { '1': { 'aave-v3': { vaults: { address: VAULT, functions: [] } } } } }, /no role "vaults"/],
    ['a spec function without ABI or --onchain', { chains: { '1': { spec: { vault: { address: VAULT, functions: ['redeem(uint256,address,address)'] } } } } }, /--onchain/],
    ['a bad address', { chains: { '1': { spec: { vault: { address: '0x12' as never, functions: [] } } } } }, /invalid address/],
    ['a bad chain id', { chains: { mainnet: {} } as never }, /decimal integers/],
  ];
  test.each(bad)('refuses %s', async (_n, over, re) => {
    const b = await buildManifest(loaded(over));
    expect(b.problems.join('\n')).toMatch(re);
  });

  test('--onchain: the selector must be in the deployed bytecode', async () => {
    const l = loaded({ chains: { '1': { spec: { vault: { address: VAULT, functions: ['redeem(uint256,address,address)'] } } } } });
    expect((await buildManifest(l, { code: async () => '0x6363ba0876525f' })).problems).toEqual([]);
    expect((await buildManifest(l, { code: async () => '0x6300000000' })).problems.join()).toMatch(/not in the bytecode/);
    expect((await buildManifest(l, { code: async () => '0x' })).problems.join()).toMatch(/no contract deployed/);
  });

  test('helpers', () => {
    expect(canonicalFn('redeem(uint256 shares, address receiver, address owner)')).toBe('redeem(uint256,address,address)');
    expect(canonicalFn('nope(')).toBeNull();
    expect(bytecodeHasSelector('0x0063ba08765200', '0xba087652')).toBe(true);
  });
});
