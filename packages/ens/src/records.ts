import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, namehash, toHex, type Hex } from 'viem';
import { normalize, packetToBytes } from 'viem/ens';
import {
  parseManifest,
  parseRelease,
  textResolverAbi,
  universalResolverAbi,
  type Address,
  type Manifest,
  type ReleaseRecord,
} from '@blackout/core';
import { CallRevertedError, type Quorum } from '@blackout/quorum';

export const ENS_KEYS = ['url', 'org.blackout.release', 'org.blackout.manifest', 'org.blackout.site'] as const;
export type EnsKey = (typeof ENS_KEYS)[number];

export interface BlackoutRecords {
  name: string;
  url: string | null;
  release: ReleaseRecord;
  manifest: Manifest;
  site: string | null;
  block: bigint;
  resolver: Address;
}

export class RecordsError extends Error {
  override name = 'RecordsError';
  constructor(
    public readonly key: EnsKey | 'name',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
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
 * Read every BLACKOUT record for `name` through the quorum, all at one pinned block.
 * The name must come from the protocol's docs, never from the kit.
 */
export async function readBlackoutRecords(
  rawName: string,
  q: Quorum,
  cfg: { universalResolver: Address },
): Promise<BlackoutRecords> {
  const name = normaliseName(rawName);
  const block = await q.pinBlock();
  const got = await Promise.all(ENS_KEYS.map((k) => readText(name, k, q, cfg.universalResolver, block)));
  const t = Object.fromEntries(ENS_KEYS.map((k, i) => [k, got[i]!.text])) as Record<EnsKey, string>;

  if (!t['org.blackout.release']) {
    throw new RecordsError('org.blackout.release', `${name} has no release record, so this kit cannot be checked against it.`);
  }
  let release: ReleaseRecord;
  try {
    release = parseRelease(t['org.blackout.release']);
  } catch (e) {
    throw new RecordsError('org.blackout.release', `The release record on ${name} is malformed: ${(e as Error).message}`, { cause: e });
  }
  if (!t['org.blackout.manifest']) {
    throw new RecordsError('org.blackout.manifest', `${name} has no exit manifest record.`);
  }
  let manifest: Manifest;
  try {
    manifest = parseManifest(t['org.blackout.manifest']);
  } catch (e) {
    throw new RecordsError('org.blackout.manifest', `The exit manifest on ${name} is unusable: ${(e as Error).message}`, { cause: e });
  }
  return {
    name,
    url: t.url || null,
    release,
    manifest,
    site: t['org.blackout.site'] || null,
    block,
    resolver: got[0]!.resolver,
  };
}
