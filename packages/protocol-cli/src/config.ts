import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAddress } from 'viem';
import type { AdapterId, Address, ExitKind } from '@copeybara/core';
import networks from '../../../config/networks.json';

/** One contract the kit may call (or read). */
export interface ContractConfig {
  address: Address;
  /** Canonical signatures the kit may call, e.g. "redeem(uint256,address,address)". Empty or absent: read-only reference. */
  functions?: string[];
  /** JSON ABI (plain array, or a Foundry / Hardhat artifact with an `abi` field) proving the functions exist. */
  abi?: string;
}

export interface CopeybaraConfig {
  /** The protocol's ENS name, e.g. "demoswap.eth". */
  name: string;
  /** Safe that owns the name and its resolver. Every record write is proposed to it; the CLI never signs. */
  safe: Address;
  /** The name's PermissionedResolver. */
  resolver: Address;
  /** Website deploy key: may write `url` only. */
  websiteKey: Address;
  /** Watcher key: may write org.copeybara.status and org.copeybara.blocklist only. */
  watcher?: {
    key: Address;
    /** Look-alike site URLs the watcher checks against org.copeybara.site. */
    candidates?: string[];
    intervalMs?: number;
  };
  /** Chain the ENS name lives on. Default 11155111 (Sepolia, ENSv2). */
  ensChainId?: number;
  universalResolver?: Address;
  /** ENSv2 .eth registry, to check the Safe owns the name. Default: config/networks.json (Sepolia). */
  ethRegistry?: Address;
  /** At least 3 RPCs per chain for quorum reads. Defaults: config/networks.json. */
  rpcs?: Record<string, string[]>;
  kit: { file: string; version: number };
  extension?: { file: string; version: number; tree?: string };
  site?: { url: string; dist?: string };
  /** Exit contracts per decimal chain ID: chains[chainId][adapter][role]. Use adapter "spec" for contracts exited by `exits`. */
  chains: Record<string, Partial<Record<AdapterId, Record<string, ContractConfig>>>>;
  /** Declarative exits (org.copeybara.exits). Each key is a role under chains[*].spec. */
  exits?: Record<string, ExitKind>;
  /** Safe Transaction Service base URL, for `propose --api`. */
  safeTxService?: string;
  /** Where commands write their outputs. Default ".copeybara". */
  out?: string;
  /** `copeybara drill`: which exit chain to fork and how to give the drill user a position there (test fork only). */
  drill?: {
    chainId?: number;
    user?: Address;
    seed?: (o: { fork: import('@copeybara/testkit').Fork; user: Address }) => Promise<void>;
  };
}

/** Identity function that gives `copeybara.config.ts` type checking. */
export const defineConfig = (c: CopeybaraConfig): CopeybaraConfig => c;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface LoadedConfig {
  cfg: CopeybaraConfig;
  /** Directory relative paths in the config resolve against. */
  dir: string;
}

export async function loadConfig(file = 'copeybara.config.ts'): Promise<LoadedConfig> {
  const path = resolve(file);
  let raw: unknown;
  try {
    raw = path.endsWith('.json') ? JSON.parse(await readFile(path, 'utf8')) : ((await import(pathToFileURL(path).href)) as { default: unknown }).default;
  } catch (e) {
    throw new ConfigError(`Could not load ${file}: ${(e as Error).message}`);
  }
  return { cfg: checkConfig(raw), dir: dirname(path) };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Shape checks only; what the records will say is checked by `manifest`. */
export function checkConfig(raw: unknown): CopeybaraConfig {
  if (!isObj(raw)) throw new ConfigError('The config must export an object (use defineConfig).');
  const c = raw as Partial<CopeybaraConfig>;
  const errs: string[] = [];
  if (typeof c.name !== 'string' || !/^[^.\s]+(\.[^.\s]+)*\.eth$/.test(c.name.trim().toLowerCase())) errs.push('name: an ENS name ending in .eth');
  for (const k of ['safe', 'resolver', 'websiteKey'] as const) {
    if (typeof c[k] !== 'string' || !isAddress(c[k] as string, { strict: false })) errs.push(`${k}: an address`);
  }
  if (c.watcher !== undefined && (!isObj(c.watcher) || !isAddress(String(c.watcher.key), { strict: false }))) errs.push('watcher.key: an address');
  if (c.watcher && [c.safe, c.websiteKey].some((a) => a?.toLowerCase() === c.watcher!.key.toLowerCase())) {
    errs.push('watcher.key must be its own key, not the Safe or the website key');
  }
  if (c.websiteKey && c.safe && c.websiteKey.toLowerCase() === c.safe.toLowerCase()) errs.push('websiteKey must not be the Safe');
  if (!isObj(c.kit) || typeof c.kit.file !== 'string' || !Number.isSafeInteger(c.kit.version) || c.kit.version < 1) {
    errs.push('kit: { file, version ≥ 1 }');
  }
  if (c.extension !== undefined && (!isObj(c.extension) || typeof c.extension.file !== 'string' || !Number.isSafeInteger(c.extension.version))) {
    errs.push('extension: { file, version }');
  }
  if (c.site !== undefined && (!isObj(c.site) || typeof c.site.url !== 'string')) errs.push('site: { url, dist? }');
  if (!isObj(c.chains) || !Object.keys(c.chains).length) errs.push('chains: at least one chain of exit contracts');
  if (c.exits !== undefined && !isObj(c.exits)) errs.push('exits: an object of exit kinds');
  if (errs.length) throw new ConfigError(`copeybara config:\n  ${errs.join('\n  ')}`);
  return c as CopeybaraConfig;
}

export const ensChainId = (c: CopeybaraConfig) => c.ensChainId ?? networks.ens.chainId;
export const universalResolver = (c: CopeybaraConfig) => (c.universalResolver ?? networks.ens.universalResolver) as Address;
/** The ENSv2 .eth registry that records who owns the name (known for Sepolia only). */
export const ethRegistry = (c: CopeybaraConfig) => (c.ethRegistry ?? (ensChainId(c) === networks.ens.chainId ? networks.ens.ethRegistry : undefined)) as Address | undefined;

export function rpcsFor(c: CopeybaraConfig, chainId: number): string[] {
  const urls = c.rpcs?.[String(chainId)] ?? (networks.defaultRpcs as Record<string, string[]>)[String(chainId)];
  if (!urls?.length) throw new ConfigError(`No RPCs for chain ${chainId}: add rpcs["${chainId}"] (3 independent providers) to the config.`);
  return urls;
}

export const outDir = (l: LoadedConfig) => resolve(l.dir, l.cfg.out ?? '.copeybara');
export const fromConfig = (l: LoadedConfig, p: string) => resolve(l.dir, p);
