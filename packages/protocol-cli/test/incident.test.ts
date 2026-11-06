import { describe, expect, test } from 'vitest';
import { decodeFunctionData, type Hex } from 'viem';
import { COPEYBARA_KEYS, parseBlocklist, parseStatus } from '@copeybara/core';
import { buildIncident } from '../src/incident';
import { assertBatchScope } from '../src/propose';
import { grantCall, resolverAbi, setTextCall } from '../src/resolver';
import { loaded, RESOLVER, WEB } from './helpers';

const { cfg } = loaded();
const args = (data: Hex) => decodeFunctionData({ abi: resolverAbi, data }).args as [Hex, string, string];

describe('copeybara incident', () => {
  test('one batch: status, plus the blocklist merged with what is published', () => {
    const r = buildIncident({ cfg, ensChainId: 11155111, state: 'compromised', note: 'DNS hijacked; use the exit kit', block: ['Demoswap-Claim.xyz'], unblock: ['old.example'], currentBlocklist: '{"v":1,"domains":["old.example","phish.example"]}', now: 1_700_000_000_000, createdAt: 1 });
    expect(r.calls.map((c) => args(c.data)[1])).toEqual([COPEYBARA_KEYS.status, COPEYBARA_KEYS.blocklist]);
    expect(parseStatus(args(r.calls[0]!.data)[2])).toEqual({ state: 'compromised', at: 1_700_000_000, note: 'DNS hijacked; use the exit kit' });
    expect(parseBlocklist(args(r.calls[1]!.data)[2])).toEqual(['demoswap-claim.xyz', 'phish.example']);
    expect(r.calls.every((c) => c.to === RESOLVER)).toBe(true);
    expect(r.batch.transactions).toHaveLength(2);
  });
  test('status only when no hosts are given', () => {
    expect(buildIncident({ cfg, ensChainId: 11155111, state: 'ok', currentBlocklist: '', now: 0 }).calls).toHaveLength(1);
  });
  test('an incident batch cannot write a release or grant anything', () => {
    expect(() => assertBatchScope([setTextCall(RESOLVER, cfg.name, COPEYBARA_KEYS.release, 'x')], cfg, { incident: true })).toThrow(/batch writes/);
    expect(() => assertBatchScope([grantCall(RESOLVER, cfg.name, 'url', WEB, 'website key')], cfg, { incident: true })).toThrow(/batch calls grantSetterRoles/);
  });
  test('a normal batch still cannot write status', () => {
    const r = buildIncident({ cfg, ensChainId: 11155111, state: 'ok', currentBlocklist: '', now: 0 });
    expect(() => assertBatchScope(r.calls, cfg)).toThrow(/batch writes org.copeybara.status/);
  });
});
