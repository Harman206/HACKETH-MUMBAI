import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeFunctionData, maxUint128, maxUint256, parseAbi, type Address } from 'viem';
import { npmAbi } from '@blackout/core';
import { explain, guard } from '@blackout/guard';
import { fixtureManifest } from './exits-at-block';

/**
 * R3 (synthetic, Polymarket-style Oct 2026): a malicious third-party script on the *real* site rewrites the
 * request — swaps the recipient, or asks for a permit/approval. [synthetic] Same calls into the Guard.
 */
const USER: Address = '0x1111111111111111111111111111111111111111';
const EVIL: Address = '0x6666666666666666666666666666666666666666';
const NPM: Address = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const ctx = { account: USER, chainId: 1, manifest: fixtureManifest() };
const tx = (to: Address, data: `0x${string}`) => ({ chainId: 1, from: USER, to, data, value: 0n });

const injected = {
  'recipient swapped in collect': tx(
    NPM,
    encodeFunctionData({
      abi: npmAbi,
      functionName: 'multicall',
      args: [[
        encodeFunctionData({ abi: npmAbi, functionName: 'decreaseLiquidity', args: [{ tokenId: 1n, liquidity: 1n, amount0Min: 0n, amount1Min: 0n, deadline: 9n }] }),
        encodeFunctionData({ abi: npmAbi, functionName: 'collect', args: [{ tokenId: 1n, recipient: EVIL, amount0Max: maxUint128, amount1Max: maxUint128 }] }),
      ]],
    }),
  ),
  'EIP-2612 permit request': tx(
    USDC,
    encodeFunctionData({
      abi: parseAbi(['function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)']),
      functionName: 'permit',
      args: [USER, EVIL, maxUint256, 9n, 27, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`],
    }),
  ),
  'unlimited approve': tx(USDC, encodeFunctionData({ abi: parseAbi(['function approve(address,uint256)']), functionName: 'approve', args: [EVIL, maxUint256] })),
} as const;

describe('R3 synthetic third-party-script attack', () => {
  test.each(Object.entries(injected))('[synthetic] %s → rejected', (_name, t) => {
    const r = guard(t, ctx);
    expect(r.ok).toBe(false);
    expect(explain(r).length).toBeGreaterThan(0);
  });

  const kit = join(__dirname, '..', '..', 'apps', 'kit', 'dist', 'blackout-kit.html');
  test.skipIf(!existsSync(kit))('the kit itself loads no third-party script (single inline script, CSP-pinned)', () => {
    const html = readFileSync(kit, 'utf8');
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).toMatch(/script-src 'sha256-/);
  });
});
