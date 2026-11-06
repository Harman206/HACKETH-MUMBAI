import { expect, test } from 'vitest';
import { parseEther } from 'viem';
import { fundingPlan } from '../services/chain';

test('prepare tops up only what is missing', () => {
  expect(fundingPlan({ dusd: 0n, positions: 0n, eth: 0n })).toEqual({ dusd: true, eth: true, mint: true });
  expect(fundingPlan({ dusd: 0n, positions: 2n, eth: parseEther('0.02') })).toEqual({ dusd: true, eth: false, mint: false });
  expect(fundingPlan({ dusd: parseEther('10000'), positions: 1n, eth: parseEther('0.003') })).toEqual({ dusd: false, eth: false, mint: false });
  expect(fundingPlan({ dusd: parseEther('10000'), positions: 0n, eth: parseEther('0.001') })).toEqual({ dusd: false, eth: true, mint: true });
});
