import { describe, expect, test } from 'vitest';
import { SEL } from '@blackout/core';
import { decodeCall, DecodeError } from '../src/decode';
import { approveData, ATTACKER, aaveWithdrawData, collectData, curveRemoveData, decreaseData, multicallData, USER } from './helpers';

describe('decodeCall', () => {
  test('decodes a uniswap exit multicall recursively', () => {
    const d = decodeCall(multicallData([decreaseData(), collectData(USER)]));
    expect(d.name).toBe('multicall');
    expect(d.nested).toHaveLength(2);
    expect(d.nested[0]!.name).toBe('decreaseLiquidity');
    expect(d.nested[0]!.recipients).toEqual([]);
    expect(d.nested[1]!.recipients).toEqual([USER]);
  });

  test('aave withdraw recipient is `to`', () => {
    expect(decodeCall(aaveWithdrawData(ATTACKER)).recipients).toEqual([ATTACKER]);
  });

  test('curve remove_liquidity pays the caller', () => {
    const d = decodeCall(curveRemoveData());
    expect(d.paysCaller).toBe(true);
    expect(d.recipients).toEqual([]);
  });

  test('banned selectors are named, with counterparty', () => {
    const d = decodeCall(approveData(ATTACKER));
    expect(d.name).toBe('approve');
    expect(d.selector).toBe(SEL.approve);
    expect(d.counterparty).toBe(ATTACKER);
  });

  test('truncated calldata throws', () => {
    expect(() => decodeCall(collectData().slice(0, 40) as `0x${string}`)).toThrow(DecodeError);
  });

  test('too-short data throws', () => {
    expect(() => decodeCall('0x1234')).toThrow(DecodeError);
  });

  test('unknown selector throws', () => {
    expect(() => decodeCall('0xdeadbeef')).toThrow(/unknown selector 0xdeadbeef/);
  });

  test('nesting deeper than 2 multicalls throws', () => {
    const lvl3 = multicallData([multicallData([multicallData([collectData()])])]);
    expect(() => decodeCall(lvl3)).toThrow(DecodeError);
    expect(() => decodeCall(multicallData([multicallData([collectData()])]))).not.toThrow();
  });
});
