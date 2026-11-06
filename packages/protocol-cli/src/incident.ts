import { encodeFunctionData } from 'viem';
import { COPEYBARA_KEYS, formatBlocklist, formatStatus, parseBlocklist, type StatusState } from '@copeybara/core';
import type { CopeybaraConfig } from './config';
import { assertBatchScope } from './propose';
import { dnsName, resolverAbi } from './resolver';
import { multiSend, txBuilderBatch, type SafeCall } from './safe';

export interface IncidentInput {
  cfg: CopeybaraConfig;
  ensChainId: number;
  state: StatusState;
  note?: string;
  /** Look-alike hosts to add to the blocklist (kept with what is already published). */
  block?: string[];
  /** Hosts to take off the blocklist (e.g. a false alarm). */
  unblock?: string[];
  currentBlocklist: string;
  now: number;
  createdAt?: number;
}

/**
 * The Safe's incident batch: org.copeybara.status, and optionally org.copeybara.blocklist. These only warn about or block
 * websites in the extension; nothing here can block an exit. A compromised status set by the Safe stays until the Safe
 * clears it (the watcher only clears alarms it raised).
 */
export function buildIncident(i: IncidentInput) {
  const { cfg } = i;
  const calls: SafeCall[] = [];
  const status = formatStatus({ state: i.state, at: Math.floor(i.now / 1000), note: i.note });
  const set = (key: string, value: string, label: string): SafeCall => ({
    to: cfg.resolver,
    data: encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsName(cfg.name), key, value] }),
    label,
  });
  calls.push(set(COPEYBARA_KEYS.status, status, `setText ${COPEYBARA_KEYS.status} = ${status}`));
  if (i.block?.length || i.unblock?.length) {
    const drop = new Set((i.unblock ?? []).map((h) => h.trim().toLowerCase()));
    const domains = [...parseBlocklist(i.currentBlocklist), ...(i.block ?? [])].filter((h) => !drop.has(h.trim().toLowerCase()));
    const next = formatBlocklist(domains);
    calls.push(set(COPEYBARA_KEYS.blocklist, next, `setText ${COPEYBARA_KEYS.blocklist} = ${next}`));
  }
  assertBatchScope(calls, cfg, { incident: true });
  return {
    calls,
    status,
    batch: txBuilderBatch({ chainId: i.ensChainId, safe: cfg.safe, name: `Copeybara incident for ${cfg.name}: ${i.state}`, calls, createdAt: i.createdAt ?? i.now }),
    multiSend: multiSend(calls),
  };
}
