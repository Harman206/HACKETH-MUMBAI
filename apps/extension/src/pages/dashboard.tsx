import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState } from '../shared/types';
import { ago, getState, ICON, openPage, send, short } from './api';
import { ProtocolCard } from './components';
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
  if (!st) return <div class="wrap muted">Loading…</div>;

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

  return (
    <div class="wrap">
      <div class="spread">
        <div class="brand"><img src={ICON} alt="" />Copeybara</div>
        <div class="row">
          <button class="secondary" disabled={busy} onClick={async () => { setBusy(true); await send({ t: 'sync' }); await refresh(); setBusy(false); }}>{busy ? 'Reading ENS…' : 'Check ENS now'}</button>
          <button class="secondary" onClick={() => openPage('setup')}>Setup</button>
        </div>
      </div>
      <p class="muted small">
        Watching <span class="mono">{st.settings.account ?? 'no wallet'}</span> · last ENS check {ago(s.lastSync)}
      </p>
      {msg && <div class="alert bad small" data-error>{msg}</div>}

      <h2 style="margin-top:20px">Your positions</h2>
      <div class="card" data-positions>
        {!st.settings.account && <p class="muted">Add your wallet address in setup to see your positions.</p>}
        {scanning && <p class="muted">Finding your positions straight from the contracts…</p>}
        {scan && !scanning && (
          <>
            {scan.found.length === 0 && <p class="muted">No open positions found in the protocols you follow.</p>}
            <ul class="clean">
              {scan.found.map((f) => (
                <li class="spread" data-position={f.position.id}>
                  <span>
                    <b>{f.position.label}</b>
                    <br />
                    <span class="small muted">
                      {f.protocol}
                      {f.amounts.length > 0 && ` · ${f.amounts.map((a) => `${a.text} ${a.symbol}`).join(' + ')}`}
                      {f.position.manual && ` · ${f.position.manual}`}
                    </span>
                  </span>
                  <button onClick={() => openKit(f.protocol)}>Exit safely</button>
                </li>
              ))}
            </ul>
            {scan.errors.length > 0 && <p class="small" style="color:var(--warn)">{scan.errors.join(' · ')}</p>}
            {scan.block !== null && <p class="muted small">Read at block {scan.block.toString()} through {st.settings.userRpcs.length + (st.settings.useDefaultRpcs ? 3 : 0)} RPCs.</p>}
          </>
        )}
        {st.settings.account && <button class="secondary small" disabled={scanning} onClick={() => runScan(st)}>Scan again</button>}
      </div>

      <h2 style="margin-top:20px">Protocols you follow</h2>
      {st.protocols.length === 0 && <p class="muted">None yet. <a href="#" onClick={(e) => (e.preventDefault(), openPage('setup'))}>Add one</a>.</p>}
      {st.protocols.map((p) => (
        <div>
          <ProtocolCard p={p} />
          <div class="row" style="margin:-6px 0 12px">
            <button onClick={() => openKit(p.name)}>Exit safely</button>
            <button class="secondary small" onClick={async () => { await send({ t: 'unfollow', name: p.name }); await refresh(); }}>Unfollow</button>
          </div>
        </div>
      ))}

      <h2 style="margin-top:20px">What Copeybara did</h2>
      <p class="muted small">Counted on this device only. Nothing is sent anywhere.</p>
      <div class="stats" data-stats>
        <div class="stat"><b data-stat="sitesChecked">{s.sitesChecked}</b>protocol pages checked</div>
        <div class="stat"><b data-stat="verified">{s.verified}</b>verified against ENS</div>
        <div class="stat"><b data-stat="mismatched">{s.mismatched}</b>hijacked pages stopped</div>
        <div class="stat"><b data-stat="pagesBlocked">{s.pagesBlocked.compromised + s.pagesBlocked.blocklist}</b>fake / flagged sites blocked</div>
        <div class="stat"><b data-stat="requestsChecked">{Object.values(s.requestsChecked).reduce((a, b) => a + b, 0)}</b>wallet requests checked</div>
        <div class="stat"><b data-stat="requestsBlocked">{s.requestsBlocked}</b>wallet requests stopped</div>
        <div class="stat"><b data-stat="dangerous">{s.requestsChecked.dangerous}</b>drainer patterns seen</div>
        <div class="stat"><b data-stat="pageNoise">{s.pageNoise}</b>bogus page messages ignored</div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="secondary small" onClick={exportStats}>Export JSON</button>
        <button class="secondary small" onClick={async () => { await send({ t: 'resetStats' }); await refresh(); }}>Reset</button>
      </div>
      <p class="muted small" style="margin-top:20px">Copeybara {st.version} · wallet {st.settings.account ? short(st.settings.account) : 'not set'}</p>
    </div>
  );
}

render(<Dashboard />, document.getElementById('app')!);
