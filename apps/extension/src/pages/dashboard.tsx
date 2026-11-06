/**
 * Full dashboard: what needs attention, a safety score, recent activity, positions and protocols.
 * Renders only what the worker decided; the daily activity history is a per-device UI convenience kept in this
 * page's localStorage (never sent anywhere, never read by the worker).
 */
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState, Stats } from '../shared/types';
import { ago, getState, openPage, protocolHealth, send, short, type Tone } from './api';
import { Badges, Chip, GuardChip, shortHealth, TONE_ICON, TopBar } from './components';
import { Copey, Icon, type IconName } from './icons';
import { scanPositions, type Scan } from './positions';

const STALE_MS = 15 * 60_000;
const HISTORY_KEY = 'copeybara.ui.daily.v1';
const DAYS = 7;

type Day = { day: string; total: number; blocked: number };
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const totals = (s: Stats) => ({
  total: s.sitesChecked + Object.values(s.requestsChecked).reduce((a, b) => a + b, 0),
  blocked: s.mismatched + s.pagesBlocked.compromised + s.pagesBlocked.blocklist + s.requestsBlocked,
});

/** Record today's cumulative counters (one entry per day, last 30 kept) and return the history. */
function recordDay(s: Stats): Day[] {
  let h: Day[] = [];
  try {
    h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as Day[];
    if (!Array.isArray(h)) h = [];
  } catch {
    h = [];
  }
  const today = { day: dayKey(Date.now()), ...totals(s) };
  h = [...h.filter((d) => d && d.day !== today.day), today].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* storage unavailable: the chart just shows today */
  }
  return h;
}

/** Per-day activity for the last DAYS days, from cumulative snapshots (a counter reset counts from zero). */
function daily(h: Day[]): { day: string; checks: number; blocks: number }[] {
  const by = new Map(h.map((d) => [d.day, d]));
  const out = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = dayKey(Date.now() - i * 864e5);
    const cur = by.get(day);
    const prev = [...h].reverse().find((d) => d.day < day);
    const delta = (a: number, b: number | undefined) => (b === undefined || a < b ? a : a - b);
    out.push({ day, checks: cur ? delta(cur.total, prev?.total) : 0, blocks: cur ? delta(cur.blocked, prev?.blocked) : 0 });
  }
  return out;
}

function Ring({ score, tone }: { score: number; tone: Tone }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg class={`ring-gauge ${tone}`} viewBox="0 0 132 132" aria-hidden="true">
      <circle cx="66" cy="66" r={r} class="track" />
      <circle cx="66" cy="66" r={r} class="value" stroke-dasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 66 66)" />
      <text x="66" y="70" text-anchor="middle" class="ring-num">{score}</text>
      <text x="66" y="90" text-anchor="middle" class="ring-unit">/ 100</text>
    </svg>
  );
}

function Bars({ data }: { data: { day: string; checks: number; blocks: number }[] }) {
  const W = 520, H = 170, pad = 20, gap = 14;
  const max = Math.max(1, ...data.map((d) => d.checks + d.blocks));
  const bw = (W - gap * (data.length - 1)) / data.length;
  const y = (v: number) => ((H - pad) * v) / max;
  return (
    <svg class="bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Checks and stops per day, last 7 days">
      <line x1="0" x2={W} y1={H - pad + 0.5} y2={H - pad + 0.5} class="base" />
      {data.map((d, i) => {
        const x = i * (bw + gap);
        const hc = y(d.checks), hb = y(d.blocks);
        const wd = new Date(`${d.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' });
        return (
          <g>
            <title>{`${wd}: ${d.checks} checked, ${d.blocks} stopped`}</title>
            <rect x={x} y={0} width={bw} height={H - pad} fill="transparent" />
            {d.checks > 0 && <rect class="bar-check" x={x} y={H - pad - hc} width={bw} height={hc} rx="4" />}
            {d.blocks > 0 && <rect class="bar-block" x={x} y={H - pad - hc - hb - (d.checks > 0 ? 2 : 0)} width={bw} height={Math.max(hb, 3)} rx="4" />}
            <text x={x + bw / 2} y={H - 3} text-anchor="middle" class="bar-label">{i === data.length - 1 ? 'Today' : wd}</text>
          </g>
        );
      })}
    </svg>
  );
}

type Item = { tone: Tone; icon: IconName; text: string; action: string; run: () => unknown };

function Dashboard() {
  const [st, setSt] = useState<PublicState | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Day[]>([]);

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
  useEffect(() => {
    if (st) setHistory(recordDay(st.stats));
  }, [st]);
  if (!st) return <div class="wrap muted" style="padding-top:24px">Loading…</div>;

  const openKit = async (name: string) => {
    setMsg(null);
    const r = await send<{ ok: boolean; error?: string }>({ t: 'openKit', name });
    if (!r.ok) setMsg(r.error ?? 'Could not open the kit.');
  };
  const sync = async () => {
    setBusy(true);
    await send({ t: 'sync' });
    await refresh();
    setBusy(false);
  };
  const s = st.stats;
  const exportStats = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), version: st.version, stats: s }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'copeybara-stats.json';
    a.click();
  };

  // ---- what needs attention: one action each ----
  const hasWallet = !!st.settings.account;
  const health = st.protocols.map((p) => ({ p, h: protocolHealth(p) }));
  const fresh = s.lastSync !== null && Date.now() - s.lastSync < STALE_MS;
  const items: Item[] = [];
  for (const { p, h } of health) {
    if (h.tone === 'bad') items.push({ tone: 'bad', icon: 'x-octagon', text: `${p.name}: ${h.text}`, action: 'Exit now', run: () => openKit(p.name) });
    else if (h.tone === 'warn') items.push({ tone: 'warn', icon: 'alert-triangle', text: `${p.name}: ${h.text}`, action: 'Re-check', run: sync });
  }
  if (!hasWallet) items.push({ tone: 'warn', icon: 'wallet', text: 'Add the wallet you want watched', action: 'Add wallet', run: () => openPage('setup') });
  if (st.protocols.length === 0) items.push({ tone: 'warn', icon: 'shield', text: 'Follow a protocol you use', action: 'Follow one', run: () => openPage('setup') });
  else if (!fresh) items.push({ tone: 'warn', icon: 'refresh', text: `ENS last checked ${ago(s.lastSync)}`, action: 'Re-check', run: sync });
  if (!st.settings.setupDone) items.push({ tone: 'grey', icon: 'settings', text: 'Finish setup', action: 'Continue', run: () => openPage('setup') });
  if (scan && scan.errors.length > 0) items.push({ tone: 'warn', icon: 'layers', text: 'Some positions could not be read', action: 'Scan again', run: () => runScan(st) });

  // ---- safety score ----
  const checks = [
    { ok: hasWallet, label: 'Wallet watched' },
    { ok: st.protocols.length > 0 && health.every((x) => x.h.tone === 'ok'), label: 'Protocols healthy' },
    { ok: fresh, label: 'ENS records fresh' },
    { ok: st.settings.setupDone, label: 'Setup complete' },
  ];
  const score = Math.round((100 * checks.filter((c) => c.ok).length) / checks.length);
  const compromised = health.some((x) => x.h.tone === 'bad');
  const scoreTone: Tone = compromised ? 'bad' : score === 100 ? 'ok' : 'warn';

  const blockedPages = s.pagesBlocked.compromised + s.pagesBlocked.blocklist;
  const requests = Object.values(s.requestsChecked).reduce((a, b) => a + b, 0);
  const big: { key: string; n: number; label: string; tone: 'ok' | 'bad' | '' }[] = [
    { key: 'verified', n: s.verified, label: 'Sites verified', tone: 'ok' },
    { key: 'mismatched', n: s.mismatched, label: 'Hijacks stopped', tone: 'bad' },
    { key: 'requestsChecked', n: requests, label: 'Requests checked', tone: '' },
    { key: 'requestsBlocked', n: s.requestsBlocked, label: 'Requests stopped', tone: 'bad' },
  ];
  const more: { key: string; n: number; label: string }[] = [
    { key: 'sitesChecked', n: s.sitesChecked, label: 'protocol pages checked' },
    { key: 'pagesBlocked', n: blockedPages, label: 'fake / flagged sites blocked' },
    { key: 'dangerous', n: s.requestsChecked.dangerous, label: 'drainer patterns seen' },
    { key: 'pageNoise', n: s.pageNoise, label: 'bogus page messages ignored' },
  ];

  return (
    <div class="wrap dash">
      <TopBar caption="Dashboard">
        <GuardChip st={st} />
        <button class="secondary small" disabled={busy} onClick={sync}>
          <Icon name="refresh" size={15} />{busy ? 'Reading ENS…' : 'Check ENS now'}
        </button>
        <button class="secondary small" onClick={() => openPage('setup')}><Icon name="settings" size={15} />Setup</button>
      </TopBar>
      {msg && <div class="alert bad small with-icon" data-error><Icon name="x-octagon" size={18} /><div>{msg}</div></div>}

      <div class="dash-top">
        {/* needs attention */}
        <section class={`card attention ${items.length ? 'has-items' : 'clear'}`} data-attention={items.length}>
          {items.length === 0 ? (
            <div class="all-clear">
              <Copey mood="protected" size={112} />
              <div>
                <p class="eyebrow dark-eyebrow">Needs attention · 0</p>
                <h1 class="display-sm">All clear.</h1>
                <p class="muted small" style="margin:4px 0 0">Nothing to do. Copeybara is watching.</p>
              </div>
            </div>
          ) : (
            <>
              <div class="spread section-head" style="margin:0 0 10px">
                <h2><Icon name="alert-triangle" size={14} />Needs attention</h2>
                <span class="count">{items.length}</span>
              </div>
              <ul class="todo">
                {items.map((it) => (
                  <li class={it.tone}>
                    <span class="todo-icon"><Icon name={it.icon} size={17} /></span>
                    <span class="grow">{it.text}</span>
                    <button class={`small ${it.tone === 'bad' ? 'danger' : ''}`} onClick={it.run}>{it.action}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* safety score */}
        <section class="card score">
          <div class="spread section-head" style="margin:0 0 6px"><h2><Icon name="shield-check" size={14} />Safety score</h2></div>
          <div class="score-body">
            <Ring score={score} tone={scoreTone} />
            <ul class="checks">
              {checks.map((c) => (
                <li class={c.ok ? 'ok' : 'no'}><Icon name={c.ok ? 'check' : 'x'} size={14} />{c.label}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      {/* activity */}
      <section class="card activity">
        <div class="spread section-head" style="margin:0 0 10px">
          <h2><Icon name="activity" size={14} />Last 7 days</h2>
          <span class="legend"><i class="sw check" />Checked<i class="sw block" />Stopped</span>
        </div>
        <div class="activity-body">
          <Bars data={daily(history)} />
          <div class="big-stats" data-stats>
            {big.map((t) => (
              <div class={`big ${t.n > 0 ? t.tone : ''}`}>
                <b data-stat={t.key}>{t.n.toLocaleString()}</b>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
        </div>
        <details class="more">
          <summary>All counters</summary>
          <ul class="more-list">
            {more.map((m) => <li><b data-stat={m.key} class="num">{m.n.toLocaleString()}</b> {m.label}</li>)}
          </ul>
          <div class="row" style="margin-top:10px">
            <button class="secondary small" onClick={exportStats}><Icon name="download" size={15} />Export JSON</button>
            <button class="secondary small" onClick={async () => { await send({ t: 'resetStats' }); await refresh(); }}>Reset</button>
            <span class="tiny muted">On this device only.</span>
          </div>
        </details>
      </section>

      {/* positions */}
      <section class="dash-section">
        <div class="spread section-head">
          <h2><Icon name="wallet" size={14} />Your positions</h2>
          {hasWallet && <button class="link" disabled={scanning} onClick={() => runScan(st)}><Icon name="refresh" size={14} />Scan again</button>}
        </div>
        <div data-positions>
          {!hasWallet && <div class="card empty" style="margin:0"><Copey mood="checking" size={56} /><p class="muted">Add your wallet in setup to see your positions.</p></div>}
          {scanning && <div class="card empty" style="margin:0"><Copey mood="checking" size={56} /><p class="muted">Reading your positions from the contracts…</p></div>}
          {scan && !scanning && (
            <>
              {scan.found.length === 0 && <div class="card empty" style="margin:0"><Copey mood="checking" size={56} /><p class="muted">No open positions.</p></div>}
              <div class="pos-grid">
                {scan.found.map((f) => (
                  <div class="pos-card" data-position={f.position.id}>
                    <div class="pos-top">
                      <span class="pos-icon" aria-hidden="true"><Icon name="layers" size={17} /></span>
                      <b class="grow">{f.position.label}</b>
                    </div>
                    {f.amounts.length > 0 && <div class="amounts">{f.amounts.map((a) => `${a.text} ${a.symbol}`).join(' + ')}</div>}
                    <div class="tiny muted">{f.protocol}{f.position.manual && ` · ${f.position.manual}`}</div>
                    <Badges position={f.position} />
                    <button class="block" onClick={() => openKit(f.protocol)}><Icon name="log-out" size={16} />Exit safely</button>
                  </div>
                ))}
              </div>
              {scan.block !== null && (
                <p class="foot-note"><Icon name="link" size={13} /><span>Read at block <span class="num">{scan.block.toString()}</span> through {st.settings.userRpcs.length + (st.settings.useDefaultRpcs ? 3 : 0)} RPCs.</span></p>
              )}
            </>
          )}
        </div>
      </section>

      {/* protocols: one row each */}
      <section class="dash-section">
        <div class="spread section-head"><h2><Icon name="shield" size={14} />Protocols</h2></div>
        {st.protocols.length === 0 && <div class="card empty" style="margin:0"><Copey mood="checking" size={56} /><p class="muted">None yet. <a href="#" onClick={(e) => (e.preventDefault(), openPage('setup'))}>Add one</a>.</p></div>}
        <div class="card proto-list" style="margin:0" hidden={st.protocols.length === 0}>
          {health.map(({ p, h }) => (
            <div class="proto-line">
              <div class="proto-id" data-protocol={p.name}>
                <span class="proto-avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
                <div class="grow">
                  <b class="name">{p.name}</b>
                  <div class="tiny muted">
                    {p.snapshot ? <>Kit <span class="num">v{p.snapshot.release.version}</span> · {p.snapshot.site ? `${p.snapshot.site.length} scripts` : 'no site fingerprint'} · {ago(p.snapshot.syncedAt)}</> : (p.error ?? 'Reading ENS…')}
                  </div>
                </div>
                <Chip tone={h.tone} icon={TONE_ICON[h.tone]} title={h.text}>{shortHealth(h.tone)}</Chip>
              </div>
              <div class="proto-btns">
                <button class="small" onClick={() => openKit(p.name)}><Icon name="log-out" size={15} />Exit safely</button>
                <button class="secondary small" onClick={async () => { await send({ t: 'unfollow', name: p.name }); await refresh(); }}>Unfollow</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p class="muted tiny" style="margin-top:28px;font-family:var(--mono)">Copeybara {st.version} · wallet {st.settings.account ? short(st.settings.account) : 'not set'}</p>
    </div>
  );
}

render(<Dashboard />, document.getElementById('app')!);
