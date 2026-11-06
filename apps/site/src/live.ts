import type { BlackoutRecords } from '@blackout/ens';
import { PERMISSIONS } from './content';

export interface DemoRun {
  network: 'sepolia' | 'local-fork';
  victim: string;
  drained: string;
  drainTx: string;
  rescueTx: string;
  recovered: string;
  at: number;
}

export interface LiveProof {
  release: { version: number; sha256: string } | null;
  block: string | null;
  exits: string[];
  permissions: typeof PERMISSIONS;
  lastRun: DemoRun | null;
  error: string | null;
}

const CHAIN: Record<string, string> = { '1': 'Ethereum mainnet', '11155111': 'Sepolia' };

/** Public mode: everything here is read live from chain or committed evidence; nothing is mocked. */
export async function readLiveProof(deps: { readRecords: () => Promise<BlackoutRecords>; fetchRun: () => Promise<DemoRun> }): Promise<LiveProof> {
  const lastRun = await deps.fetchRun().catch(() => null);
  try {
    const r = await deps.readRecords();
    const exits = Object.entries(r.manifest.chains)
      .sort(([a], [b]) => (a === '11155111' ? -1 : b === '11155111' ? 1 : 0))
      .flatMap(([cid, protos]) => Object.entries(protos).flatMap(([p, roles]) => Object.entries(roles ?? {}).filter(([, t]) => t.selectors.length > 0).map(([role]) => `${CHAIN[cid] ?? `chain ${cid}`}: ${p} ${role}`)));
    return { release: { version: r.release.version, sha256: r.release.sha256 }, block: r.block.toString(), exits, permissions: PERMISSIONS, lastRun, error: null };
  } catch (e) {
    return { release: null, block: null, exits: [], permissions: PERMISSIONS, lastRun, error: (e as Error).message };
  }
}
