/**
 * The extension's trust core (runs in the service worker). It alone reads ENS, keeps state, computes verdicts and
 * writes storage. Content scripts send it page-derived inputs; extension pages send user choices. Neither can hand
 * it a verdict. All chrome APIs come in through `deps.chrome` so the logic is unit-tested with a fake.
 */
import { hostMatches, type Address, type ReleaseRecord } from '@copeybara/core';
import { normaliseName, type CopeybaraRecords } from '@copeybara/ens';
import { classifyRequest, type Classification } from '@copeybara/guard';
import { checkScripts, sha256Hex, type CodeItem } from '@copeybara/sitecheck';
import { BUILD_FILES, parseBuildFiles, sha256Bytes, treeHash, treeWithoutAudio, type BuildProof } from '../shared/buildproof';
import type { CertifiedEntry, CertifiedVerdict } from '../shared/certified';
import { findCertified } from '../shared/certified';
import { classifySender, parseContentMsg, parsePageMsg, type SenderLike } from '../shared/messages';
import {
  emptyStats,
  ENS_CHAIN_ID,
  type Decision,
  type PendingConfirm,
  type ProtocolState,
  type PublicState,
  type Settings,
  type SiteState,
  type Snapshot,
  type Stats,
} from '../shared/types';
import { buildRules, warningPath, type DnrRule } from './rules';

export interface ChromeLike {
  runtime: { id: string; getURL(path: string): string; getManifest?(): { version: string } };
  storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  tabs: {
    update(tabId: number, props: { url: string }): Promise<unknown>;
    create(props: { url: string }): Promise<unknown>;
    sendMessage(tabId: number, msg: unknown): Promise<unknown>;
  };
  windows: {
    create(o: { url: string; type: 'popup'; width: number; height: number; focused?: boolean }): Promise<{ id?: number }>;
    /** the worker closes the confirm window itself: window.close() from the page is not reliable in every Chrome */
    remove(windowId: number): Promise<void>;
  };
  action: {
    setBadgeText(o: { tabId?: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(o: { tabId?: number; color: string }): Promise<void>;
    setTitle(o: { tabId?: number; title: string }): Promise<void>;
  };
  declarativeNetRequest: {
    getDynamicRules(): Promise<{ id: number }[]>;
    updateDynamicRules(o: { removeRuleIds: number[]; addRules: DnrRule[] }): Promise<void>;
  };
}

export interface CoreDeps {
  chrome: ChromeLike;
  /** ENS read through the 3-RPC quorum for these RPC URLs */
  readRecords(name: string, rpcs: string[]): Promise<CopeybaraRecords>;
  fetchBytes(url: string): Promise<Uint8Array>;
  rpcChainId(url: string): Promise<number>;
  now(): number;
  defaultRpcs: string[];
  defaultKitUrl: string;
  version: string;
  /** re-run the on-chain Copeybara certified checks for a bundled entry, through the quorum on these RPCs */
  checkCertified?(e: CertifiedEntry, rpcs: string[]): Promise<CertifiedVerdict>;
  /** how long a page waits for the user in the confirm window */
  confirmTimeoutMs?: number;
  /** after Cancel, the confirm window shows "Saved by Copey!"; the worker closes it after this long at the latest */
  celebrateMs?: number;
}

export const FRESH_MS = 60_000;
export const STALE_MS = 10 * 60_000;
const CONFIRM_LIMIT = 3;
const CONFIRM_WINDOW_MS = 60_000;

interface TabState {
  url: string;
  origin: string;
  site: SiteState;
  items: Map<string, CodeItem>;
  done: boolean;
  counted: boolean;
  blocked: boolean;
}

const BADGE: Record<string, { text: string; color: string; title: string }> = {
  match: { text: '✓', color: '#16a34a', title: 'Copeybara: this site runs exactly the code its protocol published.' },
  checking: { text: '…', color: '#64748b', title: 'Copeybara: checking this site against ENS…' },
  unverifiable: { text: '?', color: '#d97706', title: 'Copeybara: some of this site’s code could not be checked.' },
  stale: { text: '?', color: '#d97706', title: 'Copeybara: could not reach ENS to check this site.' },
  unset: { text: '–', color: '#64748b', title: 'Copeybara: this protocol has not published a site fingerprint.' },
  mismatch: { text: '!', color: '#dc2626', title: 'Copeybara: this site’s code is NOT what the protocol published.' },
  compromised: { text: '!', color: '#dc2626', title: 'Copeybara: the protocol reports its site is compromised.' },
  blocklisted: { text: '!', color: '#dc2626', title: 'Copeybara: a protocol you follow lists this site as a fake.' },
};

/** Wallet connect requests: checked only for look-alike sites, before the wallet shows its own connect popup. */
export const CONNECT_METHODS = new Set(['eth_requestAccounts', 'wallet_requestPermissions']);

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `label` appears in `host` as whole '-'/'.'-separated tokens (demoswap in demoswap-airdrop.localhost, not in mydemoswapper). */
export function hasToken(host: string, label: string): boolean {
  return new RegExp(`(^|[.-])${escapeRe(label)}($|[.-])`).test(host);
}

/**
 * The distinctive labels of a protocol: the first label of its official host (www. skipped) and the first label of its
 * ENS name, each at least 4 characters (shorter ones like "app" would match half the web).
 */
export function protocolLabels(officialHost: string, ensName: string): string[] {
  const first = officialHost.replace(/^www\./, '').split('.')[0] ?? '';
  const ens = ensName.split('.')[0] ?? '';
  return [...new Set([first, ens].map((x) => x.toLowerCase()).filter((x) => x.length >= 4))];
}

const DEFAULT_SETTINGS = (kitUrl: string): Settings => ({ account: null, userRpcs: [], useDefaultRpcs: true, kitUrl, setupDone: false });

function toSnapshot(r: CopeybaraRecords, now: number): Snapshot {
  let origin: string | null = null;
  try {
    origin = r.url ? new URL(r.url).origin : null;
  } catch {
    origin = null;
  }
  return {
    name: r.name,
    url: r.url,
    origin,
    release: r.release,
    manifest: r.manifest,
    site: r.site,
    extension: r.extension,
    status: r.status,
    blocklist: r.blocklist,
    problems: r.problems,
    block: r.block.toString(),
    syncedAt: now,
  };
}

export function createCore(deps: CoreDeps) {
  const { chrome } = deps;
  const extOrigin = chrome.runtime.getURL('');
  let settings: Settings = DEFAULT_SETTINGS(deps.defaultKitUrl);
  let protocols: ProtocolState[] = [];
  let stats: Stats = emptyStats();
  let pendingAddress: PublicState['pendingAddress'] = null;
  const tabs = new Map<number, TabState>();
  /** confirm windows opened per tab (kept apart from TabState: a page that never said hello is limited too) */
  const confirmTimes = new Map<number, number[]>();
  /** "tabId|origin" pairs where the user chose to connect anyway on a look-alike: not asked again for that page */
  const connectOk = new Set<string>();
  const confirms = new Map<string, { pending: PendingConfirm; resolve: (allow: boolean) => void; windowId?: number }>();
  /** confirm windows showing the celebration after Cancel: closed by the page's Done, or by a timer */
  const closing = new Map<string, () => void>();
  let loaded: Promise<void> | null = null;
  let seq = 0;

  // ---------- persistence ----------
  const load = () =>
    (loaded ??= chrome.storage.local.get(['settings', 'protocols', 'stats', 'pendingAddress']).then((s) => {
      settings = { ...DEFAULT_SETTINGS(deps.defaultKitUrl), ...((s.settings as Settings | undefined) ?? {}) };
      protocols = (s.protocols as ProtocolState[] | undefined) ?? [];
      stats = { ...emptyStats(), ...((s.stats as Stats | undefined) ?? {}) };
      pendingAddress = (s.pendingAddress as PublicState['pendingAddress']) ?? null;
    }));
  const save = (what: ('settings' | 'protocols' | 'stats' | 'pendingAddress')[]) =>
    chrome.storage.local.set(Object.fromEntries(what.map((k) => [k, { settings, protocols, stats, pendingAddress }[k]])));
  const bump = async (f: (s: Stats) => void) => {
    f(stats);
    await save(['stats']);
  };

  const rpcs = () => [...(settings.useDefaultRpcs ? deps.defaultRpcs : []), ...settings.userRpcs];

  // ---------- ENS sync ----------
  async function syncOne(name: string): Promise<ProtocolState | undefined> {
    const p = protocols.find((x) => x.name === name);
    if (!p) return undefined;
    try {
      const r = await deps.readRecords(name, rpcs());
      p.snapshot = toSnapshot(r, deps.now());
      p.error = null;
      p.errorAt = null;
    } catch (e) {
      p.error = (e as Error).message;
      p.errorAt = deps.now();
    }
    return p;
  }

  async function applyRules() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const rules = buildRules(protocols);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
  }

  async function sync(names?: string[]) {
    await load();
    for (const n of names ?? protocols.map((p) => p.name)) await syncOne(n);
    stats.lastSync = deps.now();
    await save(['protocols', 'stats']);
    await applyRules();
    // Open tabs on a site that just turned compromised / blocklisted are moved off it now.
    for (const [tabId, t] of tabs) if (!t.blocked) await evaluateNavigation(tabId, t);
  }

  async function fresh(p: ProtocolState): Promise<ProtocolState> {
    if (!p.snapshot || deps.now() - p.snapshot.syncedAt > FRESH_MS) {
      await syncOne(p.name);
      await save(['protocols']);
      await applyRules();
    }
    return p;
  }

  // ---------- tabs & site verdicts ----------
  function protocolFor(origin: string): ProtocolState | undefined {
    return protocols.find((p) => p.snapshot?.origin === origin);
  }
  /** A followed protocol this host pretends to be: on its blocklist, or carrying its name without being its official host. */
  function imitated(host: string): { protocol: string; official: string } | undefined {
    const h = host.toLowerCase().replace(/\.$/, '');
    for (const p of protocols) {
      const s = p.snapshot;
      if (!s) continue;
      const official = s.origin ?? '';
      let officialHost = '';
      try {
        officialHost = official ? new URL(official).hostname : '';
      } catch {
        officialHost = '';
      }
      if (s.blocklist.some((d) => hostMatches(h, d))) return { protocol: p.name, official: official || 'no website' };
      if (!officialHost) continue;
      // the official host, its subdomains, and the domains above it belong to the protocol
      if (hostMatches(h, officialHost) || hostMatches(officialHost, h)) continue;
      if (protocolLabels(officialHost, p.name).some((l) => hasToken(h, l))) return { protocol: p.name, official };
    }
    return undefined;
  }
  function blocklistHit(host: string): { protocol: string; domain: string } | undefined {
    for (const p of protocols) for (const d of p.snapshot?.blocklist ?? []) if (hostMatches(host, d)) return { protocol: p.name, domain: d };
    return undefined;
  }

  async function badge(tabId: number, key: string | null) {
    const b = key ? BADGE[key] : null;
    await chrome.action.setBadgeText({ tabId, text: b?.text ?? '' }).catch(() => {});
    if (b) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color }).catch(() => {});
      await chrome.action.setTitle({ tabId, title: b.title }).catch(() => {});
    }
  }

  async function block(tabId: number, t: TabState, reason: 'compromised' | 'blocklist' | 'mismatch', name: string, extra: Record<string, string> = {}) {
    if (t.blocked) return;
    t.blocked = true;
    stats.pagesBlocked[reason]++;
    if (reason === 'mismatch') {
      stats.sitesChecked++;
      stats.mismatched++;
      t.counted = true;
    }
    await save(['stats']);
    await badge(tabId, reason === 'blocklist' ? 'blocklisted' : reason);
    await chrome.tabs.update(tabId, { url: chrome.runtime.getURL(warningPath(reason, name, { ...extra, from: t.url })) }).catch(() => {});
  }

  /** Decide what a freshly loaded (or re-synced) top-level page is. */
  async function evaluateNavigation(tabId: number, t: TabState) {
    let host: string;
    try {
      host = new URL(t.url).hostname;
    } catch {
      return;
    }
    const hit = blocklistHit(host);
    if (hit) {
      t.site = { kind: 'blocklisted', ...hit };
      return block(tabId, t, 'blocklist', hit.protocol, { domain: hit.domain });
    }
    const p = protocolFor(t.origin);
    if (!p) {
      t.site = { kind: 'none' };
      return badge(tabId, null);
    }
    if (p.snapshot?.status?.state === 'compromised') {
      t.site = { kind: 'protocol', protocol: p.name, verdict: 'compromised', unknown: [], unreadable: [] };
      return block(tabId, t, 'compromised', p.name, p.snapshot.status.note ? { note: p.snapshot.status.note } : {});
    }
    if (t.site.kind !== 'protocol') t.site = { kind: 'protocol', protocol: p.name, verdict: 'checking', unknown: [], unreadable: [] };
    await badge(tabId, t.site.verdict);
  }

  async function evaluateScripts(tabId: number, t: TabState) {
    if (t.site.kind !== 'protocol' || t.blocked) return;
    const p = protocols.find((x) => x.name === (t.site as { protocol: string }).protocol);
    if (!p) return;
    await fresh(p);
    const snap = p.snapshot;
    const tooOld = !snap || deps.now() - snap.syncedAt > STALE_MS || (p.error && p.errorAt && p.errorAt > snap.syncedAt && deps.now() - snap.syncedAt > FRESH_MS);
    if (snap?.status?.state === 'compromised') return evaluateNavigation(tabId, t);
    const siteProblem = snap?.problems.some((x) => x.key === 'org.copeybara.site');
    const r = checkScripts([...t.items.values()], snap?.site ?? null);
    // An unreadable fingerprint record can neither clear nor condemn a site: amber, never a block.
    if (r.verdict === 'mismatch' && !siteProblem && !tooOld) {
      t.site = { kind: 'protocol', protocol: p.name, verdict: 'mismatch', unknown: r.unknown, unreadable: r.unreadable };
      return block(tabId, t, 'mismatch', p.name, { unknown: r.unknown.map((u) => u.label).slice(0, 5).join('\n') });
    }
    let verdict: 'match' | 'unverifiable' | 'unset' | 'stale' | 'checking' = r.verdict === 'mismatch' ? 'stale' : r.verdict;
    if (tooOld || siteProblem) verdict = 'stale';
    if (!t.done && verdict === 'match') verdict = 'checking';
    t.site = { kind: 'protocol', protocol: p.name, verdict, unknown: [], unreadable: r.unreadable };
    await badge(tabId, verdict);
    if (t.done && !t.counted && verdict !== 'checking') {
      t.counted = true;
      stats.sitesChecked++;
      if (verdict === 'match') stats.verified++;
      else if (verdict === 'unset') stats.unset++;
      else stats.unverifiable++;
      await save(['stats']);
    }
  }

  // ---------- wallet requests ----------
  async function decide(tabId: number, origin: string, msg: { method: string; params: unknown; chainId: number | null }): Promise<Decision> {
    const t = tabs.get(tabId);
    const manifests = protocols.flatMap((p) => (p.snapshot ? [{ name: p.name, manifest: p.snapshot.manifest }] : []));
    const fromParam = (() => {
      const p0 = Array.isArray(msg.params) ? (msg.params[0] as { from?: unknown } | undefined) : undefined;
      return p0 && typeof p0 === 'object' && typeof p0.from === 'string' ? (p0.from as Address) : null;
    })();
    let c: Classification = classifyRequest({ method: msg.method, params: msg.params }, {
      account: fromParam ?? settings.account,
      chainId: msg.chainId ?? ENS_CHAIN_ID,
      manifests,
    });
    let context: string | null = null;
    const connectKey = `${tabId}|${origin}`;
    if (CONNECT_METHODS.has(msg.method) && !connectOk.has(connectKey)) {
      let host = '';
      try {
        host = new URL(origin).hostname;
      } catch {
        host = '';
      }
      const fake = host ? imitated(host) : undefined;
      if (fake) {
        c = {
          verdict: 'risky',
          method: msg.method,
          reasons: [`This site imitates ${fake.protocol} but is not its official address (${fake.official} from ENS). Don't connect your wallet here.`],
        };
        context = `${fake.protocol}'s official site, from its ENS records: ${fake.official}`;
      }
    }
    if (c.verdict === 'pass') return { decision: 'allow', verdict: 'pass', reasons: c.reasons };
    stats.requestsChecked[c.verdict]++;

    const site = t?.site;
    if (t?.blocked || (site?.kind === 'protocol' && (site.verdict === 'mismatch' || site.verdict === 'compromised')) || site?.kind === 'blocklisted') {
      stats.requestsBlocked++;
      await save(['stats']);
      return { decision: 'block', verdict: c.verdict, reasons: ['Blocked: this site is not running the code its protocol published.', ...c.reasons] };
    }
    let verdict = c.verdict;
    if (site?.kind === 'protocol' && verdict === 'unknown') {
      verdict = 'risky';
      context = `This page is ${site.protocol}'s site, but the contract it calls is not one ${site.protocol} publishes.`;
    }
    if (verdict !== 'risky' && verdict !== 'dangerous') {
      await save(['stats']);
      return { decision: 'allow', verdict, reasons: c.reasons };
    }
    // Rate limit confirm windows per tab: a page cannot flood the user with prompts.
    const now = deps.now();
    const recent = (confirmTimes.get(tabId) ?? []).filter((x) => now - x < CONFIRM_WINDOW_MS);
    confirmTimes.set(tabId, recent);
    if (recent.length >= CONFIRM_LIMIT) {
      stats.pageNoise++;
      stats.requestsBlocked++;
      await save(['stats']);
      return { decision: 'block', verdict, reasons: ['Blocked: this page asked for too many risky approvals in a row.'] };
    }
    recent.push(now);
    const id = `c${now.toString(36)}${(seq++).toString(36)}`;
    const pending: PendingConfirm = { id, tabId, origin, classification: { ...c, verdict }, context, createdAt: now };
    const entry: { pending: PendingConfirm; resolve: (a: boolean) => void; windowId?: number; done?: boolean } = { pending, resolve: () => {} };
    const close = () => {
      entry.done = true;
      if (entry.windowId !== undefined) void chrome.windows.remove(entry.windowId).catch(() => {});
    };
    let timedOut = false;
    const allow = await new Promise<boolean>((resolve) => {
      entry.resolve = resolve;
      confirms.set(id, entry);
      chrome.windows
        .create({ url: chrome.runtime.getURL(`/src/pages/confirm.html?id=${id}`), type: 'popup', width: 440, height: 640, focused: true })
        .then((w) => {
          entry.windowId = w.id;
          if (entry.done) close(); // decided (or timed out) before the window existed
        })
        .catch(() => resolve(false));
      setTimeout(() => {
        timedOut = true;
        resolve(false);
      }, deps.confirmTimeoutMs ?? 180_000);
    });
    confirms.delete(id);
    if (allow || timedOut) close();
    else {
      // Cancelled: the page is answered now; the window stays a moment for "Saved by Copey!", then closes.
      const timer = setTimeout(() => closing.get(id)?.(), deps.celebrateMs ?? 12_000);
      closing.set(id, () => {
        clearTimeout(timer);
        closing.delete(id);
        close();
      });
    }
    if (allow && CONNECT_METHODS.has(msg.method)) connectOk.add(connectKey);
    if (allow) stats.requestsAllowedAfterWarning++;
    else stats.requestsBlocked++;
    await save(['stats']);
    return { decision: allow ? 'allow' : 'block', verdict, reasons: c.reasons };
  }

  // ---------- kit ----------
  async function openKit(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const p = protocols.find((x) => x.name === name);
    if (!p) return { ok: false, error: `${name} is not followed.` };
    await fresh(p);
    const rel: ReleaseRecord | undefined = p.snapshot?.release;
    if (!rel) return { ok: false, error: `Could not read ${name}'s release record: ${p.error ?? 'unknown error'}` };
    let bytes: Uint8Array;
    try {
      bytes = await deps.fetchBytes(settings.kitUrl);
    } catch (e) {
      return { ok: false, error: `Could not download the kit from ${settings.kitUrl}: ${(e as Error).message}` };
    }
    const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const got = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (got !== rel.sha256) {
      return { ok: false, error: `The kit at ${settings.kitUrl} does not match ${name}'s release v${rel.version} (sha256 ${got.slice(0, 12)}… ≠ ${rel.sha256.slice(0, 12)}…). Not opening it.` };
    }
    const u = new URL(settings.kitUrl);
    u.searchParams.set('ens', name);
    await chrome.tabs.create({ url: u.href });
    return { ok: true };
  }

  // ---------- build proof ----------
  /** Hash this extension's own files (as Chrome serves them) and compare with the ENS extension record. */
  async function buildProof(): Promise<BuildProof | { error: string }> {
    let paths: string[];
    let listing: Uint8Array;
    try {
      listing = await deps.fetchBytes(chrome.runtime.getURL(BUILD_FILES));
      paths = parseBuildFiles(new TextDecoder().decode(listing));
    } catch (e) {
      return { error: `Could not read ${BUILD_FILES} from the installed extension: ${(e as Error).message}` };
    }
    const entries: { path: string; sha256: string }[] = [];
    for (const path of paths) {
      try {
        // the listing is hashed from the bytes just parsed, so what was read is what is proven
        entries.push({ path, sha256: await sha256Bytes(path === BUILD_FILES ? listing : await deps.fetchBytes(chrome.runtime.getURL(path))) });
      } catch (e) {
        return { error: `Could not read ${path} from the installed extension: ${(e as Error).message}` };
      }
    }
    const tree = await treeHash(entries);
    const noAudio = await treeWithoutAudio(entries);
    const recs = protocols.flatMap((p) => (p.snapshot?.extension ? [{ name: p.name, rel: p.snapshot.extension }] : []));
    const pick = recs.find((r) => r.rel.tree === tree) ?? (noAudio ? recs.find((r) => r.rel.tree === noAudio) : undefined) ?? recs.find((r) => r.rel.tree) ?? recs[0];
    const ens = pick ? { name: pick.name, version: pick.rel.version, tree: pick.rel.tree ?? null, zip: pick.rel.sha256 } : null;
    const verdict = !ens ? 'no-record' : !ens.tree ? 'old-record' : ens.tree === tree ? 'match' : noAudio && ens.tree === noAudio ? 'local-audio' : 'mismatch';
    return { version: chrome.runtime.getManifest?.().version ?? deps.version, treeHash: tree, files: entries.length, ens, verdict };
  }

  const publicState = (): PublicState => ({ settings, protocols, stats, pendingAddress, version: deps.version });

  // ---------- messages ----------
  async function handleMessage(raw: unknown, sender: SenderLike): Promise<unknown> {
    await load();
    const who = classifySender(sender, chrome.runtime.id, extOrigin);
    if (who.kind === 'foreign') return { error: 'unknown sender' };

    if (who.kind === 'page') {
      const m = parsePageMsg(raw);
      if (!m) return { error: 'bad message' };
      switch (m.t) {
        case 'getState':
          return publicState();
        case 'follow': {
          let name: string;
          try {
            name = normaliseName(m.name);
          } catch (e) {
            return { error: (e as Error).message };
          }
          if (!protocols.some((p) => p.name === name)) protocols.push({ name, followedAt: deps.now(), snapshot: null, error: null, errorAt: null });
          await sync([name]);
          return publicState();
        }
        case 'unfollow':
          protocols = protocols.filter((p) => p.name !== m.name);
          await save(['protocols']);
          await applyRules();
          return publicState();
        case 'settings':
          settings = { ...settings, ...m.patch };
          await save(['settings']);
          return publicState();
        case 'sync':
          await sync();
          return publicState();
        case 'getConfirm':
          return confirms.get(m.id)?.pending ?? null;
        case 'closeConfirm': {
          const f = closing.get(m.id);
          f?.();
          return { ok: !!f };
        }
        case 'confirmDecision': {
          const c = confirms.get(m.id);
          c?.resolve(m.allow);
          return { ok: !!c };
        }
        case 'acceptAddress':
          if (pendingAddress) settings = { ...settings, account: pendingAddress.address };
          pendingAddress = null;
          await save(['settings', 'pendingAddress']);
          return publicState();
        case 'rejectAddress':
          pendingAddress = null;
          await save(['pendingAddress']);
          return publicState();
        case 'openKit':
          return openKit(m.name);
        case 'testRpc': {
          const started = deps.now();
          try {
            const chainId = await deps.rpcChainId(m.url);
            return { ok: chainId === ENS_CHAIN_ID, chainId, ms: deps.now() - started };
          } catch (e) {
            return { ok: false, error: (e as Error).message };
          }
        }
        case 'getTab':
          return tabs.get(m.tabId)?.site ?? { kind: 'none' };
        case 'resetStats':
          stats = emptyStats();
          await save(['stats']);
          return publicState();
        case 'buildProof':
          return buildProof();
        case 'checkCertified': {
          const e = findCertified(m.name);
          if (!e || !deps.checkCertified) return { error: 'not available' };
          try {
            return await deps.checkCertified(e, rpcs());
          } catch (x) {
            return { error: (x as Error).message };
          }
        }
      }
    }

    // content script (page-derived data)
    const m = parseContentMsg(raw);
    if (!m) {
      await bump((s) => s.pageNoise++);
      return { error: 'bad message' };
    }
    const { tabId, frameId, url, origin } = who as Extract<typeof who, { kind: 'content' }>;
    if (m.t === 'noise') {
      await bump((s) => s.pageNoise++);
      return { ok: true };
    }
    if (m.t === 'kit-address') {
      pendingAddress = { address: m.address, origin, at: deps.now() };
      await save(['pendingAddress']);
      return { ok: true };
    }
    if (m.t === 'request') return decide(tabId, origin, m);

    if (m.t === 'hello') {
      if (frameId !== 0) return { site: tabs.get(tabId)?.site ?? { kind: 'none' } };
      const t: TabState = { url, origin, site: { kind: 'none' }, items: new Map(), done: false, counted: false, blocked: false };
      tabs.set(tabId, t);
      const p = protocolFor(origin);
      if (p) await fresh(p);
      await evaluateNavigation(tabId, t);
      return { site: t.site };
    }
    // scripts
    const t = tabs.get(tabId);
    if (!t) return { resend: true };
    if (origin !== t.origin) return { ignored: true }; // another site's frame: not this protocol's code
    for (const i of m.items) t.items.set(`${i.kind}|${i.label}|${i.hash}`, i);
    if (m.done && frameId === 0) t.done = true;
    await evaluateScripts(tabId, t);
    return { site: t.site };
  }

  return {
    load,
    sync,
    handleMessage,
    publicState,
    /** Every top-level navigation (tabs.onUpdated): a blocked or flagged site is moved to the warning page at once. */
    async onNavigate(tabId: number, url: string) {
      await load();
      let origin: string;
      let host: string;
      try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        origin = u.origin;
        host = u.hostname;
      } catch {
        return;
      }
      const flagged = blocklistHit(host) || protocolFor(origin)?.snapshot?.status?.state === 'compromised';
      if (!flagged) return;
      const prev = tabs.get(tabId);
      if (prev?.url === url && prev.blocked) return;
      const t: TabState = { url, origin, site: { kind: 'none' }, items: new Map(), done: false, counted: false, blocked: false };
      tabs.set(tabId, t);
      await evaluateNavigation(tabId, t);
    },
    onTabRemoved(tabId: number) {
      tabs.delete(tabId);
      confirmTimes.delete(tabId);
      for (const k of connectOk) if (k.startsWith(`${tabId}|`)) connectOk.delete(k);
    },
    onWindowRemoved(windowId: number) {
      for (const c of confirms.values()) if (c.windowId === windowId) c.resolve(false);
    },
    /** for tests */
    _tab: (id: number) => tabs.get(id),
    sha256Hex,
  };
}

export type Core = ReturnType<typeof createCore>;
