/**
 * The side panel (Chrome side panel / Firefox sidebar): opens from the toolbar icon and stays beside the page.
 * Live view of the active tab's verdict, setup progress, positions, followed protocols and what Copeybara did.
 * Like every trusted page it only renders what the worker decided; it never draws a verdict itself.
 */
import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState, SiteState } from '../shared/types';
import { ago, getState, getTab, openPage, protocolHealth, send, short, siteText, type Tone } from './api';
import { Badges, Chip, GuardChip, shortHealth, TONE_ICON, TopBar } from './components';
import { Copey, Icon, type IconName, type Mood } from './icons';
import { scanPositions, type Scan } from './positions';

interface TabInfo {
  id?: number;
  url?: string;
  lastAccessed?: number;
}
type Listener<A extends unknown[]> = { addListener(f: (...a: A) => void): void; removeListener(f: (...a: A) => void): void };
declare const chrome: {
  tabs: {
    query(q: { active?: boolean; currentWindow?: boolean }): Promise<TabInfo[]>;
    getCurrent(): Promise<TabInfo | undefined>;
    onActivated: Listener<[unknown]>;
    onUpdated: Listener<[number, { url?: string; status?: string }]>;
  };
};

/**
 * The tab the panel describes: the active tab of the panel's window. When this page is opened as a tab itself
 * (not as a panel), the most recently used other tab of the window.
 */
async function siteTab(): Promise<TabInfo | undefined> {
  const self = await chrome.tabs.getCurrent().catch(() => undefined);
  if (!self) return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const others = (await chrome.tabs.query({ currentWindow: true })).filter((t) => t.id !== self.id);
  return others.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/** Copey's mood for the site card: verified, worried (warn or bad), or still checking / nothing to check. */
const siteMood = (t: Tone): Mood => (t === 'ok' ? 'verified' : t === 'bad' || t === 'warn' ? 'worried' : 'checking');

const hostOf = (url: string | undefined) => {
  try {
    const u = new URL(url ?? '');
    return /^https?:$/.test(u.protocol) ? u.host : null;
  } catch {
    return null;
  }
};

function Section({ title, icon, aside, children }: { title: string; icon: IconName; aside?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="panel-section">
      <div class="spread section-head">
        <h2><Icon name={icon} size={14} />{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Panel() {
  const [st, setSt] = useState<PublicState | null>(null);
  const [site, setSite] = useState<SiteState>({ kind: 'none' });
  const [host, setHost] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const scanKey = useRef('');

  const refreshTab = async () => {
    const t = await siteTab();
    setHost(hostOf(t?.url));
    setSite(t?.id !== undefined ? await getTab(t.id) : { kind: 'none' });
  };
  const refresh = async () => {
    setSt(await getState());
    await refreshTab();
  };
  const runScan = async (s: PublicState) => {
    setScanning(true);
    try {
      setScan(await scanPositions(s.settings, s.protocols));
    } catch (e) {
      setScan({ found: [], errors: [(e as Error).message], block: null });
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onActivated = () => void refreshTab();
    const onUpdated = (_id: number, info: { url?: string; status?: string }) => {
      if (info.url || info.status) void refreshTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      clearInterval(timer);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // scan positions once a wallet and protocols with records are known, and again when they change
  useEffect(() => {
    if (!st) return;
    const key = `${st.settings.account ?? ''}|${st.protocols.filter((p) => p.snapshot).map((p) => p.name).join(',')}`;
    if (key === scanKey.current) return;
    scanKey.current = key;
    if (st.settings.account && st.protocols.some((p) => p.snapshot)) void runScan(st);
    else setScan(null);
  }, [st]);

  if (!st) return <div class="wrap panel muted" style="padding-top:20px">Loading…</div>;

  const openKit = async (name: string) => {
    setMsg(null);
    const r = await send<{ ok: boolean; error?: string }>({ t: 'openKit', name });
    if (!r.ok) setMsg(r.error ?? 'Could not open the exit kit.');
  };
  const checkEns = async () => {
    setSyncing(true);
    try {
      setSt(await send<PublicState>({ t: 'sync' }));
    } finally {
      setSyncing(false);
    }
  };

  const s = siteText(site);
  const siteProtocol = site.kind === 'protocol' || site.kind === 'blocklisted' ? site.protocol : null;
  const followed = siteProtocol !== null && st.protocols.some((p) => p.name === siteProtocol);
  const hasWallet = !!st.settings.account;
  const hasProtocol = st.protocols.length > 0;
  const stats = st.stats;
  const tiles: { key: string; n: number; label: string; tone: Tone }[] = [
    { key: 'verified', n: stats.verified, label: 'sites verified', tone: 'ok' },
    { key: 'mismatched', n: stats.mismatched, label: 'hijacked pages stopped', tone: 'bad' },
    { key: 'pagesBlocked', n: stats.pagesBlocked.compromised + stats.pagesBlocked.blocklist, label: 'fake sites blocked', tone: 'bad' },
    { key: 'requestsChecked', n: Object.values(stats.requestsChecked).reduce((a, b) => a + b, 0), label: 'wallet requests checked', tone: 'grey' },
    { key: 'requestsBlocked', n: stats.requestsBlocked, label: 'drainer requests stopped', tone: 'bad' },
  ];

  return (
    <div class="wrap panel">
      <TopBar caption="Your DeFi safety net">
        <GuardChip st={st} />
      </TopBar>

      {/* (2) this site */}
      <div class={`card site-card tone-${s.tone}`} data-site={site.kind === 'protocol' ? site.verdict : site.kind}>
        <div class="site-label">
          <span class="label"><Icon name="globe" size={14} />This site</span>
          {host && <span class="host" title={host}>{host}</span>}
        </div>
        <div class="site-hero">
          <Copey mood={siteMood(host ? s.tone : 'grey')} size={84} />
          <div class="grow">
            <h3 data-site-title>{host ? s.title : 'No web page open'}</h3>
            <p class="muted">{host ? s.detail : 'Open a DeFi site in this window and Copeybara will check it here.'}</p>
          </div>
        </div>
        {siteProtocol && followed && (
          <>
            <button class={`block ${s.tone === 'bad' ? 'danger' : ''}`} onClick={() => openKit(siteProtocol)}>
              <Icon name="log-out" size={17} />
              Exit safely
            </button>
            <p class="muted tiny center">Opens {siteProtocol}’s verified exit kit, independent of this site.</p>
          </>
        )}
        {msg && <p class="err" data-error><Icon name="x-octagon" size={15} />{msg}</p>}
      </div>

      {/* (3) setup checklist */}
      {!st.settings.setupDone && (
        <div class="card checklist-card" data-checklist>
          <h3>Finish setting up</h3>
          <p class="muted small">Two quick steps and Copeybara can watch your money for you.</p>
          <ul class="checklist">
            <li class={hasWallet ? 'done' : ''}>
              <span class="tick">{hasWallet ? <Icon name="check" size={14} /> : '1'}</span>
              {hasWallet ? <span>Wallet <span class="mono">{short(st.settings.account!)}</span></span> : 'Add the wallet you want watched'}
            </li>
            <li class={hasProtocol ? 'done' : ''}>
              <span class="tick">{hasProtocol ? <Icon name="check" size={14} /> : '2'}</span>
              {hasProtocol ? `Following ${st.protocols.map((p) => p.name).join(', ')}` : 'Follow a protocol you use'}
            </li>
          </ul>
          <button class="block" onClick={() => openPage('setup')}>
            {hasWallet || hasProtocol ? 'Continue setup' : 'Start setup'}
            <Icon name="arrow-right" size={16} />
          </button>
        </div>
      )}

      {/* (4) positions */}
      <Section
        title="Your positions"
        icon="wallet"
        aside={hasWallet && hasProtocol && (
          <button class="link" disabled={scanning} onClick={() => runScan(st)}>
            <Icon name="refresh" size={14} />
            {scanning ? 'Scanning…' : 'Scan again'}
          </button>
        )}
      >
        <div class="card" data-positions>
          {!hasWallet && <div class="empty"><Copey mood="checking" size={52} /><p class="muted small">Add your wallet address in setup to see what you hold.</p></div>}
          {hasWallet && !hasProtocol && <div class="empty"><Copey mood="checking" size={52} /><p class="muted small">Follow a protocol to see your positions in it.</p></div>}
          {scanning && !scan && <p class="muted small">Reading your positions straight from the contracts…</p>}
          {scan && (
            <>
              {scan.found.length === 0 && !scanning && <div class="empty"><Copey mood="checking" size={52} /><p class="muted small">No open positions in the protocols you follow.</p></div>}
              <ul class="clean positions">
                {scan.found.map((f) => (
                  <li data-position={f.position.id}>
                    <span class="pos-icon" aria-hidden="true"><Icon name="layers" size={17} /></span>
                    <div class="grow">
                      <b>{f.position.label}</b>
                      <div class="amounts">
                        {f.amounts.length > 0 ? f.amounts.map((a) => `${a.text} ${a.symbol}`).join(' + ') : (f.position.manual ?? f.protocol)}
                      </div>
                      <Badges position={f.position} />
                    </div>
                    <button class="small-btn secondary" onClick={() => openKit(f.protocol)}>Exit safely</button>
                  </li>
                ))}
              </ul>
              {scan.errors.length > 0 && <p class="small warn-text">{scan.errors.join(' · ')}</p>}
              {scan.block !== null && (
                <p class="foot-note" style="margin:12px 0 0">
                  <Icon name="link" size={13} />
                  <span>Read straight from the contracts at block <span class="num">{scan.block.toString()}</span>.</span>
                </p>
              )}
            </>
          )}
        </div>
      </Section>

      {/* (5) protocols */}
      <Section
        title="Protocols you follow"
        icon="shield"
        aside={hasProtocol && (
          <button class="link" disabled={syncing} onClick={checkEns}>
            <Icon name="refresh" size={14} />
            {syncing ? 'Checking…' : 'Check ENS now'}
          </button>
        )}
      >
        <div class="card">
          {!hasProtocol && (
            <div class="empty">
              <Copey mood="checking" size={52} />
              <p class="muted small">
                None yet. <a href="#" onClick={(e) => (e.preventDefault(), openPage('setup'))}>Follow one in setup</a>.
              </p>
            </div>
          )}
          <ul class="clean">
            {st.protocols.map((p) => {
              const h = protocolHealth(p);
              return (
                <li data-protocol={p.name} class="proto-row">
                  <span class="proto-avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
                  <div class="grow">
                    <div class="spread nowrap">
                      <b class="name">{p.name}</b>
                      <Chip tone={h.tone} icon={TONE_ICON[h.tone]} title={h.text}>{shortHealth(h.tone)}</Chip>
                    </div>
                    <div class="tiny muted">
                      {p.snapshot ? <>Exit kit <span class="num">v{p.snapshot.release.version}</span> · checked {ago(p.snapshot.syncedAt)}</> : (p.error ?? 'Reading ENS…')}
                    </div>
                    {h.tone !== 'ok' && p.snapshot && <div class={`small tone-text ${h.tone}`}>{h.text}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Section>

      {/* (6) activity */}
      <Section title="What Copeybara did" icon="activity">
        <div class="tiles" data-stats>
          {tiles.map((t) => (
            <div class={`tile ${t.n > 0 ? t.tone : ''}`}>
              <b data-stat={t.key}>{t.n.toLocaleString()}</b>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        <p class="foot-note"><Icon name="lock" size={13} />Counted on this device only. Last ENS check {ago(stats.lastSync)}.</p>
      </Section>

      {/* (7) footer */}
      <footer class="panel-foot">
        <a href="#" onClick={(e) => (e.preventDefault(), openPage('setup'))}><Icon name="settings" size={15} />Setup</a>
        <a href="#" onClick={(e) => (e.preventDefault(), openPage('dashboard'))}><Icon name="grid" size={15} />Full dashboard</a>
        <span class="ver">v{st.version}</span>
      </footer>
    </div>
  );
}

render(<Panel />, document.getElementById('app')!);
