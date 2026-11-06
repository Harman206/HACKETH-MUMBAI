import type { ReleaseRecord } from './types';

export class ReleaseError extends Error {
  override name = 'ReleaseError';
}

const RELEASE_RE = /^sha256:([0-9a-f]{64});v=([1-9][0-9]*)(?:;tree=([0-9a-f]{64}))?$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Parse `sha256:<64 lowercase hex>;v=<positive integer>[;tree=<64 lowercase hex>]`.
 * `tree` is the extension build proof (a hash over the unpacked files, see apps/extension/src/shared/buildproof.ts);
 * records written before it existed have no `tree` and still parse.
 */
export function parseRelease(text: string): ReleaseRecord {
  const m = RELEASE_RE.exec(text.trim());
  if (!m) throw new ReleaseError('The release record is not in the form sha256:<hash>;v=<version>[;tree=<hash>].');
  const version = Number(m[2]);
  if (!Number.isSafeInteger(version)) throw new ReleaseError('The release version is too large.');
  return m[3] ? { sha256: m[1]!, version, tree: m[3] } : { sha256: m[1]!, version };
}

export function formatRelease(r: ReleaseRecord): string {
  if (r.tree === undefined) return `sha256:${r.sha256};v=${r.version}`;
  if (!HEX64.test(r.tree)) throw new ReleaseError('The tree hash must be 64 lowercase hex characters.');
  return `sha256:${r.sha256};v=${r.version};tree=${r.tree}`;
}
