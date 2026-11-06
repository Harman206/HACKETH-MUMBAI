/**
 * Message schemas between the extension's parts, validated in the worker.
 * Content-script messages carry page-derived data: they are inputs to check, never verdicts to trust.
 */
import { isAddress } from 'viem';
import type { Address } from '@copeybara/core';
import type { CodeItem } from '@copeybara/sitecheck';
import type { Settings } from './types';

export const MAX_ITEMS = 500;
const HASH = /^[0-9a-f]{64}$/;

export type ContentMsg =
  | { t: 'hello' }
  | { t: 'scripts'; items: CodeItem[]; done: boolean }
  | { t: 'request'; id: string; method: string; params: unknown; chainId: number | null }
  | { t: 'kit-address'; address: Address }
  | { t: 'noise' };

export type PageMsg =
  | { t: 'getState' }
  | { t: 'follow'; name: string }
  | { t: 'unfollow'; name: string }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'sync' }
  | { t: 'getConfirm'; id: string }
  | { t: 'confirmDecision'; id: string; allow: boolean }
  | { t: 'acceptAddress' }
  | { t: 'rejectAddress' }
  | { t: 'openKit'; name: string }
  | { t: 'testRpc'; url: string }
  | { t: 'resetStats' }
  | { t: 'getTab'; tabId: number };

const obj = (m: unknown): m is Record<string, unknown> => typeof m === 'object' && m !== null && !Array.isArray(m);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function item(v: unknown): CodeItem | null {
  if (!obj(v)) return null;
  if (v.kind !== 'src' && v.kind !== 'inline' && v.kind !== 'handler') return null;
  if (!str(v.label, 2048)) return null;
  if (!(v.hash === null || (typeof v.hash === 'string' && HASH.test(v.hash)))) return null;
  return { kind: v.kind, label: v.label, hash: v.hash as string | null };
}

export function parseContentMsg(m: unknown): ContentMsg | null {
  if (!obj(m)) return null;
  switch (m.t) {
    case 'hello':
    case 'noise':
      return { t: m.t };
    case 'scripts': {
      if (!Array.isArray(m.items) || m.items.length > MAX_ITEMS || typeof m.done !== 'boolean') return null;
      const items = m.items.map(item);
      if (items.some((i) => i === null)) return null;
      return { t: 'scripts', items: items as CodeItem[], done: m.done };
    }
    case 'request': {
      if (!str(m.id, 64) || !str(m.method, 64)) return null;
      let size = 0;
      try {
        size = JSON.stringify(m.params ?? null).length;
      } catch {
        return null;
      }
      if (size > 200_000) return null;
      const chainId = typeof m.chainId === 'number' && Number.isSafeInteger(m.chainId) && m.chainId > 0 ? m.chainId : null;
      return { t: 'request', id: m.id, method: m.method, params: m.params ?? [], chainId };
    }
    case 'kit-address':
      return typeof m.address === 'string' && isAddress(m.address, { strict: false }) ? { t: 'kit-address', address: m.address as Address } : null;
    default:
      return null;
  }
}

const SETTING_KEYS = ['account', 'userRpcs', 'useDefaultRpcs', 'kitUrl', 'setupDone'] as const;

function settingsPatch(p: unknown): Partial<Settings> | null {
  if (!obj(p)) return null;
  const out: Partial<Settings> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!(SETTING_KEYS as readonly string[]).includes(k)) return null;
    if (k === 'account') {
      if (v !== null && !(typeof v === 'string' && isAddress(v, { strict: false }))) return null;
      out.account = v as Address | null;
    } else if (k === 'userRpcs') {
      if (!Array.isArray(v) || v.length > 8 || !v.every((u) => typeof u === 'string' && isHttpUrl(u))) return null;
      out.userRpcs = v as string[];
    } else if (k === 'kitUrl') {
      if (typeof v !== 'string' || !isHttpUrl(v)) return null;
      out.kitUrl = v;
    } else {
      if (typeof v !== 'boolean') return null;
      out[k as 'useDefaultRpcs' | 'setupDone'] = v;
    }
  }
  return out;
}

export function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return (x.protocol === 'https:' || x.protocol === 'http:') && u.length <= 500;
  } catch {
    return false;
  }
}

export function parsePageMsg(m: unknown): PageMsg | null {
  if (!obj(m)) return null;
  switch (m.t) {
    case 'getState':
    case 'sync':
    case 'acceptAddress':
    case 'rejectAddress':
    case 'resetStats':
      return { t: m.t };
    case 'follow':
    case 'unfollow':
    case 'openKit':
      return str(m.name, 255) ? { t: m.t, name: m.name } : null;
    case 'settings': {
      const patch = settingsPatch(m.patch);
      return patch ? { t: 'settings', patch } : null;
    }
    case 'getConfirm':
      return str(m.id, 64) ? { t: 'getConfirm', id: m.id } : null;
    case 'confirmDecision':
      return str(m.id, 64) && typeof m.allow === 'boolean' ? { t: 'confirmDecision', id: m.id, allow: m.allow } : null;
    case 'getTab':
      return typeof m.tabId === 'number' && Number.isSafeInteger(m.tabId) ? { t: 'getTab', tabId: m.tabId } : null;
    case 'testRpc':
      return typeof m.url === 'string' && isHttpUrl(m.url) ? { t: 'testRpc', url: m.url } : null;
    default:
      return null;
  }
}

/** Who sent a runtime message. Chrome fills `sender`; a web page cannot forge it. */
export interface SenderLike {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number; url?: string };
  frameId?: number;
}

export type SenderKind = { kind: 'page' } | { kind: 'content'; tabId: number; frameId: number; url: string; origin: string } | { kind: 'foreign' };

export function classifySender(s: SenderLike, extensionId: string, extensionOrigin: string): SenderKind {
  if (s.id !== extensionId) return { kind: 'foreign' };
  const url = s.url ?? '';
  // Our own pages (any extension URL of ours: Chrome sets sender.id, which no web page can forge). A content script's
  // sender.url is always the web page it runs in, never an extension URL.
  if (url.startsWith(extensionOrigin) || /^(chrome|moz)-extension:\/\//.test(url)) return { kind: 'page' };
  if (s.tab?.id === undefined || s.tab.id < 0) return { kind: 'foreign' };
  let origin: string;
  try {
    origin = s.origin && s.origin !== 'null' ? s.origin : new URL(url).origin;
  } catch {
    return { kind: 'foreign' };
  }
  return { kind: 'content', tabId: s.tab.id, frameId: s.frameId ?? 0, url, origin };
}
