/**
 * The extension's trust core (runs in the service worker). It alone reads ENS, keeps state, computes verdicts and
 * writes storage. Content scripts send it page-derived inputs; extension pages send user choices. Neither can hand
 * it a verdict. All chrome APIs come in through `deps.chrome` so the logic is unit-tested with a fake.
 */
import { hostMatches, type Address, type ReleaseRecord } from '@copeybara/core';
import { normaliseName, type CopeybaraRecords } from '@copeybara/ens';
import { classifyRequest, type Classification } from '@copeybara/guard';
import { checkScripts, sha256Hex, type CodeItem } from '@copeybara/sitecheck';
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
  runtime: { id: string; getURL(path: string): string };
  storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> } };
  tabs: {
    update(tabId: number, props: { url: string }): Promise<unknown>;
    create(props: { url: string }): Promise<unknown>;
    sendMessage(tabId: number, msg: unknown): Promise<unknown>;
  };
  windows: { create(o: { url: string; type: 'popup'; width: number; height: number; focused?: boolean }): Promise<{ id?: number }> };
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
  /** how long a page waits for the user in the confirm window */
  confirmTimeoutMs?: number;
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
  const confirms = new Map<string, { pending: PendingConfirm; resolve: (allow: boolean) => void; windowId?: number }>();
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
    const c: Classification = classifyRequest({ method: msg.method, params: msg.params }, {
      account: fromParam ?? settings.account,
      chainId: msg.chainId ?? ENS_CHAIN_ID,
      manifests,
    });
    if (c.verdict === 'pass') return { decision: 'allow', verdict: 'pass', reasons: c.reasons };
    stats.requestsChecked[c.verdict]++;

    const site = t?.site;
    if (t?.blocked || (site?.kind === 'protocol' && (site.verdict === 'mismatch' || site.verdict === 'compromised')) || site?.kind === 'blocklisted') {
      stats.requestsBlocked++;
      await save(['stats']);
      return { decision: 'block', verdict: c.verdict, reasons: ['Blocked: this site is not running the code its protocol published.', ...c.reasons] };
    }
    let context: string | null = null;
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
    const allow = await new Promise<boolean>((resolve) => {
      const entry: { pending: PendingConfirm; resolve: (a: boolean) => void; windowId?: number } = { pending, resolve };
      confirms.set(id, entry);
      chrome.windows
        .create({ url: chrome.runtime.getURL(`/src/pages/confirm.html?id=${id}`), type: 'popup', width: 440, height: 640, focused: true })
        .then((w) => (entry.windowId = w.id))
        .catch(() => resolve(false));
      setTimeout(() => resolve(false), deps.confirmTimeoutMs ?? 180_000);
    });
    confirms.delete(id);
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
