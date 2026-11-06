import { keccak256, parseAbi, stringToHex } from 'viem';
import { COPEYBARA_KEYS, type Address } from '@copeybara/core';
import { readRawTexts } from '@copeybara/ens';
import type { Quorum } from '@copeybara/quorum';
import { ROLE_SET_TEXT, ROOT_RESOURCE, resolverAbi, textResource } from './resolver';

export const ALL_KEYS = ['url', ...Object.values(COPEYBARA_KEYS)] as const;

const registryAbi = parseAbi(['function getOwner(uint256 anyId) view returns (address)']);
const safeAbi = parseAbi(['function getThreshold() view returns (uint256)', 'function getOwners() view returns (address[])', 'function nonce() view returns (uint256)']);

export interface OnChainState {
  block: bigint;
  /** Resolver the UniversalResolver used for the name. */
  resolver: Address;
  texts: Record<string, string>;
  /** roles[account][key] = role bitmap on that key's resource; roles[account].root = root roles. */
  roles: Record<string, Record<string, bigint>>;
  safe: { threshold: bigint; owners: Address[]; nonce: bigint } | null;
  /** Owner of `<label>.eth` in the ENSv2 .eth registry; null when not read (no registry given, or not a second-level .eth name). */
  owner?: Address | null;
}

/** `<label>` of a second-level .eth name, the only kind whose owner sits in the .eth registry. */
export const ethLabel = (name: string): string | null => /^([a-z0-9-]+)\.eth$/.exec(name.toLowerCase())?.[1] ?? null;

/** Everything verify / certify / propose compare against, read through the quorum at one pinned block. */
export async function readOnChain(o: {
  q: Quorum;
  name: string;
  universalResolver: Address;
  resolver: Address;
  safe: Address;
  accounts: Address[];
  /** ENSv2 .eth registry (config/networks.json ens.ethRegistry): also read who owns the name. */
  ethRegistry?: Address;
}): Promise<OnChainState> {
  const { texts, block, resolver } = await readRawTexts(o.name, ALL_KEYS, o.q, { universalResolver: o.universalResolver });
  const roles: Record<string, Record<string, bigint>> = {};
  for (const acct of o.accounts) {
    const r: Record<string, bigint> = {};
    const resources: [string, bigint][] = [['root', ROOT_RESOURCE], ...ALL_KEYS.map((k): [string, bigint] => [k, textResource(k)])];
    for (const [k, res] of resources) {
      r[k] = (await o.q.read({ address: o.resolver, abi: resolverAbi, functionName: 'roles', args: [res, acct] }, block)) as bigint;
    }
    roles[acct.toLowerCase()] = r;
  }
  let safe: OnChainState['safe'] = null;
  try {
    const [threshold, owners, nonce] = await Promise.all([
      o.q.read({ address: o.safe, abi: safeAbi, functionName: 'getThreshold' }, block) as Promise<bigint>,
      o.q.read({ address: o.safe, abi: safeAbi, functionName: 'getOwners' }, block) as Promise<Address[]>,
      o.q.read({ address: o.safe, abi: safeAbi, functionName: 'nonce' }, block) as Promise<bigint>,
    ]);
    safe = { threshold, owners: [...owners], nonce };
  } catch {
    safe = null;
  }
  const label = ethLabel(o.name);
  const owner =
    o.ethRegistry && label
      ? ((await o.q.read({ address: o.ethRegistry, abi: registryAbi, functionName: 'getOwner', args: [BigInt(keccak256(stringToHex(label)))] }, block)) as Address)
      : null;
  return { block, resolver, texts, roles, safe, owner };
}

/** Keys an account may write (ROLE_SET_TEXT on the key's resource or at the root). */
export function writableKeys(s: OnChainState, account: Address): string[] {
  const r = s.roles[account.toLowerCase()] ?? {};
  if (((r.root ?? 0n) & ROLE_SET_TEXT) !== 0n) return ['*'];
  return ALL_KEYS.filter((k) => ((r[k] ?? 0n) & ROLE_SET_TEXT) !== 0n);
}

export const hasAnyRootRole = (s: OnChainState, account: Address) => (s.roles[account.toLowerCase()]?.root ?? 0n) !== 0n;
