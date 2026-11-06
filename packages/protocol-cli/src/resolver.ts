import { encodeFunctionData, keccak256, parseAbi, stringToHex, toHex, type Hex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { COPEYBARA_KEYS, type Address } from '@copeybara/core';
import type { SafeCall } from './safe';

export const resolverAbi = parseAbi([
  'function setText(bytes name, string key, string value)',
  'function grantSetterRoles(bytes setter, address account) returns (bool)',
  'function roles(uint256 resource, address account) view returns (uint256)',
]);

/** PermissionedResolverLib / EACBaseRolesLib (contracts/src/interfaces/IENSv2.sol). */
export const ROLE_SET_TEXT = 1n << 4n;
export const ROOT_RESOURCE = 0n;
/** Resolver resource for a text key (ENS docs, Resource Scheme). */
export const textResource = (key: string) => BigInt(keccak256(stringToHex(key)));

/** Records the Safe writes through `propose`. status / blocklist belong to the watcher, url to the website key. */
export const SAFE_KEYS = [
  COPEYBARA_KEYS.release,
  COPEYBARA_KEYS.manifest,
  COPEYBARA_KEYS.exits,
  COPEYBARA_KEYS.site,
  COPEYBARA_KEYS.extension,
] as const;
export type SafeKey = (typeof SAFE_KEYS)[number];

/** The only grants the CLI ever proposes: website key → url; watcher → status + blocklist. */
export const WEBSITE_KEYS = ['url'] as const;
export const WATCHER_KEYS = [COPEYBARA_KEYS.status, COPEYBARA_KEYS.blocklist] as const;

export const dnsName = (name: string): Hex => toHex(packetToBytes(name));

export function setTextCall(resolver: Address, name: string, key: SafeKey, value: string): SafeCall {
  if (!(SAFE_KEYS as readonly string[]).includes(key)) throw new Error(`The Safe batch never writes ${key}.`);
  const shown = value.length > 80 ? `${value.slice(0, 77)}…` : value || '(clear)';
  return { to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsName(name), key, value] }), label: `setText ${key} = ${shown}` };
}

/** Argument-scoped grant: ROLE_SET_TEXT for exactly this name + key, nothing else. */
export function grantCall(resolver: Address, name: string, key: string, account: Address, who: string): SafeCall {
  const setter = encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsName(name), key, ''] });
  return { to: resolver, data: encodeFunctionData({ abi: resolverAbi, functionName: 'grantSetterRoles', args: [setter, account] }), label: `grant ${who} ${account} write access to ${key} only` };
}
