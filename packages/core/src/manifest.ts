import { getAddress, isAddress } from 'viem';
import { ADAPTER_IDS, type AdapterId, type ChainManifest, type Hex, type Manifest, type TargetEntry } from './types';

export class ManifestError extends Error {
  override name = 'ManifestError';
}

const SELECTOR_RE = /^0x[0-9a-f]{8}$/;
const CHAIN_RE = /^[1-9][0-9]*$/;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Parse the compact wire form of org.blackout.manifest. Throws ManifestError with a plain message. */
export function parseManifest(text: string): Manifest {
  if (!text || !text.trim()) throw new ManifestError('The exit manifest record is empty.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError('The exit manifest record is not valid JSON.');
  }
  if (!isObj(raw)) throw new ManifestError('The exit manifest record is not an object.');
  if (raw.v !== 1) throw new ManifestError(`The exit manifest has an unsupported version (${String(raw.v)}).`);
  if (!isObj(raw.c)) throw new ManifestError('The exit manifest has no chain list.');

  const chains: Record<string, ChainManifest> = {};
  const unknown: string[] = [];
  for (const [chainId, protos] of Object.entries(raw.c)) {
    if (!CHAIN_RE.test(chainId)) throw new ManifestError(`The exit manifest lists an invalid chain ID "${chainId}".`);
    if (!isObj(protos)) throw new ManifestError(`Chain ${chainId} in the exit manifest is not an object.`);
    const cm: ChainManifest = {};
    for (const [proto, targets] of Object.entries(protos)) {
      // Forward compatible: a newer manifest may list protocols an older saved kit does not know.
      // They are skipped (so never become allowed targets) instead of making the whole record unusable.
      if (!(ADAPTER_IDS as readonly string[]).includes(proto)) {
        unknown.push(`${proto} on chain ${chainId}`);
        continue;
      }
      if (!isObj(targets)) throw new ManifestError(`Protocol ${proto} on chain ${chainId} is not an object.`);
      const entries: Record<string, TargetEntry> = {};
      for (const [role, t] of Object.entries(targets)) {
        entries[role] = parseTarget(t, `${proto}.${role} on chain ${chainId}`);
      }
      cm[proto as AdapterId] = entries;
    }
    chains[chainId] = cm;
  }
  return unknown.length ? { v: 1, chains, unknown } : { v: 1, chains };
}

function parseTarget(t: unknown, where: string): TargetEntry {
  if (!isObj(t)) throw new ManifestError(`${where} is not an object.`);
  if (typeof t.a !== 'string' || !isAddress(t.a, { strict: false })) {
    throw new ManifestError(`${where} has an invalid address.`);
  }
  if (!Array.isArray(t.s)) throw new ManifestError(`${where} has no selector list.`);
  const selectors = t.s.map((s) => {
    if (typeof s !== 'string' || !SELECTOR_RE.test(s)) {
      throw new ManifestError(`${where} has an invalid selector "${String(s)}".`);
    }
    return s as Hex;
  });
  return { address: getAddress(t.a), selectors };
}

const sortKeys = <T>(o: Record<string, T>): [string, T][] => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Encode to the compact wire form with stable key order (chain, protocol, role sorted). */
export function encodeManifest(m: Manifest): string {
  const c: Record<string, Record<string, Record<string, { a: string; s: string[] }>>> = {};
  for (const [chainId, cm] of sortKeys(m.chains)) {
    const protos: Record<string, Record<string, { a: string; s: string[] }>> = {};
    for (const [proto, targets] of sortKeys(cm as Record<string, Record<string, TargetEntry>>)) {
      const roles: Record<string, { a: string; s: string[] }> = {};
      for (const [role, t] of sortKeys(targets)) roles[role] = { a: t.address, s: [...t.selectors] };
      protos[proto] = roles;
    }
    c[chainId] = protos;
  }
  return JSON.stringify({ v: 1, c });
}
