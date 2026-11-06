/**
 * The classifier gaps found by the B1 benchmark (docs/benchmarks/b1-drainer-requests.md), each pinned by the real
 * request from the benchmark set (test/bench-cases.ts) or a minimal reconstruction of it.
 */
import { describe, expect, test } from 'vitest';
import { encodeFunctionData, encodePacked, parseAbi, size, toHex, type Hex } from 'viem';
import { BANNED_SELECTORS, type Address } from '@copeybara/core';
import { classifyRequest, type ClassifyCtx } from '../src/classify';
import { guard } from '../src/guard';
import { explain } from '../src/explain';
import { CASES, type BenchCase } from './bench-cases';
import { ATTACKER, USER, approveData, collectData, decreaseData, multicallData } from './helpers';
import { CURVE_POOL, MANIFEST, NPM_MAINNET } from './manifest-fixture';

const fresh = (account: string, chainId = 1): ClassifyCtx => ({ account: account as Address, chainId, manifests: [] });
const followed = (account: string = USER, chainId = 1): ClassifyCtx => ({ account: account as Address, chainId, manifests: [{ name: 'demoswap-blackout.eth', manifest: MANIFEST }] });
const real = (c: BenchCase, ctx: ClassifyCtx = fresh(c.account)) => classifyRequest(c.request, ctx);
const one = (k: string) => CASES[k]![0]!;
const send = (to: Address, data: Hex, value: Hex = '0x0', extra: Record<string, unknown> = {}) => ({ method: 'eth_sendTransaction', params: [{ from: USER, to, data, value, ...extra }] });
const typed = (td: unknown) => ({ method: 'eth_signTypedData_v4', params: [USER, JSON.stringify(td)] });
const TOKEN: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const SAFE: Address = '0x5afe5afe5afe5afe5afe5afe5afe5afe5afe5afe';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const abi = parseAbi([
  'function upgradeTo(address)',
  'function upgradeToAndCall(address,bytes)',
  'function transferOwnership(address)',
  'function acceptOwnership()',
  'function setOwner(address)',
  'function addOwnerWithThreshold(address,uint256)',
  'function swapOwner(address,address,address)',
  'function removeOwner(address,address,uint256)',
  'function changeThreshold(uint256)',
  'function enableModule(address)',
  'function setGuard(address)',
  'function setFallbackHandler(address)',
  'function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)',
  'function multiSend(bytes)',
  'function setApprovalForAll(address,bool)',
  'function transfer(address,uint256)',
  'function transferFrom(address,address,uint256)',
  'function approve(address,address,uint160,uint48)',
  'function lockdown((address,address)[])',
  'function bulkTransfer(((uint8,address,uint256,uint256)[],address,bool)[],bytes32)',
  'function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
]);
const enc = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi, functionName, args } as never) as Hex;
const execTx = (to: Address, data: Hex, operation = 0, value = 0n) =>
  enc('execTransaction', [to, value, data, operation, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', '0x']);
const packed = (calls: { op: number; to: Address; data: Hex }[]) =>
  ('0x' + calls.map((c) => encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [c.op, c.to, 0n, BigInt(size(c.data)), c.data]).slice(2)).join('')) as Hex;

describe('gap 1: proxy upgrades and ownership changes', () => {
  test('real PTXPhish proxy-upgrade phish (upgradeTo on the victim wallet) → dangerous, naming the new code', () => {
    for (const c of CASES.proxyUpgrade!) {
      const r = real(c);
      expect(r.verdict, c.tx).toBe('dangerous');
      expect(r.reasons[0]).toMatch(/replaces the code/);
    }
    expect(real(one('proxyUpgrade')).counterparty?.toLowerCase()).toBe('0x66833c45d52b3f950cb60368a5fd30b84754c17f');
  });
  test('upgradeToAndCall / transferOwnership / setOwner to a stranger → dangerous; the reason says who gets control', () => {
    for (const data of [enc('upgradeToAndCall', [ATTACKER, '0x']), enc('transferOwnership', [ATTACKER]), enc('setOwner', [ATTACKER])]) {
      const r = classifyRequest(send(SAFE, data), fresh(USER));
      expect(r.verdict, data.slice(0, 10)).toBe('dangerous');
      expect(r.reasons[0]!.toLowerCase()).toContain('0xbadb…bad0');
    }
    expect(classifyRequest(send(SAFE, enc('transferOwnership', [ATTACKER])), fresh(USER)).reasons[0]).toMatch(/hands control of the contract/);
  });
  test('real PTXPhish upgradeTo(the sender itself): an account is not code, the proxy would break → risky (asks)', () => {
    const r = real(one('proxyUpgradeToSelf'));
    expect(r.verdict).toBe('risky');
    expect(r.reasons[0]).toMatch(/stop working/);
  });
  test('ownership to your own address → not red; to a followed or well-known contract → risky, never dangerous', () => {
    expect(classifyRequest(send(SAFE, enc('transferOwnership', [USER])), fresh(USER)).verdict).toBe('unknown');
    expect(classifyRequest(send(SAFE, enc('acceptOwnership', [])), fresh(USER)).verdict).toBe('unknown');
    const toFollowed = classifyRequest(send(SAFE, enc('transferOwnership', [CURVE_POOL])), followed());
    expect(toFollowed.verdict).toBe('risky');
    expect(toFollowed.reasons[0]).toMatch(/demoswap-blackout\.eth/);
    expect(classifyRequest(send(SAFE, enc('upgradeTo', [NPM_MAINNET])), fresh(USER)).verdict).toBe('risky');
  });
  test('Safe owner management to a stranger → dangerous ("hands control of your Safe")', () => {
    const SENTINEL: Address = '0x0000000000000000000000000000000000000001';
    for (const data of [
      enc('addOwnerWithThreshold', [ATTACKER, 1n]),
      enc('swapOwner', [SENTINEL, USER, ATTACKER]),
      enc('enableModule', [ATTACKER]),
      enc('setGuard', [ATTACKER]),
      enc('setFallbackHandler', [ATTACKER]),
    ]) {
      const r = classifyRequest(send(SAFE, data), fresh(USER));
      expect(r.verdict, data.slice(0, 10)).toBe('dangerous');
      expect(r.reasons[0]).toMatch(/your Safe/);
    }
    expect(classifyRequest(send(SAFE, enc('addOwnerWithThreshold', [ATTACKER, 1n])), fresh(USER)).reasons[0]).toMatch(/hands control of your Safe to 0xbadb…bad0/i);
    expect(classifyRequest(send(SAFE, enc('removeOwner', [SENTINEL, USER, 1n])), fresh(USER)).verdict).toBe('dangerous');
    expect(classifyRequest(send(SAFE, enc('changeThreshold', [1n])), fresh(USER)).verdict).toBe('risky');
  });
  test('the same Safe change wrapped in execTransaction, in a MultiSend, or as a SafeTx signature → dangerous', () => {
    const add = enc('addOwnerWithThreshold', [ATTACKER, 1n]);
    expect(classifyRequest(send(SAFE, execTx(SAFE, add)), fresh(USER)).verdict).toBe('dangerous');
    const ms = enc('multiSend', [packed([{ op: 0, to: SAFE, data: add }])]);
    expect(classifyRequest(send(SAFE, execTx('0x40A2aCCbd92BCA938b02010E17A5b8929b49130D', ms, 1)), fresh(USER)).verdict).toBe('dangerous');
    const safeTx = {
      domain: { chainId: 1, verifyingContract: SAFE },
      primaryType: 'SafeTx',
      types: {},
      message: { to: SAFE, value: '0', data: add, operation: 0, safeTxGas: '0', baseGas: '0', gasPrice: '0', gasToken: '0x0000000000000000000000000000000000000000', refundReceiver: '0x0000000000000000000000000000000000000000', nonce: '7' },
    };
    const r = classifyRequest(typed(safeTx), fresh(USER));
    expect(r.verdict).toBe('dangerous');
    expect(r.reasons[0]).toMatch(/Safe transaction/);
  });
  test('a Safe delegatecall into unknown code (the Bybit 2025 pattern) → dangerous', () => {
    const r = classifyRequest(send(SAFE, execTx(ATTACKER, '0xa9059cbb', 1)), fresh(USER));
    expect(r.verdict).toBe('dangerous');
    expect(r.reasons[0]).toMatch(/delegatecall/);
  });
  test('EIP-7702: a transaction carrying an authorization that delegates your account to unknown code → dangerous', () => {
    const r = classifyRequest(send(USER, '0x', '0x0', { authorizationList: [{ address: ATTACKER, chainId: '0x1', nonce: '0x0' }] }), fresh(USER));
    expect(r.verdict).toBe('dangerous');
    expect(r.reasons[0]).toMatch(/EIP-7702/);
    expect(classifyRequest(send(USER, '0x', '0x0', { authorizationList: [{ contractAddress: ATTACKER, chainId: 1, nonce: 0 }] }), fresh(USER)).verdict).toBe('dangerous');
  });
  test('the Exit Guard still rejects every one of these (as never part of an exit)', () => {
    for (const data of [enc('upgradeTo', [ATTACKER]), enc('transferOwnership', [ATTACKER]), enc('addOwnerWithThreshold', [ATTACKER, 1n]), execTx(SAFE, '0x'), enc('multiSend', ['0x'])]) {
      expect(BANNED_SELECTORS.has(data.slice(0, 10) as Hex), data.slice(0, 10)).toBe(true);
      const g = guard({ chainId: 1, from: USER, to: NPM_MAINNET, data, value: 0n }, { account: USER, chainId: 1, manifest: MANIFEST });
      expect(g.ok).toBe(false);
      expect(g.reasons.map((x) => x.code)).toContain('BANNED');
      expect(explain(g).join(' ')).not.toMatch(/move your tokens/);
    }
    const nested = guard({ chainId: 1, from: USER, to: NPM_MAINNET, data: multicallData([decreaseData(), collectData(), enc('transferOwnership', [ATTACKER])]), value: 0n }, { account: USER, chainId: 1, manifest: MANIFEST });
    expect(nested.ok).toBe(false);
  });
});

describe('gap 2: NFT bulk transfers', () => {
  test('real PTXPhish OpenSea TransferHelper bulkTransfer to the attacker → dangerous, naming the receiver', () => {
    const r = real(one('nftBulk'));
    expect(r.verdict).toBe('dangerous');
    expect(r.counterparty?.toLowerCase()).toBe('0x189c287746e9e9b3d2f0fb5768d3286527aab48a');
    expect(r.reasons[0]).toMatch(/2 NFTs or tokens/);
  });
  test('bulkTransfer to yourself is not red; ERC-1155 safeBatchTransferFrom to a stranger is', () => {
    const items = (to: Address) => [[[[2, ATTACKER, 1n, 1n]], to, true]] as const;
    const KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000';
    expect(classifyRequest(send(TOKEN, enc('bulkTransfer', [items(USER), KEY])), fresh(USER)).verdict).toBe('unknown');
    expect(classifyRequest(send(TOKEN, enc('bulkTransfer', [[...items(USER), ...items(ATTACKER)], KEY])), fresh(USER)).verdict).toBe('dangerous');
    expect(classifyRequest(send(TOKEN, enc('safeBatchTransferFrom', [USER, ATTACKER, [1n], [1n], '0x'])), fresh(USER)).verdict).toBe('dangerous');
  });
});

describe('gap 3: revocations are safe', () => {
  test('real victims revoking drainers: approve(x, 0) and setApprovalForAll(x, false) → pass, "removes a permission"', () => {
    for (const c of [one('revokeApprove'), one('revokeAll')]) {
      const r = real(c);
      expect(r.verdict, c.tx).toBe('pass');
      expect(r.reasons[0]).toMatch(/Removes a permission/);
    }
  });
  test('Permit2 approve 0, Permit2 lockdown, a permit with value 0 → pass', () => {
    expect(classifyRequest(send(PERMIT2, enc('approve', [TOKEN, ATTACKER, 0n, 0])), fresh(USER)).verdict).toBe('pass');
    expect(classifyRequest(send(PERMIT2, enc('lockdown', [[[TOKEN, ATTACKER]]])), fresh(USER)).verdict).toBe('pass');
    const permit = (value: string) => ({
      domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: TOKEN },
      primaryType: 'Permit',
      types: {},
      message: { owner: USER, spender: ATTACKER, value, nonce: '0', deadline: '9999999999' },
    });
    expect(classifyRequest(typed(permit('0')), fresh(USER)).verdict).toBe('pass');
    expect(classifyRequest(typed(permit('1')), fresh(USER)).verdict).toBe('dangerous');
    const dai = (allowed: boolean) => ({ domain: { name: 'Dai Stablecoin', chainId: 1 }, primaryType: 'Permit', types: {}, message: { holder: USER, spender: ATTACKER, nonce: 0, expiry: 0, allowed } });
    expect(classifyRequest(typed(dai(false)), fresh(USER)).verdict).toBe('pass');
    expect(classifyRequest(typed(dai(true)), fresh(USER)).verdict).toBe('dangerous');
  });
  test('a revocation cannot hide ETH sent to an unknown contract', () => {
    expect(classifyRequest(send(ATTACKER, approveData(ATTACKER, 0n), toHex(10n ** 18n)), fresh(USER)).verdict).toBe('risky');
  });
});

describe('gap 4: the amount shown comes from the inner call', () => {
  test('multicall[approve(max)] says ALL; multicall[approve(5)] says part', () => {
    const big = classifyRequest(send(TOKEN, multicallData([approveData(ATTACKER)])), fresh(USER));
    expect(big.verdict).toBe('dangerous');
    expect(big.reasons[0]).toMatch(/ALL of this token/);
    const small = classifyRequest(send(TOKEN, multicallData([approveData(ATTACKER, 5n)])), fresh(USER));
    expect(small.reasons[0]).toMatch(/part of this token/);
  });
});

describe('gap 5: everyday dapps are not drainers', () => {
  test.each([
    ['approve 1inch AggregationRouterV6', '1inch'],
    ['approve 0x AllowanceHolder', '0x'],
    ['approve CoW GPv2VaultRelayer', 'CoW Protocol'],
    ['approve Aave v3 Pool', 'Aave'],
    ['approve Lido WithdrawalQueue', 'Lido'],
    ['conduit', 'OpenSea'],
    ['seaportCall', 'OpenSea'],
    ['oneinchCall', '1inch'],
    ['stethSubmit', 'Lido'],
  ])('real %s → known (%s)', (k, protocol) => {
    const r = real(one(k));
    expect(r.verdict).toBe('known');
    expect(r.protocol).toBe(protocol);
  });
  test('the drainer requests in the same set stay red', () => {
    for (const k of ['drainerApproveUnlimited', 'drainerSetAll']) expect(real(one(k)).verdict, k).toBe('dangerous');
  });
});

describe('gap 6: a plain token send asks, it does not alarm', () => {
  test('real stETH transfer to a friend → risky, with the amount and the address', () => {
    const r = real(one('stethTransfer'));
    expect(r.verdict).toBe('risky');
    expect(r.reasons[0]).toMatch(/^You are sending [\d,]+ units of the token at 0x…?/);
    expect(r.reasons[0]).toMatch(/make sure you know this address/i);
  });
  test('a transfer to a drainer still stops the request (risky); hidden in a batch or as transferFrom it stays dangerous', () => {
    expect(real(one('drainerTransfer')).verdict).toBe('risky');
    const t = enc('transfer', [ATTACKER, 5n]);
    expect(classifyRequest(send(TOKEN, multicallData([t])), fresh(USER)).verdict).toBe('dangerous');
    expect(classifyRequest(send(TOKEN, enc('transferFrom', [USER, ATTACKER, 5n])), fresh(USER)).verdict).toBe('dangerous');
    const batch = { method: 'wallet_sendCalls', params: [{ chainId: '0x1', calls: [{ to: TOKEN, data: t }, { to: TOKEN, data: t }] }] };
    expect(classifyRequest(batch, fresh(USER)).verdict).toBe('dangerous');
  });
});
