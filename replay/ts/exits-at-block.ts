import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAbi, type Address, type Hex } from 'viem';
import { ADAPTERS, type Ctx } from '@blackout/adapters';
import { erc20Abi, parseManifest, type Manifest } from '@blackout/core';
import { runExit, type ExitResult, type Sender } from '@blackout/exec';
import { createQuorum } from '@blackout/quorum';
import type { Fork } from '@blackout/testkit';
import type { Fixture } from '../fixtures/schema';

const REPO = join(__dirname, '..', '..');

/** The chain-1 exits we publish (config/manifest.json) — LOCAL FIXTURE MANIFEST, labelled as such in the report. */
export function fixtureManifest(): Manifest {
  return parseManifest(readFileSync(join(REPO, 'config', 'manifest.json'), 'utf8'));
}

export interface LpExit {
  account: Address;
  adapter: string;
  positionId: string;
  label: string;
  result: ExitResult;
  tokens: { address: Address; symbol: string; decimals: number }[];
}

/**
 * At the incident block on an anvil fork: impersonate each real LP and run the kit's own adapters,
 * Guard and runExit. [mainnet fork] [impersonated account]
 */
export async function exitsAtBlock(f: Fixture, fork: Fork): Promise<LpExit[]> {
  const manifest = fixtureManifest();
  const q = createQuorum({ urls: [fork.url, fork.url], timeoutMs: 60_000 });
  const out: LpExit[] = [];
  for (const lp of f.lps) {
    await fork.testClient.impersonateAccount({ address: lp.account });
    await fork.testClient.setBalance({ address: lp.account, value: 10n ** 18n });
    const now = Number((await fork.publicClient.getBlock()).timestamp);
    const ctx: Ctx = { q, chainId: 1, manifest, block: await q.pinBlock(), account: lp.account, slippageBps: 50, nowSec: () => now };
    const adapter = ADAPTERS.find((a) => a.id === lp.adapter)!;
    const positions = await adapter.discover(lp.account, ctx);
    const pos = lp.positionId ? positions.find((p) => p.id === lp.positionId) : positions[0];
    if (!pos) throw new Error(`${lp.adapter} position for ${lp.account} not found at block ${ctx.block}`);
    const plan = await adapter.buildExit(pos, ctx);
    const sender: Sender = {
      sendTransaction: (tx) =>
        fork.wallet(lp.account).sendTransaction({ account: lp.account, to: tx.to, data: tx.data, value: tx.value, gas: 2_000_000n, chain: fork.chain }) as Promise<Hex>,
    };
    const result = await runExit(plan, sender, { ...ctx, pollMs: 200, timeoutMs: 60_000 });
    const tokens = await Promise.all(
      plan.expected.map(async (e) => ({
        address: e.token,
        symbol: await q.read({ address: e.token, abi: erc20Abi, functionName: 'symbol' }, ctx.block).catch(() => e.token.slice(0, 8)),
        decimals: await q.read({ address: e.token, abi: erc20Abi, functionName: 'decimals' }, ctx.block),
      })),
    );
    out.push({ account: lp.account, adapter: lp.adapter, positionId: pos.id, label: pos.label, result, tokens });
    await fork.testClient.stopImpersonatingAccount({ address: lp.account });
  }
  return out;
}

const WETH: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const STABLES = new Set(['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0x6b175474e89094c44da98b954eedeac495271d0f', '0xdac17f958d2ee523a2206206994597c13d831ec7']);
const ETH_USD_FEED: Address = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

/** USD per whole token at the fork block: Chainlink ETH/USD for WETH, $1 for USDC/DAI/USDT, null otherwise. */
export async function usdPrices(fork: Fork, tokens: Address[]): Promise<Record<string, number | null>> {
  const [, answer] = await fork.publicClient.readContract({
    address: ETH_USD_FEED,
    abi: parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)']),
    functionName: 'latestRoundData',
  });
  const eth = Number(answer) / 1e8;
  return Object.fromEntries(tokens.map((t) => [t.toLowerCase(), t.toLowerCase() === WETH.toLowerCase() ? eth : STABLES.has(t.toLowerCase()) ? 1 : null]));
}
