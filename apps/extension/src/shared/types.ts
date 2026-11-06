import type { Address, Manifest, ReleaseRecord, StatusRecord } from '@copeybara/core';
import type { Classification, RequestVerdict } from '@copeybara/guard';
import type { CodeItem, SiteVerdict } from '@copeybara/sitecheck';

export const ENS_CHAIN_ID = 11155111;

export interface Settings {
  /** the wallet address Copeybara watches (read-only: the extension never signs) */
  account: Address | null;
  /** user-added Sepolia RPCs (used with the 3 defaults unless useDefaultRpcs is false) */
  userRpcs: string[];
  useDefaultRpcs: boolean;
  /** where "Exit safely" opens the kit (its bytes are checked against the protocol's release first) */
  kitUrl: string;
  setupDone: boolean;
}

/** One followed protocol's ENS records as last read through the quorum (JSON-safe). */
export interface Snapshot {
  name: string;
  url: string | null;
  /** origin of `url`, the site the fingerprint applies to */
  origin: string | null;
  release: ReleaseRecord;
  manifest: Manifest;
  site: string[] | null;
  extension: ReleaseRecord | null;
  status: StatusRecord | null;
  blocklist: string[];
  problems: { key: string; message: string }[];
  block: string;
  syncedAt: number;
}

export interface ProtocolState {
  name: string;
  followedAt: number;
  snapshot: Snapshot | null;
  /** last sync error (RPCs disagreed, name not set up…): the snapshot, if any, is stale */
  error: string | null;
  errorAt: number | null;
}

export type SiteState =
  | { kind: 'none' }
  | { kind: 'blocklisted'; protocol: string; domain: string }
  | { kind: 'protocol'; protocol: string; verdict: SiteVerdict | 'checking' | 'compromised' | 'stale'; unknown: CodeItem[]; unreadable: CodeItem[] };

export interface Stats {
  sitesChecked: number;
  verified: number;
  mismatched: number;
  unverifiable: number;
  unset: number;
  pagesBlocked: { compromised: number; blocklist: number; mismatch: number };
  requestsChecked: Record<RequestVerdict, number>;
  requestsBlocked: number;
  requestsAllowedAfterWarning: number;
  pageNoise: number;
  lastSync: number | null;
}

export const emptyStats = (): Stats => ({
  sitesChecked: 0,
  verified: 0,
  mismatched: 0,
  unverifiable: 0,
  unset: 0,
  pagesBlocked: { compromised: 0, blocklist: 0, mismatch: 0 },
  requestsChecked: { pass: 0, exit: 0, known: 0, unknown: 0, risky: 0, dangerous: 0 },
  requestsBlocked: 0,
  requestsAllowedAfterWarning: 0,
  pageNoise: 0,
  lastSync: null,
});

export interface PendingConfirm {
  id: string;
  tabId: number;
  origin: string;
  classification: Classification;
  /** why the extension escalated (site belongs to a followed protocol, etc.) */
  context: string | null;
  createdAt: number;
}

export type Decision = { decision: 'allow' | 'block'; verdict: RequestVerdict; reasons: string[] };

/** Everything the trusted pages render. */
export interface PublicState {
  settings: Settings;
  protocols: ProtocolState[];
  stats: Stats;
  pendingAddress: { address: Address; origin: string; at: number } | null;
  version: string;
}
