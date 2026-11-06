import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { encodeFunctionData, parseAbi, toHex, type Hex } from 'viem';
import type { Address } from '@copeybara/core';
import { classifyRequest, worstVerdict, type ClassifyCtx } from '../src/classify';
import { ATTACKER, USER, approveData, collectData, decreaseData, multicallData } from './helpers';
import { CURVE_POOL, MANIFEST, NPM_SEPOLIA, POSM_SEPOLIA } from './manifest-fixture';

const ctx: ClassifyCtx = { account: USER, chainId: 11155111, manifests: [{ name: 'demoswap-blackout.eth', manifest: MANIFEST }] };
const TOKEN: Address = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const erc = parseAbi([
  'function transfer(address,uint256)',
  'function setApprovalForAll(address,bool)',
  'function increaseAllowance(address,uint256)',
  'function deposit()',
]);
const send = (to: Address | undefined, data: Hex = '0x', value: Hex = '0x0') => ({
  method: 'eth_sendTransaction',
  params: [{ from: USER, ...(to ? { to } : {}), data, value }],
});
const typed = (td: unknown, asString = true) => ({ method: 'eth_signTypedData_v4', params: [USER, asString ? JSON.stringify(td) : td] });

describe('unwatched methods pass untouched', () => {
  test.each(['eth_requestAccounts', 'eth_chainId', 'eth_call', 'wallet_switchEthereumChain', 'eth_getBalance'])('%s', (method) => {
    expect(classifyRequest({ method, params: [] }, ctx).verdict).toBe('pass');
  });
});

describe('eth_sendTransaction', () => {
  test('a Copeybara exit (Guard passes) → exit', () => {
    const r = classifyRequest(send(NPM_SEPOLIA, multicallData([decreaseData(), collectData()])), ctx);
    expect(r.verdict).toBe('exit');
    expect(r.protocol).toBe('demoswap-blackout.eth');
  });
  test('the DemoSwap hijack: unlimited approve to the drainer → dangerous, naming the spender', () => {
    const r = classifyRequest(send(TOKEN, approveData(ATTACKER)), ctx);
    expect(r.verdict).toBe('dangerous');
    expect(r.reasons.join(' ')).toMatch(/ALL of this token/);
    expect(r.counterparty).toBe(ATTACKER);
  });
  test('approve to a followed protocol contract → risky (known spender, still a standing permission)', () => {
    const r = classifyRequest(send(TOKEN, approveData(CURVE_POOL)), { ...ctx, chainId: 1 });
    expect(r.verdict).toBe('risky');
    expect(r.reasons.join(' ')).toMatch(/demoswap-blackout\.eth/);
  });
  test('setApprovalForAll / increaseAllowance to a stranger → dangerous; a plain transfer to a stranger → risky (asks)', () => {
    for (const data of [
      encodeFunctionData({ abi: erc, functionName: 'setApprovalForAll', args: [ATTACKER, true] }),
      encodeFunctionData({ abi: erc, functionName: 'increaseAllowance', args: [ATTACKER, 5n] }),
    ]) expect(classifyRequest(send(TOKEN, data), ctx).verdict).toBe('dangerous');
    expect(classifyRequest(send(TOKEN, encodeFunctionData({ abi: erc, functionName: 'transfer', args: [ATTACKER, 5n] })), ctx).verdict).toBe('risky');
  });
  test('a non-exit call to a followed protocol contract → known', () => {
    const r = classifyRequest(send(NPM_SEPOLIA, collectData(ATTACKER)), ctx);
    expect(r.verdict).toBe('known');
  });
  test('an unknown contract call with no value → unknown (no prompt by itself)', () => {
    expect(classifyRequest(send(TOKEN, encodeFunctionData({ abi: erc, functionName: 'deposit' })), ctx).verdict).toBe('unknown');
  });
  test('ETH value to an address no followed protocol lists → risky', () => {
    expect(classifyRequest(send(ATTACKER, '0x', toHex(10n ** 18n)), ctx).verdict).toBe('risky');
  });
  test('contract creation (no "to") → risky', () => {
    expect(classifyRequest(send(undefined, '0x6080'), ctx).verdict).toBe('risky');
  });
  test('malformed params → risky with "could not be read"', () => {
    const r = classifyRequest({ method: 'eth_sendTransaction', params: ['nope'] }, ctx);
    expect(r.verdict).toBe('risky');
    expect(r.reasons.join(' ')).toMatch(/could not be read/);
  });
  test('no account connected yet → still classified (exit needs the account)', () => {
    const r = classifyRequest(send(TOKEN, approveData(ATTACKER)), { ...ctx, account: null });
    expect(r.verdict).toBe('dangerous');
  });
});

describe('signatures', () => {
  test('eth_sign → dangerous', () => {
    expect(classifyRequest({ method: 'eth_sign', params: [USER, '0x' + 'ab'.repeat(32)] }, ctx).verdict).toBe('dangerous');
  });
  test('personal_sign of readable text → pass; of a bare 32-byte hash → dangerous', () => {
    expect(classifyRequest({ method: 'personal_sign', params: [toHex('Sign in to DemoSwap'), USER] }, ctx).verdict).toBe('pass');
    expect(classifyRequest({ method: 'personal_sign', params: ['0x' + '9f'.repeat(32), USER] }, ctx).verdict).toBe('dangerous');
  });
  const permit = (spender: Address) => ({
    domain: { name: 'DemoUSD', version: '1', chainId: 11155111, verifyingContract: TOKEN },
    primaryType: 'Permit',
    types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    message: { owner: USER, spender, value: (2n ** 256n - 1n).toString(), nonce: '0', deadline: '9999999999' },
  });
  test('EIP-2612 permit to a stranger → dangerous (typed data as string or object)', () => {
    expect(classifyRequest(typed(permit(ATTACKER)), ctx).verdict).toBe('dangerous');
    expect(classifyRequest(typed(permit(ATTACKER), false), ctx).verdict).toBe('dangerous');
  });
  test('EIP-2612 permit to a followed protocol contract → risky', () => {
    expect(classifyRequest(typed(permit(CURVE_POOL)), { ...ctx, chainId: 1 }).verdict).toBe('risky');
  });
  test('approve / permit to a well-known Uniswap contract → known, even when a followed manifest lists it too', () => {
    expect(classifyRequest(send(TOKEN, approveData(NPM_SEPOLIA)), ctx).verdict).toBe('known');
    expect(classifyRequest(typed(permit(POSM_SEPOLIA)), ctx).verdict).toBe('known');
  });
  test('Permit2 PermitSingle / PermitBatch / PermitTransferFrom to a stranger → dangerous', () => {
    const domain = { name: 'Permit2', chainId: 11155111, verifyingContract: PERMIT2 };
    for (const primaryType of ['PermitSingle', 'PermitBatch', 'PermitTransferFrom', 'PermitBatchTransferFrom', 'PermitWitnessTransferFrom']) {
      const r = classifyRequest(typed({ domain, primaryType, types: {}, message: { spender: ATTACKER } }), ctx);
      expect(r.verdict, primaryType).toBe('dangerous');
    }
  });
  test('unknown typed data → unknown; unreadable typed data → risky', () => {
    expect(classifyRequest(typed({ domain: { name: 'Mail' }, primaryType: 'Mail', types: {}, message: { body: 'hi' } }), ctx).verdict).toBe('unknown');
    expect(classifyRequest({ method: 'eth_signTypedData_v4', params: [USER, '{nope'] }, ctx).verdict).toBe('risky');
  });
  test('a marketplace order (Seaport OrderComponents) → risky', () => {
    expect(classifyRequest(typed({ domain: { name: 'Seaport' }, primaryType: 'OrderComponents', types: {}, message: {} }), ctx).verdict).toBe('risky');
  });
});

describe('wallet_sendCalls (EIP-5792 batches): the worst call wins', () => {
  test('an exit plus a drainer approve → dangerous', () => {
    const r = classifyRequest(
      { method: 'wallet_sendCalls', params: [{ from: USER, chainId: '0xaa36a7', calls: [{ to: NPM_SEPOLIA, data: multicallData([decreaseData(), collectData()]) }, { to: TOKEN, data: approveData(ATTACKER) }] }] },
      ctx,
    );
    expect(r.verdict).toBe('dangerous');
  });
  test('worstVerdict order', () => {
    expect(worstVerdict(['pass', 'exit', 'known', 'unknown', 'risky'])).toBe('risky');
    expect(worstVerdict([])).toBe('pass');
  });
});

describe('property: nothing is ever "exit" unless the Exit Guard accepts it', () => {
  test('random calldata to the position manager', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 200 }), (bytes) => {
        const r = classifyRequest(send(NPM_SEPOLIA, toHex(bytes)), ctx);
        return r.verdict !== 'exit';
      }),
      { numRuns: 300 },
    );
  });
});
