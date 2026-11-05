import { describe, expect, test } from 'vitest';
import { explain, guard } from '../src';
import { INCIDENT_CORPUS } from './incidents';
import { ctx1 } from './manifest-fixture';

describe('Guard on real attacker calldata from incident fixtures', () => {
  test('there is at least one real incident (R1)', () => {
    expect(INCIDENT_CORPUS.map((c) => c.name)).toContain('R1 approve (Curve DNS hijack 2022)');
  });

  test.each(INCIDENT_CORPUS.map((c) => [c.name, c] as const))('%s is rejected: approve banned, spender target not an exit', (_n, c) => {
    const r = guard({ ...c.tx, from: ctx1.account }, ctx1);
    expect(r.ok).toBe(false);
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain('BANNED');
    expect(codes).toContain('TARGET');
    expect(explain(r).join(' ')).toMatch(/Exits never need approvals/);
  });
});
