import { describe, expect, test } from 'vitest';
import { getAddress } from 'viem';
import { KNOWN_CONTRACTS, PERMIT2_ADDRESS, knownContract } from '../src/known';

const ROLES = ['permit2', 'universalRouter', 'v3PositionManager', 'swapRouter02', 'v4PoolManager', 'v4PositionManager', 'v4StateView'];

describe('well-known contracts table', () => {
  test.each(['1', '11155111'])('Uniswap on chain %s lists every required role with a valid address', (chain) => {
    const u = KNOWN_CONTRACTS.protocols.Uniswap?.[chain] ?? {};
    for (const r of ROLES) expect(() => getAddress(u[r] ?? ''), r).not.toThrow();
  });
  test('Permit2 is the same address on both chains', () => {
    expect(knownContract(PERMIT2_ADDRESS, 1)?.role).toBe('permit2');
    expect(knownContract(PERMIT2_ADDRESS.toLowerCase(), 11155111)?.role).toBe('permit2');
  });
  test('lookup is per chain and case-insensitive', () => {
    const ur = knownContract('0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b', 11155111);
    expect(ur).toMatchObject({ protocol: 'Uniswap', role: 'universalRouter', name: 'Universal Router' });
    expect(knownContract('0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b', 1)).toBeUndefined();
    expect(knownContract('0xbadbadbadbadbadbadbadbadbadbadbadbadbad0', 1)).toBeUndefined();
    expect(knownContract('nope', 1)).toBeUndefined();
  });
  test('a custom table replaces the built-in one', () => {
    const t = { v: 1 as const, protocols: { X: { '5': { thing: '0x1111111111111111111111111111111111111111' } } } };
    expect(knownContract('0x1111111111111111111111111111111111111111', 5, t)?.protocol).toBe('X');
    expect(knownContract(PERMIT2_ADDRESS, 1, t)).toBeUndefined();
  });
});
