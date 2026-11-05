import type { ReleaseRecord } from './types';

export class ReleaseError extends Error {
  override name = 'ReleaseError';
}

const RELEASE_RE = /^sha256:([0-9a-f]{64});v=([1-9][0-9]*)$/;

/** Parse `sha256:<64 lowercase hex>;v=<positive integer>`. */
export function parseRelease(text: string): ReleaseRecord {
  const m = RELEASE_RE.exec(text.trim());
  if (!m) throw new ReleaseError('The release record is not in the form sha256:<hash>;v=<version>.');
  const version = Number(m[2]);
  if (!Number.isSafeInteger(version)) throw new ReleaseError('The release version is too large.');
  return { sha256: m[1]!, version };
}

export function formatRelease(r: ReleaseRecord): string {
  return `sha256:${r.sha256};v=${r.version}`;
}
