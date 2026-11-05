import { describe, expect, test } from 'vitest';
import { BANNED_SELECTORS, SEL, SIGS } from '../src';
import { toFunctionSelector } from 'viem';

describe('selectors', () => {
  test('well-known selectors match', () => {
    expect(SEL.approve).toBe('0x095ea7b3');
    expect(SEL.transfer).toBe('0xa9059cbb');
    expect(SEL.transferFrom).toBe('0x23b872dd');
    expect(SEL.setApprovalForAll).toBe('0xa22cb465');
    expect(SEL.permit2612).toBe('0xd505accf');
    expect(SEL.multicall).toBe('0xac9650d8');
  });

  test('every banned signature is in BANNED_SELECTORS', () => {
    for (const sig of SIGS.banned) {
      expect(BANNED_SELECTORS.has(toFunctionSelector(`function ${sig}`))).toBe(true);
    }
    expect(BANNED_SELECTORS.size).toBe(SIGS.banned.length);
  });

  test('no exit selector is banned', () => {
    for (const sig of Object.values(SIGS.exits)) {
      expect(BANNED_SELECTORS.has(toFunctionSelector(`function ${sig}`))).toBe(false);
    }
  });
});
