import { describe, expect, test } from 'vitest';
import { explain, guard, type GuardReason } from '../src';
import { approveData, ATTACKER, aaveWithdrawData, collectData, curveRemoveData, decreaseData, multicallData, USER } from './helpers';
import { AAVE_POOL, CURVE_LP, CURVE_POOL, ctx1, ctxSepolia, NPM_MAINNET, NPM_SEPOLIA, tx } from './manifest-fixture';

const codes = (r: { reasons: GuardReason[] }) => r.reasons.map((x) => x.code);
const uniExit = multicallData([decreaseData(), collectData(USER)]);

describe('guard accepts real exits', () => {
  test('uniswap multicall exit on mainnet', () => {
    expect(guard(tx(NPM_MAINNET, uniExit), ctx1)).toEqual({ ok: true, reasons: [] });
  });
  test('uniswap exit on sepolia', () => {
    expect(guard(tx(NPM_SEPOLIA, uniExit, { chainId: 11155111 }), ctxSepolia).ok).toBe(true);
  });
  test('collect-only exit', () => {
    expect(guard(tx(NPM_MAINNET, collectData(USER)), ctx1).ok).toBe(true);
  });
  test('aave withdraw to self', () => {
    expect(guard(tx(AAVE_POOL, aaveWithdrawData(USER)), ctx1).ok).toBe(true);
  });
  test('curve remove_liquidity from self', () => {
    expect(guard(tx(CURVE_POOL, curveRemoveData()), ctx1).ok).toBe(true);
  });
  test('recipient comparison is case-insensitive', () => {
    expect(guard(tx(NPM_MAINNET, uniExit), { ...ctx1, account: USER.toLowerCase() as `0x${string}` }).ok).toBe(true);
  });
});

describe('guard rejects, one rule at a time', () => {
  test('CHAIN: chain not in manifest', () => {
    const r = guard(tx(NPM_MAINNET, uniExit, { chainId: 10 }), { ...ctx1, chainId: 10 });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('CHAIN');
  });
  test('CHAIN: tx chain differs from connected chain', () => {
    expect(codes(guard(tx(NPM_MAINNET, uniExit, { chainId: 11155111 }), ctx1))).toContain('CHAIN');
  });
  test('TARGET: address not in manifest', () => {
    expect(codes(guard(tx(ATTACKER, uniExit), ctx1))).toContain('TARGET');
  });
  test('TARGET: read-only manifest entry cannot be called', () => {
    expect(codes(guard(tx(CURVE_LP, curveRemoveData()), ctx1))).toContain('TARGET');
  });
  test('SELECTOR: exit selector sent to the wrong target', () => {
    expect(codes(guard(tx(AAVE_POOL, curveRemoveData()), ctx1))).toContain('SELECTOR');
  });
  test('SELECTOR: nested selector not allowed on target', () => {
    const r = guard(tx(NPM_MAINNET, multicallData([decreaseData(), aaveWithdrawData(USER)])), ctx1);
    expect(codes(r)).toContain('SELECTOR');
  });
  test('RECIPIENT: collect to attacker', () => {
    const r = guard(tx(NPM_MAINNET, multicallData([decreaseData(), collectData(ATTACKER)])), ctx1);
    expect(codes(r)).toEqual(['RECIPIENT']);
  });
  test('RECIPIENT: aave withdraw to attacker', () => {
    expect(codes(guard(tx(AAVE_POOL, aaveWithdrawData(ATTACKER)), ctx1))).toEqual(['RECIPIENT']);
  });
  test('CALLER: curve exit sent from another account', () => {
    expect(codes(guard(tx(CURVE_POOL, curveRemoveData(), { from: ATTACKER }), ctx1))).toContain('CALLER');
  });
  test('BANNED: approve on a token', () => {
    const r = guard(tx('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', approveData()), ctx1);
    expect(codes(r)).toEqual(expect.arrayContaining(['TARGET', 'BANNED']));
  });
  test('BANNED: hidden approve inside a valid multicall', () => {
    const r = guard(tx(NPM_MAINNET, multicallData([decreaseData(), collectData(USER), approveData()])), ctx1);
    expect(codes(r)).toEqual(expect.arrayContaining(['SELECTOR', 'BANNED']));
  });
  test('VALUE: ETH attached', () => {
    expect(codes(guard(tx(NPM_MAINNET, uniExit, { value: 1n }), ctx1))).toEqual(['VALUE']);
  });
  test('DECODE: garbage calldata yields a single DECODE reason', () => {
    const r = guard(tx(NPM_MAINNET, '0xdeadbeef'), ctx1);
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['DECODE']);
  });
});

describe('explain', () => {
  test('names the approval and the spender', () => {
    const s = explain(guard(tx('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', approveData(ATTACKER)), ctx1)).join(' ');
    expect(s).toMatch(/approve/);
    expect(s).toMatch(/Exits never need approvals/);
    expect(s).toContain(ATTACKER.slice(0, 6));
  });
  test('names the foreign recipient', () => {
    const s = explain(guard(tx(AAVE_POOL, aaveWithdrawData(ATTACKER)), ctx1)).join(' ');
    expect(s).toMatch(/not your connected account/);
  });
  test('safe exit explains itself', () => {
    expect(explain(guard(tx(NPM_MAINNET, uniExit), ctx1))[0]).toMatch(/safe exit/i);
  });
});
