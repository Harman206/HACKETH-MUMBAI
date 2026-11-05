/** Browser storage is a per-viewer convenience only. Every access is wrapped: it can throw or be empty. */
export function safeGet(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* private mode, blocked storage, quota: ignore */
  }
}

const VKEY = (name: string) => `blackout.maxSeenRelease.${name}`;

/** Highest release version this browser has seen for `name` (0 if none). Used to warn on rollback. */
export function maxSeenVersion(name: string): number {
  const v = Number(safeGet(VKEY(name)));
  return Number.isSafeInteger(v) && v > 0 ? v : 0;
}

export function recordSeenVersion(name: string, version: number): void {
  if (version > maxSeenVersion(name)) safeSet(VKEY(name), String(version));
}
