import { describe, expect, test } from 'vitest';
import type { CopeybaraRecords } from '@copeybara/ens';
import { readLiveProof, type DemoRun } from '../src/live';

const records = {
  name: 'demoswap-blackout.eth', url: 'https://demoswap.localhost', release: { sha256: 'ab'.repeat(32), version: 3 }, block: 12n, site: null,
  resolver: '0x642cD108b4EA8cb1e7617213533FfE1AcE8BDE82',
  manifest: { v: 1, chains: { '11155111': { 'uniswap-v3': { positionManager: { address: '0x1238536071E1c677A632429e3655c799b22cDA52', selectors: ['0xac9650d8'] } } }, '1': { 'aave-v3': { pool: { address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', selectors: ['0x69328dec'] } } } } },
} as unknown as CopeybaraRecords;
const run: DemoRun = { network: 'sepolia', victim: '0x1', drained: '10,000 DUSD', drainTx: '0xd1', rescueTx: '0xr1', recovered: '999 DUSD + 999 DETH', at: 1 };

describe('live proof (public mode)', () => {
  test('summarises the live ENS records, the permission checks and the last run', async () => {
    const p = await readLiveProof({ readRecords: async () => records, fetchRun: async () => run });
    expect(p.release).toEqual({ version: 3, sha256: 'ab'.repeat(32) });
    expect(p.block).toBe('12');
    expect(p.exits).toEqual(['Sepolia: uniswap-v3 positionManager', 'Ethereum mainnet: aave-v3 pool']);
    expect(p.permissions).toHaveLength(6);
    expect(p.permissions.every((x) => x.pass)).toBe(true);
    expect(p.lastRun).toEqual(run);
  });

  test('no recorded run → null (UI says "No live run recorded yet")', async () => {
    const p = await readLiveProof({ readRecords: async () => records, fetchRun: async () => { throw new Error('404'); } });
    expect(p.lastRun).toBeNull();
  });

  test('ENS read failure surfaces a plain error instead of crashing', async () => {
    const p = await readLiveProof({ readRecords: async () => { throw new Error('RPC paths disagree on eth_call; refusing to continue.'); }, fetchRun: async () => run });
    expect(p.error).toMatch(/disagree/);
    expect(p.release).toBeNull();
  });
});
