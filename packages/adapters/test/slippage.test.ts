import { expect, test } from 'vitest';
import { applySlippage } from '../src';

test('applySlippage floors at bps', () => {
  expect(applySlippage(10000n, 50)).toBe(9950n);
  expect(applySlippage(1n, 50)).toBe(0n);
  expect(applySlippage(0n, 50)).toBe(0n);
  expect(applySlippage(10n ** 18n, 0)).toBe(10n ** 18n);
});

test('applySlippage rejects out-of-range bps', () => {
  expect(() => applySlippage(1n, -1)).toThrow();
  expect(() => applySlippage(1n, 10001)).toThrow();
});
