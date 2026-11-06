import { render, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState } from '../shared/types';
import { ago, getState, openPage, send, short } from './api';
import { GuardChip, ProtocolCard, TopBar } from './components';
import { Copey, Icon, type IconName } from './icons';
import { scanPositions, type Scan } from './positions';

function Dashboard() {
  const [st, setSt] = useState<PublicState | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setSt(await getState());
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
    void (async () => {
      const s = await getState();
      setSt(s);
      if (s.settings.account && s.protocols.length) void runScan(s);
    })();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);
  if (!st) return <div class="wrap muted" style="padding-top:24px">Loading…</div>;

  const openKit = async (name: string) => {
    setMsg(null);
    const r = await send<{ ok: boolean; error?: string }>({ t: 'openKit', name });
    if (!r.ok) setMsg(r.error ?? 'Could not open the kit.');
  };
  const s = st.stats;
  const exportStats = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: st.version, stats: s }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'copeybara-stats.json';
    a.click();
  };

  const total = Object.values(s.requestsChecked).reduce((a, b) => a + b, 0);
  const tiles: { key: string; n: number; label: string; tone: 'ok' | 'bad' | '' }[] = [
    { key: 'sitesChecked', n: s.sitesChecked, label: 'protocol pages checked', tone: '' },
    { key: 'verified', n: s.verified, label: 'verified against ENS', tone: 'ok' },
    { key: 'mismatched', n: s.mismatched, label: 'hijacked pages stopped', tone: 'bad' },
    { key: 'pagesBlocked', n: s.pagesBlocked.compromised + s.pagesBlocked.blocklist, label: 'fake / flagged sites blocked', tone: 'bad' },
    { key: 'requestsChecked', n: total, label: 'wallet requests checked', tone: '' },
    { key: 'requestsBlocked', n: s.requestsBlocked, label: 'wallet requests stopped', tone: 'bad' },
    { key: 'dangerous', n: s.requestsChecked.dangerous, label: 'drainer patterns seen', tone: 'bad' },
    { key: 'pageNoise', n: s.pageNoise, label: 'bogus page messages ignored', tone: '' },
  ];
  const head = (icon: IconName, title: string, aside?: ComponentChildren) => (
    <div class="spread section-head">
      <h2><Icon name={icon} size={14} />{title}</h2>
      {aside}
    </div>
  );

  return (
    <div class="wrap">
      <TopBar caption="Dashboard">
        <GuardChip st={st} />
        <button class="secondary small" disabled={busy} onClick={async () => { setBusy(true); await send({ t: 'sync' }); await refresh(); setBusy(false); }}>
          <Icon name="refresh" size={15} />{busy ? 'Reading ENS…' : 'Check ENS now'}
        </button>
        <button class="secondary small" onClick={() => openPage('setup')}><Icon name="settings" size={15} />Setup</button>
      </TopBar>
      <div class="dash-head">
        <div>
          <p class="label" style="margin-bottom:6px"><Icon name="wallet" size={14} />Watching</p>
          <h1 class="num" style="font-family:var(--mono);font-size:20px;font-weight:600;letter-spacing:-0.02em;overflow-wrap:anywhere">{st.settings.account ?? 'no wallet'}</h1>
        </div>
        <p class="muted small" style="margin:0">Last ENS check {ago(s.lastSync)}</p>
      </div>
      {msg && <div class="alert bad small with-icon" data-error><Icon name="x-octagon" size={18} /><div>{msg}</div></div>}

      <section class="dash-section">
        {head('activity', 'What Copeybara did', <span class="tiny muted">Counted on this device only. Nothing is sent anywhere.</span>)}
        <div class="tiles wide" data-stats>
          {tiles.map((t) => (
            <div class={`tile ${t.n > 0 ? t.tone : ''}`}>
              <b data-stat={t.key}>{t.n.toLocaleString()}</b>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="secondary small" onClick={exportStats}><Icon name="download" size={15} />Export JSON</button>
          <button class="secondary small" onClick={async () => { await send({ t: 'resetStats' }); await refresh(); }}>Reset</button>
        </div>
      </section>

      <div class="dash-grid">
        <section class="dash-section">
          {head('wallet', 'Your positions', st.settings.account && (
            <button class="link" disabled={scanning} onClick={() => runScan(st)}><Icon name="refresh" size={14} />Scan again</button>
          ))}
          <div class="card" data-positions style="margin:0">
            {!st.settings.account && <div class="empty"><Copey mood="checking" size={56} /><p class="muted">Add your wallet address in setup to see your positions.</p></div>}
            {scanning && <p class="muted">Finding your positions straight from the contracts…</p>}
            {scan && !scanning && (
              <>
                {scan.found.length === 0 && <div class="empty"><Copey mood="checking" size={56} /><p class="muted">No open positions found in the protocols you follow.</p></div>}
                <ul class="clean positions">
                  {scan.found.map((f) => (
                    <li data-position={f.position.id}>
                      <span class="pos-icon" aria-hidden="true"><Icon name="layers" size={17} /></span>
                      <div class="grow">
                        <b>{f.position.label}</b>
                        {f.amounts.length > 0 && <div class="amounts">{f.amounts.map((a) => `${a.text} ${a.symbol}`).join(' + ')}</div>}
                        <div class="tiny muted">
                          {f.protocol}
                          {f.position.manual && ` · ${f.position.manual}`}
                        </div>
                      </div>
                      <button class="small-btn" onClick={() => openKit(f.protocol)}>Exit safely</button>
                    </li>
                  ))}
                </ul>
                {scan.errors.length > 0 && <p class="small warn-text">{scan.errors.join(' · ')}</p>}
                {scan.block !== null && (
                  <p class="foot-note" style="margin:12px 0 0">
                    <Icon name="link" size={13} />
                    <span>Read at block <span class="num">{scan.block.toString()}</span> through {st.settings.userRpcs.length + (st.settings.useDefaultRpcs ? 3 : 0)} RPCs.</span>
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <section class="dash-section">
          {head('shield', 'Protocols you follow')}
          {st.protocols.length === 0 && <div class="card empty" style="margin:0"><Copey mood="checking" size={56} /><p class="muted">None yet. <a href="#" onClick={(e) => (e.preventDefault(), openPage('setup'))}>Add one</a>.</p></div>}
          {st.protocols.map((p) => (
            <div class="proto-block">
              <ProtocolCard p={p} />
              <div class="proto-actions">
                <button onClick={() => openKit(p.name)}><Icon name="log-out" size={16} />Exit safely</button>
                <button class="secondary" onClick={async () => { await send({ t: 'unfollow', name: p.name }); await refresh(); }}>Unfollow</button>
              </div>
            </div>
          ))}
        </section>
      </div>

      <p class="muted tiny" style="margin-top:28px;font-family:var(--mono)">Copeybara {st.version} · wallet {st.settings.account ? short(st.settings.account) : 'not set'}</p>
    </div>
  );
}

render(<Dashboard />, document.getElementById('app')!);
