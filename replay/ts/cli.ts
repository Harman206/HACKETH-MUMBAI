/**
 * pnpm --filter @blackout/replay replay R1
 * Foundry replay (as it happened + counterfactual) → kit exits at the incident block → replay/out/<id>.{md,html}
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { guard } from '@blackout/guard';
import { startFork } from '@blackout/testkit';
import { validateFixture, type Fixture } from '../fixtures/schema';
import { exitsAtBlock, fixtureManifest, usdPrices } from './exits-at-block';
import { runForgeReplay } from './forge';
import { buildReplayReport } from './report';

const ROOT = join(__dirname, '..');
export async function replay(id: string, archiveRpc: string) {
  const fx = validateFixture(JSON.parse(readFileSync(join(ROOT, 'fixtures', `${id}.json`), 'utf8')) as Fixture);
  const forge = runForgeReplay(id, archiveRpc);
  const fork = await startFork({ chainId: 1, forkUrl: archiveRpc, blockNumber: BigInt(fx.forkBlock) });
  try {
    const exits = await exitsAtBlock(fx, fork);
    const account = fx.victim;
    const g = guard({ chainId: 1, from: account, to: fx.approveTarget!, data: fx.approveCalldata!, value: 0n }, { account, chainId: 1, manifest: fixtureManifest() });
    const usd = await usdPrices(fork, [...fx.tokens, ...exits.flatMap((e) => e.tokens.map((t) => t.address))]);
    const result = { fixture: fx, lossWithout: forge.lossWithout, lossWith: forge.lossWith, guard: g, exits, usd };
    const { md, html } = buildReplayReport([result]);
    mkdirSync(join(ROOT, 'out'), { recursive: true });
    writeFileSync(join(ROOT, 'out', `${id}.md`), md);
    writeFileSync(join(ROOT, 'out', `${id}.html`), html);
    return { ...result, md };
  } finally {
    await fork.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2] ?? 'R1';
  const r = await replay(id, process.env.ARCHIVE_RPC ?? 'https://gateway.tenderly.co/public/mainnet');
  console.log(r.md);
}
