import { readFile } from 'node:fs/promises';
import { getAddress, isAddress, parseAbiItem, toFunctionSelector, toFunctionSignature, type AbiFunction } from 'viem';
import {
  ADAPTER_IDS,
  BANNED_SELECTORS,
  EXIT_SELECTORS,
  SpecError,
  checkSpecAgainstManifest,
  encodeExitSpec,
  encodeManifest,
  parseManifest,
  validateExitSpec,
  type AdapterId,
  type ChainManifest,
  type ExitSpec,
  type Hex,
  type Manifest,
  type TargetEntry,
} from '@copeybara/core';
import { fromConfig, type LoadedConfig } from './config';

export interface ManifestBuild {
  manifest: Manifest;
  /** org.copeybara.manifest value */
  text: string;
  spec: ExitSpec | null;
  /** org.copeybara.exits value ("" when the config has no declarative exits) */
  specText: string;
  /** Anything here means: do not publish. */
  problems: string[];
  notes: string[];
}

/** Returns the deployed bytecode at an address, for proving a selector exists when no ABI is given. */
export type CodeReader = (chainId: number, address: `0x${string}`) => Promise<Hex | undefined>;

/** Canonical form of a signature, or null when it does not parse. */
export function canonicalFn(fn: string): string | null {
  try {
    const item = parseAbiItem(`function ${fn}` as string) as AbiFunction;
    if (item.type !== 'function') return null;
    return toFunctionSignature(item);
  } catch {
    return null;
  }
}

export async function abiSelectors(path: string): Promise<Set<Hex>> {
  const json = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const abi = Array.isArray(json) ? json : (json as { abi?: unknown }).abi;
  if (!Array.isArray(abi)) throw new Error(`${path} is not an ABI (expected an array or an object with "abi").`);
  return new Set(abi.filter((i: { type?: string }) => i.type === 'function').map((i) => toFunctionSelector(i as AbiFunction)));
}

/** PUSH4 <selector>: how solc and vyper dispatchers embed every external function's selector. */
export const bytecodeHasSelector = (code: Hex, sel: Hex) => code.toLowerCase().includes(`63${sel.slice(2).toLowerCase()}`);

/**
 * Build org.copeybara.manifest (and org.copeybara.exits) from the config, refusing anything the kit's Exit Guard would
 * not be able to check: every function must exist on the contract, must not be an approval / permit / transfer, and
 * must pay either the caller or a recipient argument the Guard decodes (a built-in adapter, or a declarative exit kind).
 */
export async function buildManifest(l: LoadedConfig, opts: { code?: CodeReader } = {}): Promise<ManifestBuild> {
  const { cfg } = l;
  const problems: string[] = [];
  const notes: string[] = [];
  const chains: Record<string, ChainManifest> = {};
  const usedKinds = new Set<string>();

  let spec: ExitSpec | null = null;
  if (cfg.exits && Object.keys(cfg.exits).length) {
    try {
      spec = validateExitSpec({ v: 1, kinds: cfg.exits });
    } catch (e) {
      problems.push(e instanceof SpecError ? `exits: ${e.message}` : String(e));
    }
  }

  for (const [chainId, protos] of Object.entries(cfg.chains)) {
    if (!/^[1-9][0-9]*$/.test(chainId)) {
      problems.push(`chains["${chainId}"]: chain IDs are decimal integers`);
      continue;
    }
    const cm: ChainManifest = {};
    for (const [proto, roles] of Object.entries(protos ?? {})) {
      const where0 = `chains["${chainId}"].${proto}`;
      if (!(ADAPTER_IDS as readonly string[]).includes(proto)) {
        problems.push(`${where0}: unknown protocol. Use one of ${ADAPTER_IDS.join(', ')} ("spec" for declarative exits).`);
        continue;
      }
      const adapter = proto as AdapterId;
      const entries: Record<string, TargetEntry> = {};
      for (const [role, c] of Object.entries(roles ?? {})) {
        const where = `${where0}.${role}`;
        if (!isAddress(String(c.address), { strict: false })) {
          problems.push(`${where}: invalid address`);
          continue;
        }
        const address = getAddress(c.address);
        const fns = c.functions ?? [];
        const selectors: Hex[] = [];
        let have: Set<Hex> | null = null;
        if (c.abi) {
          try {
            have = await abiSelectors(fromConfig(l, c.abi));
          } catch (e) {
            problems.push(`${where}: ${(e as Error).message}`);
          }
        }
        let code: Hex | undefined;
        if (!have && fns.length && opts.code) code = await opts.code(Number(chainId), address);
        if (!have && fns.length && opts.code && (!code || code === '0x')) problems.push(`${where}: no contract deployed at ${address} on chain ${chainId}`);

        if (adapter === 'spec') {
          usedKinds.add(role);
          if (!cfg.exits?.[role]) problems.push(`${where}: no exit kind "${role}" under exits — the Guard could not decode this contract's calls.`);
          if (fns.length !== 1) problems.push(`${where}: a declarative exit contract allows exactly one function (exits.${role}.exit.fn).`);
        } else {
          const known = (EXIT_SELECTORS as Record<string, Record<string, readonly Hex[]>>)[adapter]?.[role];
          if (!known) problems.push(`${where}: the ${adapter} adapter has no role "${role}" (roles: ${Object.keys((EXIT_SELECTORS as Record<string, object>)[adapter] ?? {}).join(', ')}).`);
        }

        for (const fn of fns) {
          const canon = canonicalFn(fn);
          if (!canon) {
            problems.push(`${where}: "${fn}" is not a function signature`);
            continue;
          }
          if (canon !== fn) {
            problems.push(`${where}: write "${fn}" in canonical form "${canon}"`);
            continue;
          }
          const sel = toFunctionSelector(`function ${fn}`);
          if (BANNED_SELECTORS.has(sel)) {
            problems.push(`${where}: ${fn} moves or approves tokens; it can never be an exit function.`);
            continue;
          }
          if (have && !have.has(sel)) problems.push(`${where}: ${fn} (${sel}) is not in the ABI ${c.abi}`);
          else if (!have && code && code !== '0x' && !bytecodeHasSelector(code, sel)) {
            problems.push(`${where}: ${fn} (${sel}) is not in the bytecode at ${address}`);
          } else if (!have && !code && adapter === 'spec') {
            problems.push(`${where}: give an abi path or run with an RPC (--onchain) so ${fn} can be proven to exist`);
          }
          if (adapter === 'spec') {
            const kind = cfg.exits?.[role];
            if (kind && kind.exit.fn !== fn) problems.push(`${where}: ${fn} is not exits.${role}.exit.fn (${kind.exit.fn})`);
          } else {
            const known = (EXIT_SELECTORS as Record<string, Record<string, readonly Hex[]>>)[adapter]?.[role] ?? [];
            if (!known.includes(sel)) {
              problems.push(`${where}: the Guard cannot check who ${fn} pays for ${adapter}. Describe it under exits (adapter "spec") or write an adapter (copeybara adapter new).`);
            }
          }
          selectors.push(sel);
        }
        if (!have && !opts.code && adapter !== 'spec' && fns.length) notes.push(`${where}: built-in ${adapter} selectors; pass --onchain to also check the bytecode`);
        entries[role] = { address, selectors };
      }
      if (Object.keys(entries).length) cm[adapter] = entries;
    }
    chains[chainId] = cm;
  }

  for (const k of Object.keys(cfg.exits ?? {})) if (!usedKinds.has(k)) notes.push(`exits.${k}: no chains[*].spec.${k} contract uses it`);

  const manifest: Manifest = { v: 1, chains };
  const text = encodeManifest(manifest);
  try {
    parseManifest(text);
  } catch (e) {
    problems.push(`the manifest codec rejects the result: ${(e as Error).message}`);
  }
  if (!problems.length) problems.push(...checkSpecAgainstManifest(spec, manifest));
  return { manifest, text, spec, specText: spec ? encodeExitSpec(spec) : '', problems, notes };
}
