/**
 * Extension build proof. The ENS record org.copeybara.extension holds the zip's sha256, but an installed (unpacked)
 * extension cannot see its zip. The TREE HASH can be computed both from the build output and from inside the running
 * extension:
 *
 *   tree = sha256( for each file, sorted by path: "<path>\t<sha256 of the file bytes>\n" )
 *
 * Paths are relative to the unpacked folder with '/' separators. Every file of the build is included, build-files.json
 * too: it lists every path (itself included) so the worker knows what to fetch, and is hashed like any other file.
 * Same algorithm in scripts/build.mjs (node) and scripts/verify-extension.sh (shell); tests cross-check all three.
 */

export const BUILD_FILES = 'build-files.json';
const HEX64 = /^[0-9a-f]{64}$/;
const PATH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const MAX_FILES = 2000;

export interface TreeEntry {
  path: string;
  sha256: string;
}

/** 'local-audio': the only difference from the published tree is the user's own song under audio/ (never in a release) */
export type BuildProofVerdict = 'match' | 'mismatch' | 'no-record' | 'old-record' | 'local-audio';

/** What the worker answers to {t:'buildProof'} (or { error } when a file could not be read). */
export interface BuildProof {
  /** manifest.json version of the installed extension */
  version: string;
  /** tree hash of the installed files */
  treeHash: string;
  /** number of files hashed */
  files: number;
  /** the followed protocol's org.copeybara.extension record compared with; null when none publishes one */
  ens: { name: string; version: number; tree: string | null; zip: string } | null;
  verdict: BuildProofVerdict;
}

export function treeLines(entries: TreeEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    if (!HEX64.test(sorted[i]!.sha256)) throw new Error(`${sorted[i]!.path} has no valid sha256 hash.`);
    if (i > 0 && sorted[i]!.path === sorted[i - 1]!.path) throw new Error(`${sorted[i]!.path} is listed twice.`);
  }
  return sorted.map((e) => `${e.path}\t${e.sha256}\n`).join('');
}

export async function sha256Bytes(bytes: Uint8Array | string): Promise<string> {
  const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const d = await globalThis.crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function treeHash(entries: TreeEntry[]): Promise<string> {
  return sha256Bytes(treeLines(entries));
}

/** build-files.json = {"v":1,"files":[sorted relative paths]}; must list manifest.json and itself. */
export function parseBuildFiles(text: string): string[] {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`${BUILD_FILES} is not JSON.`);
  }
  const o = j as { v?: unknown; files?: unknown };
  if (!o || o.v !== 1 || !Array.isArray(o.files) || o.files.length > MAX_FILES) throw new Error(`${BUILD_FILES} must be {"v":1,"files":[…]}.`);
  const files = o.files as unknown[];
  for (let i = 0; i < files.length; i++) {
    const p = files[i];
    if (typeof p !== 'string' || !PATH_RE.test(p) || p.split('/').some((s) => s === '.' || s === '..')) throw new Error(`${BUILD_FILES} lists a path that is not a plain relative path: ${JSON.stringify(p)}.`);
    if (i > 0 && !((files[i - 1] as string) < p)) throw new Error(`${BUILD_FILES} is not sorted or repeats a path.`);
  }
  const paths = files as string[];
  if (!paths.includes(BUILD_FILES) || !paths.includes('manifest.json')) throw new Error(`${BUILD_FILES} must list manifest.json and itself.`);
  return paths;
}

/** Optional celebration song a user can drop in locally (src/pages/audio/, gitignored): never part of a release. */
export const LOCAL_AUDIO_DIR = 'audio/';
export const isLocalAudio = (path: string) => path.startsWith(LOCAL_AUDIO_DIR);
/** build-files.json exactly as scripts/build.mjs writes it */
export const buildFilesText = (paths: string[]) => JSON.stringify({ v: 1, files: [...paths].sort() }) + '\n';

/**
 * The tree hash this build would have without the files under audio/ (and with build-files.json listing only the
 * rest), or null when there are none. Lets a local build with the user's own song be told apart from a tampered one.
 */
export async function treeWithoutAudio(entries: TreeEntry[]): Promise<string | null> {
  if (!entries.some((e) => isLocalAudio(e.path))) return null;
  const kept = entries.filter((e) => !isLocalAudio(e.path) && e.path !== BUILD_FILES);
  const listing = buildFilesText([...kept.map((e) => e.path), BUILD_FILES]);
  return treeHash([...kept, { path: BUILD_FILES, sha256: await sha256Bytes(listing) }]);
}
