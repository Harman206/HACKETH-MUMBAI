import { describe, expect, test } from 'vitest';
import { hijackVerdict } from '../services/drill-report';

describe('drill metric: hijack approval rejected (review: must not be tautological)', () => {
  test('counts only when the Guard names the approval as banned', () => {
    expect(hijackVerdict({ ok: false, reasons: [{ code: 'TARGET', detail: 'x' }, { code: 'BANNED', detail: 'approve is never part of an exit' }] })).toBe(true);
  });
  test('a rejection for some other reason (wrong chain, unknown target) does not count', () => {
    expect(hijackVerdict({ ok: false, reasons: [{ code: 'CHAIN', detail: 'x' }] })).toBe(false);
    expect(hijackVerdict({ ok: false, reasons: [{ code: 'DECODE', detail: 'x' }] })).toBe(false);
  });
  test('accepted → false', () => {
    expect(hijackVerdict({ ok: true, reasons: [] })).toBe(false);
  });
});
