/**
 * Copeybara watcher: an always-on agent run by (or for) a protocol. Each tick, for every watched ENS name:
 *  - fingerprints the official site (url record) against org.copeybara.site; 2 bad reads in a row → it writes
 *    org.copeybara.status = compromised (every Copeybara extension then blocks the site before it loads);
 *  - probes candidate look-alike domains; one that serves pages is added to org.copeybara.blocklist.
 * Its ENS key can write those two records only (ENSv2 setter roles). It cannot touch the release, manifest or site
 * fingerprint, and it only ever clears an alarm it raised itself.
 * The Safe can revoke those roles at any time (contracts/script/watcher-role.sh). The first write that reverts with
 * EACUnauthorizedAccountRoles makes the watcher stand down for that name: it keeps watching and reporting, but sends
 * no more writes until the role is back (checked via `canWrite`, if provided).
 */
import { formatBlocklist, formatStatus, type Address } from '@copeybara/core';
import type { CopeybaraRecords } from '@copeybara/ens';
import { checkScripts, fetchCodeItems, type FetchText } from '@copeybara/sitecheck';

export const MISMATCH_TO_RAISE = 2;
export const DOWN_TO_DEGRADE = 3;
export const CLEAN_TO_CLEAR = 5;
const NOTE_MAX = 200;

export interface NoteFacts {
  protocol: string;
  kind: 'mismatch' | 'down';
  /** labels only (URLs / "inline script #n"): never page content */
  unknown: string[];
  url: string;
}

export interface WatcherDeps {
  names: string[];
  /** look-alike URLs to probe, per name (from certificate-transparency alerts, reports, typo lists) */
  candidates?: Record<string, string[]>;
  readRecords(name: string): Promise<CopeybaraRecords>;
  fetchText: FetchText;
  writeText(name: string, resolver: Address, key: string, value: string): Promise<string>;
  /** optional LLM: turns facts into a short plain note; failures fall back to the deterministic note */
  writeNote?(facts: NoteFacts): Promise<string>;
  /** optional: does this key still hold its setter roles on the name's resolver? Checked on the first tick and,
   * after a revocation, every tick until the Safe re-grants. Without it, a revocation is permanent for the process. */
  canWrite?(name: string, resolver: Address): Promise<boolean>;
  now(): number;
  log?(line: string): void;
}

export type WatchEvent =
  | { at: number; kind: 'raised' | 'cleared' | 'degraded' | 'blocklisted'; detail: string; tx: string }
  | { at: number; kind: 'write-failed' | 'read-failed' | 'revoked' | 'restored'; detail: string };

export interface NameState {
  verdict: 'match' | 'mismatch' | 'unverifiable' | 'unset' | 'down' | 'unknown';
  status: string;
  unknown: string[];
  mismatchStreak: number;
  downStreak: number;
  cleanStreak: number;
  raisedByMe: boolean;
  /** the Safe revoked this key's ENS write roles: watching only, no writes */
  revoked: boolean;
  blocklist: string[];
  lastCheck: number | null;
  events: WatchEvent[];
}

export function deterministicNote(f: NoteFacts): string {
  const n = f.unknown.length;
  const s =
    f.kind === 'mismatch'
      ? `Official site is running ${n} script${n === 1 ? '' : 's'} the protocol never published. Do not sign anything there; withdraw with the Copeybara exit kit.`
      : 'Official site is unreachable. Your funds are in the contracts; withdraw with the Copeybara exit kit.';
  return s.slice(0, NOTE_MAX);
}

export const REVOKED_LINE = 'my ENS role was revoked by the Safe; standing down';
export const RESTORED_LINE = 'my ENS role was re-granted by the Safe; resuming';
/** selector of EACUnauthorizedAccountRoles(uint256,uint256,address) */
const EAC_UNAUTHORIZED = '0x4b27a133';

/** True when `e` (or anything in its cause chain) is the resolver's role check refusing this key. */
export function isRoleRevoked(e: unknown): boolean {
  for (let x = e, i = 0; x && i < 8; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { message?: unknown; data?: { errorName?: unknown } };
    if (o.data?.errorName === 'EACUnauthorizedAccountRoles') return true;
    if (typeof o.message === 'string' && (o.message.includes('EACUnauthorizedAccountRoles') || o.message.toLowerCase().includes(EAC_UNAUTHORIZED))) return true;
  }
  return false;
}

export function createWatcher(deps: WatcherDeps) {
  const st: Record<string, NameState> = {};
  const log = deps.log ?? (() => {});
  const nowSec = () => Math.floor(deps.now() / 1000);
  const S = (name: string): NameState =>
    (st[name] ??= { verdict: 'unknown', status: 'ok', unknown: [], mismatchStreak: 0, downStreak: 0, cleanStreak: 0, raisedByMe: false, revoked: false, blocklist: [], lastCheck: null, events: [] });
  const roleChecked = new Set<string>();
  const push = (s: NameState, e: WatchEvent) => {
    s.events.push(e);
    if (s.events.length > 50) s.events.shift();
    log(`${e.kind}: ${e.detail}`);
  };

  async function note(facts: NoteFacts): Promise<string> {
    if (deps.writeNote) {
      try {
        const t = (await deps.writeNote(facts)).replace(/\s+/g, ' ').trim();
        if (t) return t.slice(0, NOTE_MAX);
      } catch {
        /* fall back */
      }
    }
    return deterministicNote(facts);
  }

  async function write(name: string, s: NameState, r: CopeybaraRecords, key: string, value: string, kind: Extract<WatchEvent, { tx: string }>['kind'], detail: string) {
    if (s.revoked) return false;
    try {
      const tx = await deps.writeText(name, r.resolver, key, value);
      push(s, { at: deps.now(), kind, detail, tx });
      return true;
    } catch (e) {
      if (isRoleRevoked(e)) {
        s.revoked = true;
        push(s, { at: deps.now(), kind: 'revoked', detail: REVOKED_LINE });
        return false;
      }
      push(s, { at: deps.now(), kind: 'write-failed', detail: `${key}: ${(e as Error).message}` });
      return false;
    }
  }

  async function checkName(name: string) {
    const s = S(name);
    let r: CopeybaraRecords;
    try {
      r = await deps.readRecords(name);
    } catch (e) {
      push(s, { at: deps.now(), kind: 'read-failed', detail: (e as Error).message });
      return;
    }
    s.status = r.status?.state ?? 'unreadable';
    s.blocklist = r.blocklist;
    s.lastCheck = deps.now();
    if (s.status === 'ok') s.raisedByMe = false;

    // 0. do I still hold my ENS roles? (first tick, then only while stood down)
    if (deps.canWrite && (s.revoked || !roleChecked.has(name))) {
      roleChecked.add(name);
      let ok: boolean | null = null;
      try {
        ok = await deps.canWrite(name, r.resolver);
      } catch {
        /* unknown: keep the current state */
      }
      if (ok === false && !s.revoked) {
        s.revoked = true;
        push(s, { at: deps.now(), kind: 'revoked', detail: REVOKED_LINE });
      } else if (ok === true && s.revoked) {
        s.revoked = false;
        push(s, { at: deps.now(), kind: 'restored', detail: RESTORED_LINE });
      }
    }

    // 1. the official site
    if (r.url) {
      let items;
      try {
        items = await fetchCodeItems(r.url, deps.fetchText);
      } catch {
        items = null;
      }
      if (!items) {
        s.verdict = 'down';
        s.downStreak++;
        s.mismatchStreak = 0;
        s.cleanStreak = 0;
        if (s.downStreak >= DOWN_TO_DEGRADE && s.status === 'ok') {
          const facts: NoteFacts = { protocol: name, kind: 'down', unknown: [], url: r.url };
          if (await write(name, s, r, 'org.copeybara.status', formatStatus({ state: 'degraded', at: nowSec(), note: await note(facts) }), 'degraded', `${r.url} unreachable ${s.downStreak}×`)) {
            s.status = 'degraded';
            s.raisedByMe = true;
          }
        }
      } else {
        const c = checkScripts(items, r.site);
        s.verdict = c.verdict;
        s.unknown = c.unknown.map((u) => u.label);
        s.downStreak = 0;
        if (c.verdict === 'mismatch') {
          s.mismatchStreak++;
          s.cleanStreak = 0;
          if (s.mismatchStreak >= MISMATCH_TO_RAISE && s.status !== 'compromised') {
            const facts: NoteFacts = { protocol: name, kind: 'mismatch', unknown: s.unknown, url: r.url };
            if (await write(name, s, r, 'org.copeybara.status', formatStatus({ state: 'compromised', at: nowSec(), note: await note(facts) }), 'raised', `${s.unknown.length} unknown script(s) on ${r.url}`)) {
              s.status = 'compromised';
              s.raisedByMe = true;
            }
          }
        } else if (c.verdict === 'match') {
          s.mismatchStreak = 0;
          s.cleanStreak++;
          if (s.raisedByMe && s.status !== 'ok' && s.cleanStreak >= CLEAN_TO_CLEAR) {
            if (await write(name, s, r, 'org.copeybara.status', formatStatus({ state: 'ok', at: nowSec() }), 'cleared', `${r.url} clean ${s.cleanStreak}×`)) {
              s.status = 'ok';
              s.raisedByMe = false;
            }
          }
        }
      }
    }

    // 2. look-alike domains
    const official = r.url ? new URL(r.url).hostname : null;
    const add: string[] = [];
    for (const u of deps.candidates?.[name] ?? []) {
      let host: string;
      try {
        host = new URL(u).hostname.toLowerCase();
      } catch {
        continue;
      }
      if (host === official || s.blocklist.includes(host) || add.includes(host)) continue;
      const live = await deps.fetchText(u).then((x) => x.ok, () => false);
      if (live) add.push(host);
    }
    if (add.length) {
      const next = formatBlocklist([...s.blocklist, ...add]);
      if (await write(name, s, r, 'org.copeybara.blocklist', next, 'blocklisted', add.join(', '))) s.blocklist = [...s.blocklist, ...add];
    }
  }

  return {
    async tick() {
      for (const n of deps.names) await checkName(n);
    },
    state: () => st,
    /** true if the Safe has revoked this key on any watched name */
    revoked: () => Object.values(st).some((s) => s.revoked),
  };
}
