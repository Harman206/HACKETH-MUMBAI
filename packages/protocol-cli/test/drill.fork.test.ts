import { expect, test } from 'vitest';
import { erc4626Kind } from '@copeybara/core';
import { sampleDrillReport } from '../src/drill';

test('drill: an ERC-4626 vault described ONLY by the declarative spec is Recovered with the site and primary RPC off', async () => {
  const r = await sampleDrillReport(erc4626Kind('Sample vault'));
  expect(r.siteOff).toBe(true);
  expect(r.primaryRpcOff).toBe(true);
  expect(r.positions.map((p) => p.id)).toEqual(['spec:vault']);
  expect(r.results).toHaveLength(1);
  expect(r.results[0]!.status).toBe('recovered');
  expect(BigInt(r.results[0]!.deltas[0]!.after) - BigInt(r.results[0]!.deltas[0]!.before)).toBeGreaterThanOrEqual(BigInt(r.results[0]!.deltas[0]!.min));
  expect(r.checks).toEqual([expect.objectContaining({ name: 'a paused vault is manual, never sent', pass: true })]);
  expect(r.pass).toBe(true);
}, 300_000);
