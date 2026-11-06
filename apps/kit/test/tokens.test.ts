import { describe, expect, test } from 'vitest';
import type { Quorum } from '@copeybara/quorum';
import { formatAmount, tokenMeta } from '../src/tokens';

const A = '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA' as const;
const B = '0x62715d2762949Ab8Fb124eB01f78898Feb8a596A' as const;

describe('token amounts', () => {
  test('formatAmount: thousands separators, up to 4 decimals, trims zeros', () => {
    expect(formatAmount(1234567890000000000000n, 18)).toBe('1,234.5679');
    expect(formatAmount(10n ** 18n, 18)).toBe('1');
    expect(formatAmount(1500000n, 6)).toBe('1.5');
    expect(formatAmount(0n, 18)).toBe('0');
    expect(formatAmount(1n, 18)).toBe('<0.0001');
  });

  test('tokenMeta reads symbol/decimals and falls back without throwing', async () => {
    const q = {
      read: async (p: { address: string; functionName: string }) => {
        if (p.address === B) throw new Error('rpc down');
        return p.functionName === 'symbol' ? 'DUSD' : 18;
      },
    } as unknown as Quorum;
    expect(await tokenMeta(q, [A, B], 1n)).toEqual({
      [A]: { symbol: 'DUSD', decimals: 18 },
      [B]: { symbol: '0x6271…596A', decimals: 18 },
    });
  });
});
