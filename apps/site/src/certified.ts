import type { Address } from '@copeybara/core';
import { readCopeybaraRecords, type CopeybaraRecords } from '@copeybara/ens';
import { certifyLive, readOnChain, type CertifiedEntry, type Check, type OnChainState } from '@copeybara/protocol-cli/onchain';
import type { Quorum } from '@copeybara/quorum';
import registry from '../../../config/certified.json';
import networks from '../../../config/networks.json';

export const CERTIFIED = registry as CertifiedEntry[];
export const findCertified = (name: string) => CERTIFIED.find((e) => e.name === name.toLowerCase()) ?? null;

/** Plain-language rule for each live check name (certifyLive). */
export const RULE: Record<string, string> = {
  owner: 'The protocol’s Safe owns the ENS name',
  resolver: 'The name resolves through the registered resolver',
  safe: 'Changing the release needs at least 2 Safe signatures',
  records: 'A kit release and an exit manifest are published, and every record reads cleanly',
  'website key': 'The website deploy key can write the url record and nothing else',
  watcher: 'A watcher runs with write access to status and blocklist only',
  'site fingerprint': 'The website’s script fingerprint is published, so extensions can check it',
  status: 'The status record does not say compromised',
};

export interface Verdict {
  certified: boolean;
  checks: Check[];
  block: bigint;
}

/** Re-run the on-chain half of Copeybara certified for one registry entry. The tick is never cached or taken on trust. */
export async function checkCertified(
  e: CertifiedEntry,
  q: Quorum,
  deps: {
    readOnChain?: typeof readOnChain;
    readRecords?: (name: string) => Promise<CopeybaraRecords>;
  } = {},
): Promise<Verdict> {
  const ur = networks.ens.universalResolver as Address;
  const read = deps.readOnChain ?? readOnChain;
  const records = deps.readRecords ?? ((n: string) => readCopeybaraRecords(n, q, { universalResolver: ur }));
  const [s, r] = await Promise.all([
    read({ q, name: e.name, universalResolver: ur, ethRegistry: networks.ens.ethRegistry as Address, resolver: e.resolver, safe: e.safe, accounts: [e.websiteKey, e.watcher] }),
    records(e.name).catch((x: Error) => x),
  ]);
  const checks = certifyLive(e, s as OnChainState, r);
  return { certified: checks.every((c) => c.level !== 'fail'), checks, block: s.block };
}
