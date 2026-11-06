import { COPEYBARA_KEYS, parseRelease, parseSiteRecord, type Address } from '@copeybara/core';
import { hasAnyRootRole, writableKeys, type OnChainState } from './chain';

export interface Check {
  name: string;
  /** fail: exit 1. warn: printed, does not fail verify (certify treats some warnings as failures). */
  level: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface Expected {
  name: string;
  resolver: Address;
  safe: Address;
  websiteKey: Address;
  watcher?: Address;
  /** Local kit sha256 + version from the config. */
  kit: { sha256: string; version: number };
  manifest: string;
  exits: string;
  /** Hashes from a local fingerprint (copeybara fingerprint); absent: only check the record parses. */
  site?: string[];
  extension?: string;
}

const ok = (name: string, detail: string): Check => ({ name, level: 'ok', detail });
const warn = (name: string, detail: string): Check => ({ name, level: 'warn', detail });
const fail = (name: string, detail: string): Check => ({ name, level: 'fail', detail });
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Compare what the config says should be published with what ENS actually says. Pure: no I/O. */
export function compare(e: Expected, s: OnChainState): Check[] {
  const t = s.texts;
  const out: Check[] = [];
  const K = COPEYBARA_KEYS;

  out.push(s.resolver.toLowerCase() === e.resolver.toLowerCase() ? ok('resolver', s.resolver) : fail('resolver', `ENS resolves ${e.name} through ${s.resolver}, config says ${e.resolver}`));
  if (s.owner) out.push(s.owner.toLowerCase() === e.safe.toLowerCase() ? ok('owner', `the Safe owns ${e.name}`) : fail('owner', `${e.name} is owned by ${s.owner}, not the Safe ${e.safe}`));
  else if (s.owner === null) out.push(warn('owner', 'not checked: the owner of this name is not in the .eth registry'));

  try {
    const r = parseRelease(t[K.release] ?? '');
    out.push(
      r.sha256 === e.kit.sha256 && r.version === e.kit.version
        ? ok('release', `MATCH v=${r.version} ${r.sha256}`)
        : fail('release', `MISMATCH ENS v=${r.version} ${r.sha256}, local kit v=${e.kit.version} ${e.kit.sha256}`),
    );
  } catch (x) {
    out.push(fail('release', t[K.release] ? (x as Error).message : 'not published'));
  }

  out.push(t[K.manifest] === e.manifest ? ok('manifest', 'MATCH') : fail('manifest', t[K.manifest] ? 'MISMATCH: the published manifest differs from the config' : 'not published'));
  out.push(
    (t[K.exits] ?? '') === e.exits
      ? ok('exits', e.exits ? 'MATCH' : 'none (no declarative exits)')
      : fail('exits', e.exits ? (t[K.exits] ? 'MISMATCH: the published exit spec differs from the config' : 'not published') : 'published, but the config has no exits'),
  );

  const siteText = t[K.site] ?? '';
  let site: string[] | null = null;
  try {
    site = siteText ? parseSiteRecord(siteText) : null;
  } catch (x) {
    out.push(fail('site', `unreadable: ${(x as Error).message}`));
  }
  if (siteText && site) {
    if (e.site) out.push(same(site, e.site) ? ok('site', `MATCH ${site.length} scripts`) : fail('site', 'MISMATCH: the published fingerprint differs from the local build'));
    else out.push(ok('site', `${site.length} scripts published (run copeybara fingerprint to compare with a build)`));
  } else if (!siteText) out.push(e.site ? fail('site', 'not published') : warn('site', 'not published: extensions cannot check the website'));

  if (e.extension !== undefined) out.push(t[K.extension] === e.extension ? ok('extension', 'MATCH') : fail('extension', t[K.extension] ? 'MISMATCH' : 'not published'));

  const web = writableKeys(s, e.websiteKey);
  out.push(
    same(web, ['url']) && !hasAnyRootRole(s, e.websiteKey)
      ? ok('website key', `${e.websiteKey} may write url only`)
      : web.length === 0
        ? warn('website key', `${e.websiteKey} has no write access (grant url with propose)`)
        : fail('website key', `${e.websiteKey} may write ${web.join(', ')}${hasAnyRootRole(s, e.websiteKey) ? ' and holds root roles' : ''}`),
  );
  if (e.watcher) {
    const w = writableKeys(s, e.watcher);
    const want = [K.status, K.blocklist];
    out.push(
      same(w, want) && !hasAnyRootRole(s, e.watcher)
        ? ok('watcher key', `${e.watcher} may write status + blocklist only`)
        : w.length === 0
          ? warn('watcher key', `${e.watcher} has no write access (grant with propose)`)
          : fail('watcher key', `${e.watcher} may write ${w.join(', ')}`),
    );
  }

  if (!s.safe) out.push(fail('safe', `${e.safe} is not a Safe`));
  else if (s.safe.threshold < 2n) out.push(warn('safe', `threshold ${s.safe.threshold} of ${s.safe.owners.length}: one key can change the release`));
  else out.push(ok('safe', `${s.safe.threshold} of ${s.safe.owners.length} signers`));

  const status = t[K.status] ?? '';
  if (/state=compromised/.test(status)) out.push(warn('status', `COMPROMISED: ${status}`));
  else if (/state=degraded/.test(status)) out.push(warn('status', status));
  else out.push(ok('status', status || 'ok (unset)'));
  return out;
}

export const failed = (cs: Check[]) => cs.some((c) => c.level === 'fail');

export function formatChecks(cs: Check[]): string {
  const mark = { ok: '✓', warn: '!', fail: '✗' } as const;
  const w = Math.max(...cs.map((c) => c.name.length));
  return cs.map((c) => `${mark[c.level]} ${c.name.padEnd(w)}  ${c.detail}`).join('\n');
}
