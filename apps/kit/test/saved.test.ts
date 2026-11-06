import { describe, expect, test } from 'vitest';
import { savedLine } from '../src/saved';

const DUSD = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
const WETH = '0x1111111111111111111111111111111111111111';
const meta = { [DUSD]: { symbol: 'DUSD', decimals: 18 }, [WETH]: { symbol: 'WETH', decimals: 18 } } as const;
const d = (token: string, gain: bigint) => ({ token: token as `0x${string}`, before: 5n, after: 5n + gain, min: 0n });

describe('"Saved by Copey!" line in the kit', () => {
  test('sums what came back per token across the exits just finished', () => {
    expect(savedLine([{ deltas: [d(DUSD, 4000n * 10n ** 18n), d(WETH, 10n ** 17n)] }, { deltas: [d(DUSD, 6000n * 10n ** 18n)] }], meta)).toBe(
      'You got 10,000 DUSD + 0.1 WETH back, straight from the contracts.',
    );
  });
  test('no balance change to show → a plain line', () => {
    expect(savedLine([{ deltas: [] }], meta)).toBe('Your position came back to your wallet, straight from the contracts.');
  });
});
