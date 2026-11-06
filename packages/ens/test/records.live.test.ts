import { expect, test } from 'vitest';
import { createQuorum } from '@copeybara/quorum';
import networks from '../../../config/networks.json';
import { readCopeybaraRecords } from '../src';

/** Reads a real ENSv2 name. Set COPEYBARA_ENS_NAME and COPEYBARA_ENS_RPCS (comma-separated). */
const name = process.env.COPEYBARA_ENS_NAME;
const rpcs = process.env.COPEYBARA_ENS_RPCS?.split(',');

test.skipIf(!name || !rpcs)('reads live Copeybara records through the quorum', async () => {
  const q = createQuorum({ urls: rpcs! });
  const r = await readCopeybaraRecords(name!, q, { universalResolver: networks.ens.universalResolver as `0x${string}` });
  expect(r.release.version).toBeGreaterThanOrEqual(1);
  expect(r.manifest.v).toBe(1);
  expect(r.resolver).toMatch(/^0x[0-9a-fA-F]{40}$/);
}, 30_000);
