import { decodeFunctionData, getAddress, hexToString, type Hex } from 'viem';
import type { Address } from '@copeybara/core';
import type { CopeybaraConfig } from './config';
import { SAFE_KEYS, WATCHER_KEYS, WEBSITE_KEYS, dnsName, grantCall, resolverAbi, setTextCall, type SafeKey } from './resolver';
import { multiSend, txBuilderBatch, type SafeCall, type TxBuilderBatch } from './safe';

export interface ProposeInput {
  cfg: CopeybaraConfig;
  ensChainId: number;
  /** Desired record values. A key that is absent is left alone; "" clears it. */
  values: Partial<Record<SafeKey, string>>;
  /** On-chain values; unchanged records are skipped. Absent: write everything given. */
  current?: Partial<Record<string, string>>;
  /** Which scoped grants already exist ("<account>:<key>", lowercase). Absent: propose all of them. */
  granted?: Set<string>;
  grants: boolean;
  createdAt: number;
}

export interface Proposal {
  calls: SafeCall[];
  batch: TxBuilderBatch;
  multiSend: ReturnType<typeof multiSend>;
  skipped: string[];
}

export const grantId = (account: Address, key: string) => `${account.toLowerCase()}:${key}`;

export function buildProposal(i: ProposeInput): Proposal {
  const { cfg } = i;
  const calls: SafeCall[] = [];
  const skipped: string[] = [];
  for (const key of SAFE_KEYS) {
    const v = i.values[key];
    if (v === undefined) continue;
    if (i.current && i.current[key] === v) {
      skipped.push(`${key}: already published`);
      continue;
    }
    calls.push(setTextCall(cfg.resolver, cfg.name, key, v));
  }
  if (i.grants) {
    const want: [Address, string, string][] = [
      ...WEBSITE_KEYS.map((k): [Address, string, string] => [cfg.websiteKey, k, 'website key']),
      ...(cfg.watcher ? WATCHER_KEYS.map((k): [Address, string, string] => [cfg.watcher!.key, k, 'watcher']) : []),
    ];
    for (const [acct, key, who] of want) {
      if (i.granted?.has(grantId(acct, key))) skipped.push(`${who} → ${key}: already granted`);
      else calls.push(grantCall(cfg.resolver, cfg.name, key, getAddress(acct), who));
    }
  }
  assertBatchScope(calls, cfg);
  return {
    calls,
    batch: txBuilderBatch({ chainId: i.ensChainId, safe: cfg.safe, name: `Copeybara records for ${cfg.name}`, calls, createdAt: i.createdAt }),
    multiSend: multiSend(calls),
    skipped,
  };
}

/**
 * Every call in a batch is a resolver setText of a Safe-owned Copeybara key on this name, or one of the two scoped
 * grants (website key → url, watcher → status / blocklist). An incident batch may write status and blocklist only and
 * grants nothing. Anything else throws: the CLI never proposes it.
 */
export function assertBatchScope(calls: SafeCall[], cfg: CopeybaraConfig, o: { incident?: boolean } = {}): void {
  const name = dnsName(cfg.name);
  const writable: readonly string[] = o.incident ? WATCHER_KEYS : SAFE_KEYS;
  const allowedGrant = (acct: string, key: string) =>
    (acct.toLowerCase() === cfg.websiteKey.toLowerCase() && (WEBSITE_KEYS as readonly string[]).includes(key)) ||
    (!!cfg.watcher && acct.toLowerCase() === cfg.watcher.key.toLowerCase() && (WATCHER_KEYS as readonly string[]).includes(key));
  for (const c of calls) {
    if (c.to.toLowerCase() !== cfg.resolver.toLowerCase()) throw new Error(`batch call to ${c.to} is not the resolver`);
    const d = decodeFunctionData({ abi: resolverAbi, data: c.data });
    if (d.functionName === 'setText') {
      const [n, key] = d.args as [Hex, string, string];
      if (n !== name || !writable.includes(key)) throw new Error(`batch writes ${key} on ${hexToString(n)}`);
    } else if (d.functionName === 'grantSetterRoles' && !o.incident) {
      const [setter, acct] = d.args as [Hex, Address];
      const s = decodeFunctionData({ abi: resolverAbi, data: setter });
      if (s.functionName !== 'setText') throw new Error('grant is not scoped to setText');
      const [n, key, value] = s.args as [Hex, string, string];
      if (n !== name || value !== '' || !allowedGrant(acct, key)) throw new Error(`batch grants ${acct} write access to ${key}`);
    } else throw new Error(`batch calls ${d.functionName}`);
  }
}
