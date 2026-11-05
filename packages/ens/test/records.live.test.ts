import { expect, test } from 'vitest';
import { createQuorum } from '@blackout/quorum';
import networks from '../../../config/networks.json';
import { readBlackoutRecords } from '../src';

/** Reads a real ENSv2 name. Set BLACKOUT_ENS_NAME and BLACKOUT_ENS_RPCS (comma-separated). */
const name = process.env.BLACKOUT_ENS_NAME;
const rpcs = process.env.BLACKOUT_ENS_RPCS?.split(',');

test.skipIf(!name || !rpcs)('reads live BLACKOUT records through the quorum', async () => {
  const q = createQuorum({ urls: rpcs! });
  const r = await readBlackoutRecords(name!, q, { universalResolver: networks.ens.universalResolver as `0x${string}` });
  expect(r.release.version).toBeGreaterThanOrEqual(1);
  expect(r.manifest.v).toBe(1);
  expect(r.resolver).toMatch(/^0x[0-9a-fA-F]{40}$/);
}, 30_000);
