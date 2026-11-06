import { describe, expect, test } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, encodeFunctionData, parseAbi, slice, type Hex } from 'viem';
import { COPEYBARA_KEYS } from '@copeybara/core';
import { assertBatchScope, buildProposal, grantCall, grantId, MULTISEND_CALL_ONLY, resolverAbi, safeTxHash, setTextCall, txBuilderBatch } from '../src';
import { loaded, RESOLVER, SAFE, WATCHER, WEB } from './helpers';

const K = COPEYBARA_KEYS;
const { cfg } = loaded();
const values = { [K.release]: `sha256:${'ab'.repeat(32)};v=7`, [K.manifest]: '{"v":1,"c":{}}', [K.exits]: '{"kinds":{},"v":1}' };

describe('copeybara propose: one Safe batch, nothing else', () => {
  test('writes every changed record and the two scoped grants, all to the resolver', () => {
    const p = buildProposal({ cfg, ensChainId: 11155111, values, grants: true, createdAt: 0 });
    expect(p.calls.map((c) => c.label.split(' =')[0])).toEqual([
      'setText org.copeybara.release',
      'setText org.copeybara.manifest',
      'setText org.copeybara.exits',
      `grant website key ${WEB} write access to url only`,
      `grant watcher ${WATCHER} write access to org.copeybara.status only`,
      `grant watcher ${WATCHER} write access to org.copeybara.blocklist only`,
    ]);
    expect(p.calls.every((c) => c.to === RESOLVER)).toBe(true);
    expect(p.batch.transactions.every((t) => t.value === '0')).toBe(true);
  });

  test('skips records ENS already has and grants that exist', () => {
    const p = buildProposal({
      cfg,
      ensChainId: 11155111,
      values,
      current: { [K.release]: values[K.release] },
      granted: new Set([grantId(WEB, 'url'), grantId(WATCHER, K.status), grantId(WATCHER, K.blocklist)]),
      grants: true,
      createdAt: 0,
    });
    expect(p.calls).toHaveLength(2);
    expect(p.skipped).toHaveLength(4);
  });

  test('the website key is only ever granted url; the watcher only status + blocklist', () => {
    const p = buildProposal({ cfg, ensChainId: 11155111, values: {}, grants: true, createdAt: 0 });
    for (const c of p.calls) {
      const d = decodeFunctionData({ abi: resolverAbi, data: c.data });
      expect(d.functionName).toBe('grantSetterRoles');
      const [setter, who] = d.args as [Hex, string];
      const [, key, value] = decodeFunctionData({ abi: resolverAbi, data: setter }).args as [Hex, string, string];
      expect(value).toBe('');
      expect(who === WEB ? ['url'] : [K.status, K.blocklist]).toContain(key);
    }
  });

  test('the batch check refuses anything outside that scope', () => {
    const otherName = { ...cfg, name: 'other.eth' };
    const bad = [
      { ...setTextCall(RESOLVER, cfg.name, K.release, 'x'), to: SAFE },
      setTextCall(RESOLVER, otherName.name, K.release, 'x'),
      grantCall(RESOLVER, cfg.name, K.release, WEB, 'website key'),
      grantCall(RESOLVER, cfg.name, 'url', WATCHER, 'watcher'),
      grantCall(RESOLVER, cfg.name, K.status, SAFE, 'safe'),
      { to: RESOLVER, data: encodeFunctionData({ abi: parseAbi(['function grantRootRoles(uint256,address)']), functionName: 'grantRootRoles', args: [16n, WEB] }), label: 'x' },
    ];
    for (const c of bad) expect(() => assertBatchScope([c], cfg), c.label).toThrow();
    expect(() => setTextCall(RESOLVER, cfg.name, K.status as never, 'state=ok')).toThrow(/never writes/);
  });

  test('MultiSendCallOnly packs every call with value 0, operation CALL', () => {
    const p = buildProposal({ cfg, ensChainId: 11155111, values, grants: false, createdAt: 0 });
    expect(p.multiSend.to).toBe(MULTISEND_CALL_ONLY);
    expect(p.multiSend.operation).toBe(1);
    const [packed] = decodeAbiParameters([{ type: 'bytes' }], slice(p.multiSend.data, 4)) as [Hex];
    let off = 0;
    const bytes = (n: number) => {
      const s = slice(packed, off, off + n);
      off += n;
      return s;
    };
    for (const c of p.calls) {
      expect(bytes(1)).toBe('0x00');
      expect(bytes(20).toLowerCase()).toBe(c.to.toLowerCase());
      expect(BigInt(bytes(32))).toBe(0n);
      const len = Number(BigInt(bytes(32)));
      expect(bytes(len)).toBe(c.data);
    }
    expect(off).toBe((packed.length - 2) / 2);
  });

  test('Transaction Builder file: checksum is stable and covers the transactions', () => {
    const calls = [setTextCall(RESOLVER, cfg.name, K.release, 'a')];
    const a = txBuilderBatch({ chainId: 11155111, safe: SAFE, name: 'x', calls, createdAt: 1 });
    const b = txBuilderBatch({ chainId: 11155111, safe: SAFE, name: 'renamed', calls, createdAt: 1 });
    const c = txBuilderBatch({ chainId: 11155111, safe: SAFE, name: 'x', calls: [setTextCall(RESOLVER, cfg.name, K.release, 'b')], createdAt: 1 });
    expect(a.meta.checksum).toBe(b.meta.checksum);
    expect(a.meta.checksum).not.toBe(c.meta.checksum);
  });

  test('safeTxHash depends on Safe, chain and nonce', () => {
    const t = { to: MULTISEND_CALL_ONLY, value: 0n, data: '0x' as Hex, operation: 1 as const, nonce: 3n };
    const h = safeTxHash(SAFE, 11155111, t);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(safeTxHash(SAFE, 1, t)).not.toBe(h);
    expect(safeTxHash(SAFE, 11155111, { ...t, nonce: 4n })).not.toBe(h);
  });
});
