import type { PageMsg } from '../shared/messages';
import type { ProtocolState, PublicState, SiteState } from '../shared/types';

declare const chrome: {
  runtime: { sendMessage(m: unknown): Promise<unknown>; getURL(p: string): string };
  tabs: { query(q: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>; create(p: { url: string }): Promise<unknown> };
};

export const send = <T = unknown>(m: PageMsg): Promise<T> => chrome.runtime.sendMessage(m) as Promise<T>;
export const getState = () => send<PublicState>({ t: 'getState' });
export const openPage = (p: 'setup' | 'dashboard') => chrome.tabs.create({ url: chrome.runtime.getURL(`src/pages/${p}.html`) });
export const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
export const getTab = (tabId: number) => send<SiteState>({ t: 'getTab', tabId });

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const ago = (ms: number | null | undefined) => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

export type Tone = 'ok' | 'warn' | 'bad' | 'grey';

/** One line describing a followed protocol's health, from its ENS snapshot. */
export function protocolHealth(p: ProtocolState): { tone: Tone; text: string } {
  const s = p.snapshot;
  if (!s) return { tone: 'warn', text: p.error ? `Could not read ENS: ${p.error}` : 'Not read yet' };
  if (s.status?.state === 'compromised') return { tone: 'bad', text: `Compromised${s.status.note ? `: ${s.status.note}` : ''}` };
  if (s.status === null) return { tone: 'warn', text: 'Status record unreadable' };
  if (s.status.state === 'degraded') return { tone: 'warn', text: `Degraded${s.status.note ? `: ${s.status.note}` : ''}` };
  if (p.error) return { tone: 'warn', text: `Last check failed (${p.error}); showing data from ${ago(s.syncedAt)}` };
  return { tone: 'ok', text: 'All clear' };
}

export function siteText(s: SiteState): { tone: Tone; title: string; detail: string } {
  if (s.kind === 'none') return { tone: 'grey', title: 'Not a protocol you follow', detail: 'Copeybara still checks every wallet request this site makes.' };
  if (s.kind === 'blocklisted') return { tone: 'bad', title: 'Known fake site', detail: `${s.protocol} lists ${s.domain} as an impersonator.` };
  switch (s.verdict) {
    case 'match':
      return { tone: 'ok', title: `Verified ${s.protocol} site`, detail: 'Every script on this page is one the protocol published on ENS.' };
    case 'checking':
      return { tone: 'grey', title: `Checking ${s.protocol}…`, detail: 'Comparing this page’s code with the ENS fingerprint.' };
    case 'unset':
      return { tone: 'grey', title: `${s.protocol} has no site fingerprint`, detail: 'The protocol has not published one, so this page cannot be verified.' };
    case 'unverifiable':
      return { tone: 'warn', title: 'Could not check everything', detail: `${s.unreadable.length} script(s) could not be read. Treat this page with care.` };
    case 'stale':
      return { tone: 'warn', title: 'ENS unreachable', detail: 'Copeybara could not confirm this site against fresh ENS records.' };
    case 'mismatch':
      return { tone: 'bad', title: 'Code does not match', detail: `${s.unknown.length} script(s) were not published by ${s.protocol}.` };
    case 'compromised':
      return { tone: 'bad', title: `${s.protocol} reports this site is compromised`, detail: 'Use the exit kit instead.' };
  }
}

export const ICON = new URL('../../public/icon-128.png', import.meta.url).href;
