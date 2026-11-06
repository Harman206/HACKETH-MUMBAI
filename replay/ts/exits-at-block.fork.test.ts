import { expect, test } from 'vitest';
import { replay } from './cli';
import { LABELS } from './report';

test('R1: LPs exit at the incident block, the real approve is rejected, report is labelled', async () => {
  const r = await replay('R1', process.env.ARCHIVE_RPC ?? 'https://gateway.tenderly.co/public/mainnet');
  expect(r.exits).toHaveLength(2);
  for (const e of r.exits) expect(e.result.status).toBe('recovered');
  expect(r.guard.ok).toBe(false);
  expect(r.lossWithout).toBeGreaterThan(0n);
  expect(r.lossWith).toBe(0n);
  for (const l of LABELS) expect(r.md).toContain(l);
}, 600_000);
