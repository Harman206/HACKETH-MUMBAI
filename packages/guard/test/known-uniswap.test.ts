/**
 * Permit2 phishing protection without false alarms.
 * The real Uniswap app's normal flow (ERC-20 approve to Permit2, then a Permit2 PermitSingle / PermitBatch signature
 * for the Universal Router or the v4 PositionManager) must classify as 'known'. The same request with the spender
 * swapped for an attacker must stay 'dangerous'.
 */
import { describe, expect, test } from 'vitest';
import { encodeFunctionData, parseAbi, toHex, type Hex } from 'viem';
import { KNOWN_CONTRACTS, SIGS, type Address, type KnownTable } from '@copeybara/core';
import { classifyRequest, type ClassifyCtx } from '../src/classify';
import { ATTACKER, USER, approveData } from './helpers';
import { AAVE_POOL, CURVE_POOL, MANIFEST } from './manifest-fixture';

const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const UR: Record<number, Address> = { 1: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', 11155111: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b' };
const POSM: Record<number, Address> = { 1: '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e', 11155111: '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4' };
const ROUTER02: Record<number, Address> = { 1: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', 11155111: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E' };
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const MAX160 = (2n ** 160n - 1n).toString();

/** No followed protocols: the user only uses the Uniswap app. */
const bare = (chainId: number): ClassifyCtx => ({ account: USER, chainId, manifests: [] });
const followed = (chainId: number): ClassifyCtx => ({ account: USER, chainId, manifests: [{ name: 'demoswap-blackout.eth', manifest: MANIFEST }] });

const send = (to: Address, data: Hex, value: Hex = '0x0') => ({ method: 'eth_sendTransaction', params: [{ from: USER, to, data, value }] });
const typed = (td: unknown) => ({ method: 'eth_signTypedData_v4', params: [USER, JSON.stringify(td)] });

const PERMIT_DETAILS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint160' },
  { name: 'expiration', type: 'uint48' },
  { name: 'nonce', type: 'uint48' },
];
const EIP712_DOMAIN = [
  { name: 'name', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];
/** Shaped like the Uniswap interface's swap approval signature (PermitSingle, spender = Universal Router). */
const permitSingle = (chainId: number, spender: Address, verifyingContract: Address = PERMIT2) => ({
  types: { EIP712Domain: EIP712_DOMAIN, PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }], PermitDetails: PERMIT_DETAILS },
  domain: { name: 'Permit2', chainId, verifyingContract },
  primaryType: 'PermitSingle',
  message: { details: { token: USDC, amount: MAX160, expiration: '1765000000', nonce: '0' }, spender, sigDeadline: '1762500000' },
});
/** Shaped like the v4 "add liquidity" signature (PermitBatch, spender = v4 PositionManager). */
const permitBatch = (chainId: number, spender: Address) => ({
  types: { EIP712Domain: EIP712_DOMAIN, PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }], PermitDetails: PERMIT_DETAILS },
  domain: { name: 'Permit2', chainId, verifyingContract: PERMIT2 },
  primaryType: 'PermitBatch',
  message: {
    details: [
      { token: USDC, amount: MAX160, expiration: '1765000000', nonce: '0' },
      { token: WETH, amount: MAX160, expiration: '1765000000', nonce: '0' },
    ],
    spender,
    sigDeadline: '1762500000',
  },
});

const p2 = parseAbi([`function ${SIGS.banned[11]}`, `function ${SIGS.banned[12]}`, 'function approve(address,address,uint160,uint48)']);
const permitSingleCall = (spender: Address): Hex =>
  encodeFunctionData({ abi: p2, functionName: 'permit', args: [USER, [[USDC, 2n ** 160n - 1n, 1765000000, 0], spender, 1762500000n], '0x1234'] });
const permitBatchCall = (spender: Address): Hex =>
  encodeFunctionData({ abi: p2, functionName: 'permit', args: [USER, [[[USDC, 2n ** 160n - 1n, 1765000000, 0]], spender, 1762500000n], '0x1234'] });
const permit2Approve = (spender: Address): Hex => encodeFunctionData({ abi: p2, functionName: 'approve', args: [USDC, spender, 2n ** 160n - 1n, 1765000000] });

describe.each([1, 11155111])('real Uniswap flow on chain %i → known, not a drainer', (chainId) => {
  for (const [label, ctx] of [['no followed protocols', bare(chainId)], ['following DemoSwap', followed(chainId)]] as const) {
    describe(label, () => {
      test('step 1: unlimited ERC-20 approve to Permit2', () => {
        const r = classifyRequest(send(USDC, approveData(PERMIT2)), ctx);
        expect(r.verdict).toBe('known');
        expect(r.protocol).toBe('Uniswap');
        expect(r.counterparty).toBe(PERMIT2);
        expect(r.reasons.join(' ')).toMatch(/^Standard Uniswap flow/);
      });
      test('step 2: Permit2 PermitSingle signature for the Universal Router', () => {
        const r = classifyRequest(typed(permitSingle(chainId, UR[chainId]!)), { ...ctx, chainId });
        expect(r.verdict).toBe('known');
        expect(r.protocol).toBe('Uniswap');
        expect(r.reasons[0]).toBe("Standard Uniswap flow: lets Uniswap's Universal Router spend this token through Permit2.");
      });
      test('v4 add liquidity: Permit2 PermitBatch signature for the v4 PositionManager', () => {
        const r = classifyRequest(typed(permitBatch(chainId, POSM[chainId]!)), ctx);
        expect(r.verdict).toBe('known');
        expect(r.reasons[0]).toMatch(/v4 Position Manager/);
      });
      test('Permit2 permit / approve sent as a transaction to Permit2, spender = Universal Router', () => {
        for (const data of [permitSingleCall(UR[chainId]!), permitBatchCall(UR[chainId]!), permit2Approve(UR[chainId]!)]) {
          const r = classifyRequest(send(PERMIT2, data), ctx);
          expect(r.verdict, data.slice(0, 10)).toBe('known');
          expect(r.counterparty?.toLowerCase()).toBe(UR[chainId]!.toLowerCase());
        }
      });
      test('legacy v3 flow: unlimited approve to SwapRouter02 → known', () => {
        expect(classifyRequest(send(USDC, approveData(ROUTER02[chainId]!)), ctx).verdict).toBe('known');
      });
      test('a swap call to the Universal Router (with ETH) → known, not "ETH to a stranger"', () => {
        const r = classifyRequest(send(UR[chainId]!, `0x3593564c${'00'.repeat(64)}`, toHex(10n ** 17n)), ctx);
        expect(r.verdict).toBe('known');
        expect(r.protocol).toBe('Uniswap');
      });
    });
  }
});

describe.each([1, 11155111])('same requests with the spender swapped to an attacker on chain %i → dangerous', (chainId) => {
  const ctx = bare(chainId);
  test('Permit2 PermitSingle / PermitBatch signatures', () => {
    for (const td of [permitSingle(chainId, ATTACKER), permitBatch(chainId, ATTACKER)]) {
      const r = classifyRequest(typed(td), ctx);
      expect(r.verdict).toBe('dangerous');
      expect(r.counterparty).toBe(ATTACKER);
      expect(r.reasons[0]).toMatch(/^A Permit2 signature for a spender that is not Uniswap: the most common way Uniswap users are drained/);
    }
  });
  test('Permit2 permit / approve transactions', () => {
    for (const data of [permitSingleCall(ATTACKER), permitBatchCall(ATTACKER), permit2Approve(ATTACKER)]) {
      const r = classifyRequest(send(PERMIT2, data), ctx);
      expect(r.verdict, data.slice(0, 10)).toBe('dangerous');
      expect(r.counterparty).toBe(ATTACKER);
    }
  });
  test('ERC-20 approve to the attacker', () => {
    expect(classifyRequest(send(USDC, approveData(ATTACKER)), ctx).verdict).toBe('dangerous');
  });
});

describe('look-alikes do not borrow Uniswap trust', () => {
  test('domain says "Permit2" but verifyingContract is not Permit2 → dangerous', () => {
    expect(classifyRequest(typed(permitSingle(1, UR[1]!, ATTACKER)), bare(1)).verdict).toBe('dangerous');
  });
  test('a Sepolia Universal Router address signed for mainnet is not a known spender there', () => {
    expect(classifyRequest(typed(permitSingle(1, UR[11155111]!)), bare(1)).verdict).toBe('dangerous');
  });
  test('the signature domain chain wins over the wallet chain', () => {
    expect(classifyRequest(typed(permitSingle(11155111, UR[11155111]!)), bare(1)).verdict).toBe('known');
  });
  test('a Permit2 permit calldata sent to some other contract than Permit2 → not known', () => {
    expect(classifyRequest(send(ATTACKER, permitSingleCall(UR[1]!)), bare(1)).verdict).toBe('dangerous');
  });
  test('approve(Permit2) inside a batch with an attacker approve: the batch is dangerous', () => {
    const r = classifyRequest({ method: 'wallet_sendCalls', params: [{ chainId: '0x1', calls: [{ to: USDC, data: approveData(PERMIT2) }, { to: USDC, data: approveData(ATTACKER) }] }] }, bare(1));
    expect(r.verdict).toBe('dangerous');
  });
});

describe('ClassifyCtx.known', () => {
  test('defaults to the built-in table; an empty table restores the strict behaviour', () => {
    const empty: KnownTable = { v: 1, protocols: {} };
    expect(classifyRequest(typed(permitSingle(1, UR[1]!)), { ...bare(1), known: KNOWN_CONTRACTS }).verdict).toBe('known');
    expect(classifyRequest(typed(permitSingle(1, UR[1]!)), { ...bare(1), known: empty }).verdict).toBe('dangerous');
    expect(classifyRequest(send(USDC, approveData(PERMIT2)), { ...bare(1), known: empty }).verdict).toBe('dangerous');
  });
  test('a followed contract that is not in the table keeps the old answer (standing permission → risky)', () => {
    expect(classifyRequest(send(USDC, approveData(CURVE_POOL)), followed(1)).verdict).toBe('risky');
  });
  test('a followed contract that is also in the table (Aave v3 Pool) → known, named by the table', () => {
    const r = classifyRequest(send(USDC, approveData(AAVE_POOL)), followed(1));
    expect(r).toMatchObject({ verdict: 'known', protocol: 'Aave' });
  });
});
