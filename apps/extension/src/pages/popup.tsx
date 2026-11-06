import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState, SiteState } from '../shared/types';
import { activeTab, getState, getTab, ICON, openPage, protocolHealth, send, siteText } from './api';

function Popup() {
  const [st, setSt] = useState<PublicState | null>(null);
  const [site, setSite] = useState<SiteState>({ kind: 'none' });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setSt(await getState());
      const t = await activeTab();
      if (t?.id !== undefined) setSite(await getTab(t.id));
    })();
  }, []);

  if (!st) return <div class="wrap muted">Loading…</div>;
  const s = siteText(site);
  const protocolName = site.kind === 'protocol' || site.kind === 'blocklisted' ? site.protocol : null;
  const blocked = st.stats.requestsBlocked + st.stats.pagesBlocked.compromised + st.stats.pagesBlocked.blocklist + st.stats.pagesBlocked.mismatch;

  return (
    <div class="wrap">
      <div class="spread">
        <div class="brand"><img src={ICON} alt="" />Copeybara</div>
        <button class="secondary small" onClick={() => openPage('dashboard')}>Dashboard</button>
      </div>

      {!st.settings.setupDone && (
        <div class="alert warn small">
          Setup is not finished. <a href="#" onClick={(e) => (e.preventDefault(), openPage('setup'))}>Finish setup</a>
        </div>
      )}

      <div class="card" data-site={site.kind === 'protocol' ? site.verdict : site.kind}>
        <span class={`pill ${s.tone}`}>{s.tone === 'ok' ? '✓' : s.tone === 'bad' ? '!' : s.tone === 'warn' ? '?' : '•'} This site</span>
        <h2 style="margin-top:8px">{s.title}</h2>
        <p class="muted small">{s.detail}</p>
        {protocolName && (
          <button
            style="margin-top:8px"
            onClick={async () => {
              const r = await send<{ ok: boolean; error?: string }>({ t: 'openKit', name: protocolName });
              setMsg(r.ok ? null : (r.error ?? 'Could not open the kit.'));
            }}
          >
            Exit safely
          </button>
        )}
        {msg && <p class="small" style="color:var(--bad)">{msg}</p>}
      </div>

      <div class="card">
        <h3 style="margin-top:0">Protocols you follow</h3>
        {st.protocols.length === 0 && <p class="muted small">None yet. Add one in setup.</p>}
        <ul class="clean small">
          {st.protocols.map((p) => {
            const h = protocolHealth(p);
            return (
              <li class="spread" data-protocol={p.name}>
                <span>{p.name}</span>
                <span class={`pill ${h.tone}`}>{h.tone === 'ok' ? 'All clear' : h.tone === 'bad' ? 'Compromised' : 'Check'}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div class="stats small">
        <div class="stat"><b data-stat="verified">{st.stats.verified}</b>sites verified</div>
        <div class="stat"><b data-stat="blocked">{blocked}</b>threats blocked</div>
      </div>
    </div>
  );
}

render(<Popup />, document.getElementById('app')!);
