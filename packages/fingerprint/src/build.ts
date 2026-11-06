import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { COPEYBARA_KEYS, type Address } from '@copeybara/core';
import { readRawTexts } from '@copeybara/ens';
import { createQuorum } from '@copeybara/quorum';
import networks from '../../../config/networks.json';
import { ciSummary, diffSite, fingerprintDist, WELL_KNOWN, wellKnownJson, type FetchBytes, type SiteFingerprint } from './index';

export interface PluginOptions {
  /** The protocol's ENS name. Set it to get a diff against the live org.copeybara.site in the CI summary. */
  ens?: string;
  /** RPCs for the ENS chain (default: the kit's three Sepolia defaults). */
  rpcs?: string[];
  /** Default true: an unpinned third-party script (or any other problem) fails the build. */
  failOnProblems?: boolean;
  /** Default true: write dist/.well-known/copeybara-site.json. */
  writeWellKnown?: boolean;
  log?: (s: string) => void;
  fetch?: FetchBytes;
}

export class FingerprintError extends Error {
  override name = 'FingerprintError';
}

/**
 * What every build plugin runs after the bundle is written. It never publishes: the new record goes on ENS only when
 * the Safe signs the batch from `copeybara propose`.
 */
export async function fingerprintBuild(dist: string, o: PluginOptions = {}): Promise<SiteFingerprint> {
  const log = o.log ?? ((s: string) => console.log(s));
  const fp = await fingerprintDist(dist, { fetch: o.fetch });
  let published: string | null = null;
  if (o.ens) {
    try {
      const urls = o.rpcs ?? networks.defaultRpcs['11155111'];
      const q = createQuorum({ urls, expectedChainId: networks.ens.chainId, timeoutMs: 8000 });
      published = (await readRawTexts(o.ens, [COPEYBARA_KEYS.site], q, { universalResolver: networks.ens.universalResolver as Address })).texts[COPEYBARA_KEYS.site] ?? '';
    } catch (e) {
      log(`copeybara: could not read ${o.ens} from ENS (${(e as Error).message}); no diff`);
    }
  }
  const summary = ciSummary(o.ens ?? '', fp, published === null ? null : diffSite(fp.hashes, published));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  log(summary);
  if (o.writeWellKnown !== false && !fp.problems.length) {
    const p = join(dist, WELL_KNOWN);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, wellKnownJson(o.ens ?? '', fp));
  }
  if (fp.problems.length && o.failOnProblems !== false) throw new FingerprintError(`copeybara: this build cannot be published:\n- ${fp.problems.join('\n- ')}`);
  return fp;
}
