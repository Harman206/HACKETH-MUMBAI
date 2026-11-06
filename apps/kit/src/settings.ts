import { safeGet, safeSet } from './storage';

export interface Settings {
  /** Must be typed by the user from the protocol's docs. The kit ships with none. */
  ensName: string;
  targetChainId: number;
  /** User-entered RPC endpoints per chain ID, added to the quorum ahead of the public defaults. */
  userRpcs: Record<string, string[]>;
  slippageBps: number;
  /** When false, only the user's endpoints are used (e.g. a local fork). */
  useDefaultRpcs: boolean;
  /** Fire Drill only: the control page URL (localhost). Empty in normal use. */
  drillUrl: string;
}

export const DEFAULT_SETTINGS: Settings = { ensName: '', targetChainId: 11155111, userRpcs: {}, slippageBps: 50, useDefaultRpcs: true, drillUrl: '' };

const KEY = 'copeybara.settings.v1';
const isRpcUrl = (u: unknown): u is string => typeof u === 'string' && /^(https:\/\/|wss:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$))/.test(u);

export function loadSettings(): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(safeGet(KEY) ?? '{}') ?? {};
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const userRpcs: Record<string, string[]> = {};
  if (raw.userRpcs && typeof raw.userRpcs === 'object') {
    for (const [k, v] of Object.entries(raw.userRpcs)) if (/^\d+$/.test(k)) userRpcs[k] = Array.isArray(v) ? v.filter(isRpcUrl) : [];
  }
  return {
    ensName: typeof raw.ensName === 'string' ? raw.ensName : DEFAULT_SETTINGS.ensName,
    targetChainId: Number.isSafeInteger(raw.targetChainId) && raw.targetChainId! > 0 ? raw.targetChainId! : DEFAULT_SETTINGS.targetChainId,
    userRpcs,
    slippageBps:
      Number.isInteger(raw.slippageBps) && raw.slippageBps! >= 0 && raw.slippageBps! <= 500 ? raw.slippageBps! : DEFAULT_SETTINGS.slippageBps,
    useDefaultRpcs: typeof raw.useDefaultRpcs === 'boolean' ? raw.useDefaultRpcs : DEFAULT_SETTINGS.useDefaultRpcs,
    drillUrl: typeof raw.drillUrl === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(raw.drillUrl) ? raw.drillUrl.replace(/\/$/, '') : '',
  };
}

/** Quorum paths for a chain: the user's endpoints first, then the bundled public defaults (deduplicated). */
export function rpcUrlsFor(s: Settings, chainId: number, defaults: Record<string, string[]>): string[] {
  const mine = s.userRpcs[String(chainId)] ?? [];
  const pub = s.useDefaultRpcs ? (defaults[String(chainId)] ?? []) : [];
  return [...new Set([...mine, ...pub])];
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}

/** `?ens=` and `?drill=` (localhost only) from Attack Theater links. Only these two fields can be set this way. */
export function settingsFromUrl(href: string): Partial<Settings> {
  const out: Partial<Settings> = {};
  try {
    const u = new URL(href);
    const ens = u.searchParams.get('ens');
    if (ens && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(ens)) out.ensName = ens;
    const drill = u.searchParams.get('drill');
    if (drill && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(drill)) out.drillUrl = drill.replace(/\/$/, '');
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Apply link-provided settings for this session only. A protocol name from a link is flagged (the UI asks the user
 * to confirm it against the official docs) and never overwrites the saved name.
 */
export function mergeUrlSettings(saved: Settings, fromUrl: Partial<Settings>): { settings: Settings; persist: Settings; ensFromLink: string | null } {
  const settings = { ...saved, ...fromUrl };
  const ensFromLink = fromUrl.ensName && fromUrl.ensName !== saved.ensName ? fromUrl.ensName : null;
  const persist = { ...saved, ...(fromUrl.drillUrl !== undefined ? { drillUrl: fromUrl.drillUrl } : {}) };
  return { settings, persist, ensFromLink };
}
