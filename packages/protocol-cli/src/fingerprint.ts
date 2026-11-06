import { COPEYBARA_KEYS } from '@copeybara/core';
import { readRawTexts } from '@copeybara/ens';
import { createQuorum } from '@copeybara/quorum';
import { ciSummary, diffSite, fingerprintDist, fingerprintUrl } from '@copeybara/fingerprint';
import { ensChainId, fromConfig, rpcsFor, universalResolver, type LoadedConfig } from './config';

export async function fingerprintCmd(l: LoadedConfig, o: { dist?: string; url?: string; write: (f: string, b: string) => Promise<string> }) {
  const dist = o.dist ?? (o.url ? undefined : l.cfg.site?.dist);
  const fp = dist ? await fingerprintDist(fromConfig(l, dist)) : await fingerprintUrl(o.url ?? l.cfg.site?.url ?? '');
  let published: string | null = null;
  try {
    const q = createQuorum({ urls: rpcsFor(l.cfg, ensChainId(l.cfg)), expectedChainId: ensChainId(l.cfg), timeoutMs: 10_000 });
    published = (await readRawTexts(l.cfg.name, [COPEYBARA_KEYS.site], q, { universalResolver: universalResolver(l.cfg) })).texts[COPEYBARA_KEYS.site] ?? '';
  } catch {
    published = null;
  }
  process.stdout.write(`${ciSummary(l.cfg.name, fp, published === null ? null : diffSite(fp.hashes, published))}\n`);
  if (fp.problems.length) {
    process.stderr.write('\nfingerprint: FAILED, nothing written\n');
    process.exit(1);
  }
  process.stdout.write(`\norg.copeybara.site → ${await o.write('site.txt', fp.record)}\n`);
}
