import { getAddress, isAddress, type Address, type Hex } from 'viem';
import type { DrainRecord } from './drainer-bot';

/** Attack Theater: the four-chapter live story. Chain access is injected so the logic is testable. */
export const VICTIM_CAP = 3;

export interface TheaterDeps {
  network: 'sepolia' | 'local-fork';
  prepareVictim: (victim: Address) => Promise<Hex[]>;
  readVictim: (victim: Address) => Promise<{ dusd: string; positions: string[] }>;
  verifyKits: () => Promise<{ real: string; tampered: string }>;
  drains: () => DrainRecord[];
  switches: () => { site: 'up' | 'down'; rpc: 'up' | 'down'; hijack: boolean };
  rescue: () => unknown;
}

export type JsonDrain = Omit<DrainRecord, 'amount'> & { amount: string };

export interface TheaterState {
  network: 'sepolia' | 'local-fork';
  victim: Address | null;
  victimDusd: string | null;
  victimPositions: string[];
  switches: { site: 'up' | 'down'; rpc: 'up' | 'down'; hijack: boolean };
  drains: JsonDrain[];
  verify: { real: string; tampered: string } | null;
  rescue: unknown;
  chapter: 1 | 2 | 3 | 4;
  prepareTxs: Hex[];
}

const recovered = (r: unknown) => Array.isArray((r as { results?: unknown[] })?.results) && (r as { results: { status: string }[] }).results.some((x) => x.status === 'recovered');

export function createTheater(d: TheaterDeps) {
  const prepared = new Map<string, Hex[]>();
  let current: Address | null = null;
  let verify: { real: string; tampered: string } | null = null;

  return {
    async prepare(victim: Address): Promise<{ txs: Hex[] }> {
      if (typeof victim !== 'string' || !isAddress(victim, { strict: false })) throw new Error('victim must be an address');
      const v = getAddress(victim);
      current = v;
      const known = prepared.get(v);
      if (known) return { txs: known };
      if (prepared.size >= VICTIM_CAP) throw new Error(`demo cap reached: ${VICTIM_CAP} victims per session (testnet funds)`);
      prepared.set(v, []); // reserve before awaiting so a double-click cannot prepare twice
      try {
        const txs = await d.prepareVictim(v);
        prepared.set(v, txs);
        return { txs };
      } catch (e) {
        prepared.delete(v);
        throw e;
      }
    },

    async verify() {
      verify = await d.verifyKits();
      return verify;
    },

    async state(): Promise<TheaterState> {
      const sw = d.switches();
      const drains = d.drains().filter((x) => !current || x.victim.toLowerCase() === current.toLowerCase());
      const drained = drains.some((x) => x.drainTx);
      const outage = sw.site === 'down' && sw.rpc === 'down';
      const rescue = d.rescue();
      // Chapters only advance in story order: a rescue before the drain stays in chapter 1.
      const chapter: TheaterState['chapter'] = !drained ? 1 : !outage ? 2 : recovered(rescue) ? 4 : 3;
      const v = current ? await d.readVictim(current).catch(() => ({ dusd: null, positions: [] as string[] })) : null;
      return {
        network: d.network,
        victim: current,
        victimDusd: v?.dusd ?? null,
        victimPositions: v?.positions ?? [],
        switches: sw,
        drains: drains.map((x) => ({ ...x, amount: x.amount.toString() })),
        verify,
        rescue,
        chapter,
        prepareTxs: current ? (prepared.get(current) ?? []) : [],
      };
    },
  };
}
