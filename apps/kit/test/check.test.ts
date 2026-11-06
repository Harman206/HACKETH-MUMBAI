import { describe, expect, test } from 'vitest';
import { encodeFunctionData, maxUint128, maxUint256, parseAbi } from 'viem';
import { EXIT_SELECTORS, npmAbi, type Address, type Manifest } from '@copeybara/core';
import { checkPasted, checkPastedText, parsePasted } from '../src/check';

const USER: Address = '0x1111111111111111111111111111111111111111';
const ATTACKER: Address = '0x9999999999999999999999999999999999999999';
const NPM: Address = '0x1238536071E1c677A632429e3655c799b22cDA52';
const USDC: Address = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
const manifest: Manifest = {
  v: 1,
  chains: { '11155111': { 'uniswap-v3': { positionManager: { address: NPM, selectors: [...EXIT_SELECTORS['uniswap-v3'].positionManager] } } } },
};
const ctx = { account: USER, chainId: 11155111, manifest };
const approve = encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [ATTACKER, maxUint256] });
const exit = encodeFunctionData({
  abi: npmAbi,
  functionName: 'multicall',
  args: [[
    encodeFunctionData({ abi: npmAbi, functionName: 'decreaseLiquidity', args: [{ tokenId: 1n, liquidity: 5n, amount0Min: 0n, amount1Min: 0n, deadline: 9n }] }),
    encodeFunctionData({ abi: npmAbi, functionName: 'collect', args: [{ tokenId: 1n, recipient: USER, amount0Max: maxUint128, amount1Max: maxUint128 }] }),
  ]],
});

describe('checkPasted', () => {
  test('a hijacked site asking approve(attacker, max) is blocked and says why', () => {
    const r = checkPasted({ to: USDC, data: approve, chainId: 11155111 }, ctx);
    expect(r.verdict).toBe('blocked');
    expect(r.sentences.join(' ')).toMatch(/approve/);
    expect(r.sentences.join(' ')).toMatch(/0x9999…9999/);
  });

  test('a valid Uniswap exit is a safe exit', () => {
    expect(checkPasted({ to: NPM, data: exit, chainId: 11155111 }, ctx).verdict).toBe('safe-exit');
  });

  test('garbage hex is blocked: could not be decoded', () => {
    const r = checkPasted({ to: NPM, data: '0xzz', chainId: 11155111 }, ctx);
    expect(r.verdict).toBe('blocked');
    expect(r.sentences.join(' ')).toMatch(/could not be decoded/);
  });

  test('an invalid "to" address is blocked, not a crash', () => {
    expect(checkPasted({ to: 'nope', data: exit, chainId: 11155111 }, ctx).verdict).toBe('blocked');
  });

  test('value in hex or decimal is honoured', () => {
    expect(checkPasted({ to: NPM, data: exit, value: '0x1', chainId: 11155111 }, ctx).verdict).toBe('blocked');
    expect(checkPasted({ to: NPM, data: exit, value: '0', chainId: 11155111 }, ctx).verdict).toBe('safe-exit');
  });
});

describe('parsePasted', () => {
  test('accepts wallet-style JSON params, including an array wrapper', () => {
    const j = JSON.stringify([{ from: USER, to: USDC, data: approve, value: '0x0' }]);
    expect(parsePasted(j)).toEqual({ from: USER, to: USDC, data: approve, value: '0x0' });
  });
  test('accepts `input` as an alias for data', () => {
    expect(parsePasted(JSON.stringify({ to: USDC, input: approve })).data).toBe(approve);
  });
  test('raw hex is treated as data only', () => {
    expect(parsePasted(`  ${approve}  `)).toEqual({ data: approve });
  });
});

describe('review C1: the pasted transaction must never choose whose account is checked', () => {
  const collectTo = (r: Address) =>
    encodeFunctionData({ abi: npmAbi, functionName: 'collect', args: [{ tokenId: 1n, recipient: r, amount0Max: maxUint128, amount1Max: maxUint128 }] });

  test('pasted from = attacker, collect pays attacker, user address given → blocked', () => {
    const r = checkPasted({ to: NPM, data: collectTo(ATTACKER), from: ATTACKER, chainId: 11155111 }, ctx);
    expect(r.verdict).toBe('blocked');
    expect(r.sentences.join(' ')).toMatch(/not your (connected )?(account|address)/);
  });

  test('no user address entered → blocked, asks for it (never falls back to pasted from)', () => {
    const r = checkPastedText({ text: JSON.stringify({ from: ATTACKER, to: NPM, data: collectTo(ATTACKER) }), to: '', account: '', chainId: 11155111, manifest });
    expect(r.verdict).toBe('blocked');
    expect(r.sentences.join(' ')).toMatch(/Enter your address/);
  });

  test('safe exit only when recipient = the address the user typed', () => {
    const r = checkPastedText({ text: JSON.stringify({ to: NPM, data: collectTo(USER) }), to: '', account: USER, chainId: 11155111, manifest });
    expect(r.verdict).toBe('safe-exit');
  });
});

describe('A6: chain comes from the pasted transaction when present', () => {
  test('pasted chainId 0x1 is checked against chain 1 (not listed here) → blocked', () => {
    const exit1 = JSON.stringify({ chainId: '0x1', to: NPM, data: encodeFunctionData({ abi: npmAbi, functionName: 'collect', args: [{ tokenId: 1n, recipient: USER, amount0Max: maxUint128, amount1Max: maxUint128 }] }) });
    const r = checkPastedText({ text: exit1, to: '', account: USER, chainId: 11155111, manifest });
    expect(r.verdict).toBe('blocked');
    expect(r.sentences.join(' ')).toMatch(/chain 1/);
  });
});

describe('C3: ?check= prefill', () => {
  test('decodes a base64url JSON request from the URL', async () => {
    const { prefillFromUrl } = await import('../src/check');
    const req = { to: NPM, data: '0x095ea7b3', value: '0x0' };
    const b64 = Buffer.from(JSON.stringify(req)).toString('base64url');
    expect(prefillFromUrl(`http://localhost:8000/?check=${b64}`)).toBe(JSON.stringify(req, null, 2));
    expect(prefillFromUrl('http://localhost:8000/')).toBeNull();
    expect(prefillFromUrl('http://localhost:8000/?check=%%%')).toBeNull();
  });
});
