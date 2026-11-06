export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type AdapterId = 'uniswap-v3' | 'uniswap-v4' | 'aave-v3' | 'curve-3pool';
export const ADAPTER_IDS: readonly AdapterId[] = ['uniswap-v3', 'uniswap-v4', 'aave-v3', 'curve-3pool'];

/** A transaction the kit wants the wallet to send. */
export interface TxRequest {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
}

/** One contract in the manifest. Empty `selectors` means read-only reference. */
export interface TargetEntry {
  address: Address;
  selectors: Hex[];
}

export type ChainManifest = Partial<Record<AdapterId, Record<string, TargetEntry>>>;

/** Decoded org.copeybara.manifest record. `chains` is keyed by decimal chain ID. */
export interface Manifest {
  v: 1;
  chains: Record<string, ChainManifest>;
  /** Protocols the record lists that this kit version does not know ("name on chain N"). Skipped, never allowed. */
  unknown?: string[];
}

/** Decoded org.copeybara.release record. */
export interface ReleaseRecord {
  sha256: string;
  version: number;
  /** extension build proof: sha256 over the sorted "<path>\t<sha256>\n" lines of the unpacked build (optional) */
  tree?: string;
}

export interface ExpectedDelta {
  token: Address;
  min: bigint;
}

/** A short note shown next to a position (e.g. what a Uniswap v4 pool's hook can do on withdrawal). Display only. */
export interface PositionBadge {
  tone: 'info' | 'warn';
  text: string;
}

export interface Position {
  adapter: AdapterId;
  id: string;
  label: string;
  tokens: Address[];
  /** Set when the kit cannot exit this position safely; explains why. */
  manual?: string;
  /** Display-only notes, e.g. Uniswap v4 hook permissions. Never changes what the Guard allows. */
  badges?: PositionBadge[];
  raw: unknown;
}

export interface ExitPlan {
  position: Position;
  calls: TxRequest[];
  expected: ExpectedDelta[];
  /** Simulated amounts the exit would pay out (display only; `expected` carries the enforced minimums). */
  preview?: { token: Address; amount: bigint }[];
}
