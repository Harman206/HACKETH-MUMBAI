import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, namehash, toHex, type Hex } from 'viem';
import { normalize, packetToBytes } from 'viem/ens';
import {
  COPEYBARA_KEYS,
  parseBlocklist,
  parseManifest,
  parseRelease,
  parseSiteRecord,
  parseStatus,
  textResolverAbi,
  universalResolverAbi,
  type Address,
  type Manifest,
  type ReleaseRecord,
  type StatusRecord,
} from '@copeybara/core';
import { CallRevertedError, type Quorum } from '@copeybara/quorum';

/** Every record Copeybara reads from a protocol's name. `url` is written by the website key, the rest by the Safe
 * (status / blocklist also by the watcher key). org.blackout.* records stay on chain, frozen, for kits saved before the rename. */
export const ENS_KEYS = [
  'url',
  COPEYBARA_KEYS.release,
  COPEYBARA_KEYS.manifest,
  COPEYBARA_KEYS.site,
  COPEYBARA_KEYS.extension,
  COPEYBARA_KEYS.status,
  COPEYBARA_KEYS.blocklist,
] as const;
export type EnsKey = (typeof ENS_KEYS)[number];

export interface RecordProblem {
  key: EnsKey;
  message: string;
}

export interface CopeybaraRecords {
  name: string;
  url: string | null;
  release: ReleaseRecord;
  manifest: Manifest;
  /** allowed script hashes; null = no fingerprint published (or unreadable: see problems) */
  site: string[] | null;
  /** extension zip release; null when not published */
  extension: ReleaseRecord | null;
  /** null only when the record is malformed (see problems); an empty record is { state: 'ok' } */
  status: StatusRecord | null;
  blocklist: string[];
  /** optional records that were present but unreadable: they never stop an exit, but callers must not show them as fine */
  problems: RecordProblem[];
  block: bigint;
  resolver: Address;
}

export class RecordsError extends Error {
  override name = 'RecordsError';
  readonly key: EnsKey | 'name';
  constructor(key: EnsKey | 'name', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.key = key;
  }
}

/** Normalise (UTS-46) and require at least "label.tld". */
export function normaliseName(input: string): string {
  let n: string;
  try {
    n = normalize(input.trim());
  } catch (e) {
    throw new RecordsError('name', `"${input}" is not a valid ENS name.`, { cause: e });
  }
  if (!/^[^.]+(\.[^.]+)+$/.test(n)) throw new RecordsError('name', `"${input}" is not a full ENS name like protocol.eth.`);
  return n;
}

async function readText(name: string, key: EnsKey, q: Quorum, ur: Address, block: bigint): Promise<{ text: string; resolver: Address }> {
  const inner = encodeFunctionData({ abi: textResolverAbi, functionName: 'text', args: [namehash(name), key] });
  const data = encodeFunctionData({ abi: universalResolverAbi, functionName: 'resolve', args: [toHex(packetToBytes(name)), inner] });
  let out: Hex;
  try {
    out = await q.call({ to: ur, data }, block);
  } catch (e) {
    if (e instanceof CallRevertedError) {
      throw new RecordsError(key, `${name} is not set up on ENS (no resolver, or the resolver refused the lookup).`, { cause: e });
    }
    throw e;
  }
  const [result, resolver] = decodeAbiParameters([{ type: 'bytes' }, { type: 'address' }], out);
  const text = decodeFunctionResult({ abi: textResolverAbi, functionName: 'text', data: result });
  return { text, resolver };
}

/**
 * Read every Copeybara record for `name` through the quorum, all at one pinned block.
 * The name must come from the protocol's docs, never from the kit. release + manifest are required;
 * the optional records are reported in `problems` when malformed instead of stopping the read.
 */
export async function readCopeybaraRecords(
  rawName: string,
  q: Quorum,
  cfg: { universalResolver: Address },
): Promise<CopeybaraRecords> {
  const name = normaliseName(rawName);
  const block = await q.pinBlock();
  const got = await Promise.all(ENS_KEYS.map((k) => readText(name, k, q, cfg.universalResolver, block)));
  const t = Object.fromEntries(ENS_KEYS.map((k, i) => [k, got[i]!.text])) as Record<EnsKey, string>;
  const K = COPEYBARA_KEYS;

  if (!t[K.release]) throw new RecordsError(K.release, `${name} has no release record, so this kit cannot be checked against it.`);
  let release: ReleaseRecord;
  try {
    release = parseRelease(t[K.release]);
  } catch (e) {
    throw new RecordsError(K.release, `The release record on ${name} is malformed: ${(e as Error).message}`, { cause: e });
  }
  if (!t[K.manifest]) throw new RecordsError(K.manifest, `${name} has no exit manifest record.`);
  let manifest: Manifest;
  try {
    manifest = parseManifest(t[K.manifest]);
  } catch (e) {
    throw new RecordsError(K.manifest, `The exit manifest on ${name} is unusable: ${(e as Error).message}`, { cause: e });
  }

  const problems: RecordProblem[] = [];
  const optional = <T>(key: EnsKey, parse: (s: string) => T, fallback: T): T => {
    try {
      return parse(t[key]);
    } catch (e) {
      problems.push({ key, message: (e as Error).message });
      return fallback;
    }
  };
  return {
    name,
    url: t.url || null,
    release,
    manifest,
    site: optional(K.site, parseSiteRecord, null),
    extension: t[K.extension] ? optional<ReleaseRecord | null>(K.extension, parseRelease, null) : null,
    status: optional<StatusRecord | null>(K.status, parseStatus, null),
    blocklist: optional(K.blocklist, parseBlocklist, []),
    problems,
    block,
    resolver: got[0]!.resolver,
  };
}
