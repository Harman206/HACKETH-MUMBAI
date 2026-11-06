// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { stepOf } from '../src/flow';
import { COPY } from '../src/copy';

describe('stepper', () => {
  test('stepOf maps every flow state to Verify/Connect/Positions/Exit', () => {
    expect(stepOf({ step: 'setup' })).toBe(1);
    expect(stepOf({ step: 'loading', what: '', stage: 1 })).toBe(1);
    expect(stepOf({ step: 'loading', what: '', stage: 2 })).toBe(2);
    expect(stepOf({ step: 'loading', what: '', stage: 3 })).toBe(3);
    expect(stepOf({ step: 'error', message: 'x', stage: 2 })).toBe(2);
    const base = { step: 'positions' as const, records: {} as never, rollbackWarning: false, account: '0x1' as never, chainId: 1, positions: [] as never[], busy: null, discoveryErrors: [] as string[], facts: [] as { label: string; value: string }[], previews: {}, meta: {} };
    expect(stepOf({ ...base, results: {} })).toBe(3);
    expect(stepOf({ ...base, results: { a: {} as never } })).toBe(4);
  });

  test('the connecting copy tells people where the wallet popup is', () => {
    expect(COPY.connecting).toMatch(/click its toolbar icon if no popup appeared/);
  });
});
