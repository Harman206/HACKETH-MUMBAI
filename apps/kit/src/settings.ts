import { safeGet, safeSet } from './storage';

export interface Settings {
  /** Must be typed by the user from the protocol's docs. The kit ships with none. */
  ensName: string;
  targetChainId: number;
  /** User-entered RPC endpoints per chain ID, added to the quorum ahead of the public defaults. */
  userRpcs: Record<string, string[]>;
  slippageBps: number;
}

export const DEFAULT_SETTINGS: Settings = { ensName: '', targetChainId: 11155111, userRpcs: {}, slippageBps: 50 };

const KEY = 'blackout.settings.v1';
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
  };
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}
