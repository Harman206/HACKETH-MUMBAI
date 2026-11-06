import { COPEYBARA_KEYS, parseSiteRecord, type Address } from '@copeybara/core';
import type { CopeybaraRecords } from '@copeybara/ens';
import { hasAnyRootRole, writableKeys, type OnChainState } from './chain';
import type { Check } from './verify';

/** One onboarded protocol in config/certified.json. Addresses let anyone re-run the checks; the tick is never taken on trust. */
export interface CertifiedEntry {
  /** Display name, e.g. "DemoSwap". */
  protocol: string;
  /** ENS name the checks read. */
  name: string;
  safe: Address;
  resolver: Address;
  websiteKey: Address;
  watcher: Address;
  /** ISO date of onboarding. */
  since: string;
  /** Shown next to the tick, e.g. "Sepolia testnet demo". */
  note?: string;
}

export const CERTIFY_RULES = [
  'The ENS name is owned by a Safe that needs at least 2 signatures',
  'A kit release and an exit manifest are published, and every Copeybara record parses',
  'The website deploy key can write the url record and nothing else',
  'A watcher is running with write access to status and blocklist only',
  'The website’s script fingerprint is published, so extensions can check it',
  'The status record is not compromised',
] as const;

const ok = (name: string, detail: string): Check => ({ name, level: 'ok', detail });
const fail = (name: string, detail: string): Check => ({ name, level: 'fail', detail });
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * The on-chain half of "Copeybara certified": everything a browser can re-check from ENS alone. `records` is the kit's
 * own reading (readCopeybaraRecords), or the error it threw. The CLI adds the local half (kit bytes, drill).
 */
export function certifyLive(e: Pick<CertifiedEntry, 'safe' | 'resolver' | 'websiteKey' | 'watcher'>, s: OnChainState, records: CopeybaraRecords | Error): Check[] {
  const out: Check[] = [];
  if (!s.owner) out.push(fail('owner', 'could not read the name’s owner from the .eth registry (only second-level .eth names can be certified)'));
  else out.push(s.owner.toLowerCase() === e.safe.toLowerCase() ? ok('owner', `the Safe ${s.owner}`) : fail('owner', `owned by ${s.owner}, not the Safe ${e.safe}`));
  out.push(s.resolver.toLowerCase() === e.resolver.toLowerCase() ? ok('resolver', s.resolver) : fail('resolver', `resolves through ${s.resolver}, registry says ${e.resolver}`));
  if (!s.safe) out.push(fail('safe', 'the owner is not a Safe'));
  else if (s.safe.threshold < 2n) out.push(fail('safe', `${s.safe.threshold} of ${s.safe.owners.length}: one key can change the release`));
  else out.push(ok('safe', `${s.safe.threshold} of ${s.safe.owners.length} signers`));
  if (records instanceof Error) out.push(fail('records', records.message));
  else if (records.problems.length) out.push(fail('records', records.problems.map((p) => `${p.key}: ${p.message}`).join('; ')));
  else out.push(ok('records', `release v=${records.release.version}, manifest for ${Object.keys(records.manifest.chains).length} chain(s)`));
  const web = writableKeys(s, e.websiteKey);
  out.push(
    (web.length === 0 || same(web, ['url'])) && !hasAnyRootRole(s, e.websiteKey)
      ? ok('website key', 'url only')
      : fail('website key', `may write ${web.join(', ') || 'root roles'}`),
  );
  const w = writableKeys(s, e.watcher);
  out.push(
    same(w, [COPEYBARA_KEYS.status, COPEYBARA_KEYS.blocklist]) && !hasAnyRootRole(s, e.watcher)
      ? ok('watcher', 'status + blocklist only')
      : fail('watcher', w.length ? `may write ${w.join(', ')}` : 'no watcher role'),
  );
  let site: string[] | null = null;
  try {
    site = parseSiteRecord(s.texts[COPEYBARA_KEYS.site] ?? '');
  } catch {
    site = null;
  }
  out.push(site?.length ? ok('site fingerprint', `${site.length} scripts`) : fail('site fingerprint', 'not published'));
  const status = s.texts[COPEYBARA_KEYS.status] ?? '';
  out.push(/state=compromised/.test(status) ? fail('status', 'compromised: certification suspended until the Safe clears it') : ok('status', status ? status.replace(/^v=1;/, '') : 'ok'));
  return out;
}
