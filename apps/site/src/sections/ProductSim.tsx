/**
 * Faithful, self-contained replicas of the real product UI for the landing and extension pages:
 *   SimPanel  the extension's side panel (apps/extension/src/pages/sidepanel.tsx, components.tsx, ui.css, dark theme)
 *   SimKit    the exit kit (apps/kit/src/app.tsx, screens/Stepper.tsx, styles.css, light theme)
 *   HeroSim   both, in a browser window with the panel docked on the right (stacked on phones)
 * Nothing here imports extension or kit code: it is markup and scoped CSS (sim.css) only.
 * With prefers-reduced-motion the timeline never starts and a single static frame is shown.
 */
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion, useInView } from '../motion';
import { DRAINER_HOST, ENS_NAME, KIT_VERSION, PANEL_POSITIONS, RESCUE, SITE_HOST, SITE_VERDICT, TILES, short, type TileKey } from '../sim';
import '../sim.css';

/* ---------------------------------------------------------------- timeline */

export const PHASES = [
  ['calm', 3400],
  ['hijack', 2300],
  ['drainer', 2300],
  ['cancelled', 1200],
  ['scroll', 1500],
  ['exit', 1700],
  ['rescued', 3200],
  ['back', 1400],
] as const;
export type Phase = (typeof PHASES)[number][0];
const at = (p: Phase) => PHASES.findIndex(([n]) => n === p);

/** Phase of the loop, advancing only while `run` (on screen, motion allowed). `loop` counts completed loops. */
export function useTimeline(run: boolean) {
  const [s, setS] = useState({ i: 0, loop: 0 });
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => setS(({ i, loop }) => (i === PHASES.length - 1 ? { i: 0, loop: loop + 1 } : { i: i + 1, loop })), PHASES[s.i]![1]);
    return () => clearTimeout(t);
  }, [s, run]);
  return { phase: PHASES[s.i]![0], i: s.i, loop: s.loop };
}

/** Counter events in each loop: the hijacked page, the drainer request (checked, then stopped), the site verified again. */
const EVENTS: { key: TileKey; after: Phase }[] = [
  { key: 'mismatched', after: 'hijack' },
  { key: 'requestsChecked', after: 'drainer' },
  { key: 'requestsBlocked', after: 'cancelled' },
  { key: 'verified', after: 'back' },
];
export function tileCounts(i: number, loop: number): Record<TileKey, number> {
  const out = Object.fromEntries(TILES.map((t) => [t.key, t.base])) as Record<TileKey, number>;
  for (const e of EVENTS) out[e.key] += loop + (i >= at(e.after) ? 1 : 0);
  return out;
}

/** Animates a number from what it shows now to `to`, once `on`. */
function useTween(to: number, on: boolean, ms = 1100) {
  const [v, setV] = useState(() => (on && reducedMotion() ? to : 0));
  const cur = useRef(v);
  useEffect(() => {
    if (!on) return;
    if (reducedMotion() || typeof requestAnimationFrame === 'undefined') {
      cur.current = to;
      return setV(to);
    }
    const from = cur.current;
    if (from === to) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const n = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      cur.current = n;
      setV(n);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, on]);
  return v;
}

function useMedia(q: string) {
  const get = () => typeof matchMedia !== 'undefined' && matchMedia(q).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [q]);
  return m;
}

/* ---------------------------------------------------------------- icons (extension: 1.75px line icons; kit: its own set) */

const PATHS = {
  'shield-check': <><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  shield: <path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z" />,
  'x-octagon': <><path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2Z" /><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20H20V8H6.5A2.5 2.5 0 0 1 4 5.5" /><path d="M16.5 14h.01" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 3.5V8h4.5" /><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20.5V16h-4.5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  'log-out': <><path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5" /><path d="m15.5 16.5 4.5-4.5-4.5-4.5M20 12H9.5" /></>,
  pin: <><path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" /><path d="M12 13v7" /></>,
  exit: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4" /><path d="M6 12h10" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  fingerprint: <><path d="M6.5 7.5A7 7 0 0 1 19 12v1" /><path d="M5 11.5v.5a12 12 0 0 0 1.5 6" /><path d="M9 19.5a10 10 0 0 1-1.5-6.5V12a4.5 4.5 0 0 1 9 0v1.5" /><path d="M12 12v1.5a8 8 0 0 0 2.5 6" /></>,
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 10" /></>,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  fwd: <path d="M5 12h14m-6-6 6 6-6 6" />,
  reload: <><path d="M19 12a7 7 0 1 1-2.1-5" /><path d="M19 4v4h-4" /></>,
  star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8Z" />,
  puzzle: <path d="M10 4a2 2 0 0 1 4 0v2h4v4h-2a2 2 0 0 0 0 4h2v4h-4v-2a2 2 0 0 0-4 0v2H6v-4h2a2 2 0 0 0 0-4H6V6h4Z" />,
  sidebar: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M14 5v14" /></>,
  tune: <><path d="M5 8h9M18 8h1M5 16h1M10 16h9" /><circle cx="16" cy="8" r="2" /><circle cx="8" cy="16" r="2" /></>,
} satisfies Record<string, JSX.Element>;
type IconName = keyof typeof PATHS;

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg class="sim-ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

const CAPY = 'M10 73c2-17 10-33 19-46a7 7 0 0 1-3-6 8 8 0 0 1 15-3c6-2 13-1 20 1l27 6c4 1 6 3 6 7v17c0 7-4 10-10 11l-24 2-9 11H10Zm52-36a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z';
/** The Copeybara mark: lime capybara on a near-black tile. */
function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg class="sim-mark" viewBox="0 0 104 104" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="104" height="104" rx="26" fill="#141615" />
      <path fill="#c4fa4f" fill-rule="evenodd" transform="translate(11 17) scale(.8)" d={CAPY} />
    </svg>
  );
}

/* ---------------------------------------------------------------- side panel */

function Section({ title, icon, aside, children, sref, name }: { title: string; icon: IconName; aside?: ComponentChildren; children: ComponentChildren; sref?: Ref<HTMLElement>; name: string }) {
  return (
    <section class="sp-section" ref={sref} data-sim-section={name}>
      <div class="sp-section-head">
        <h3><Icon name={icon} size={14} />{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, tone, n, bump }: { label: string; tone: string; n: number; bump: boolean }) {
  return (
    <div class={`sp-tile ${n > 0 ? tone : ''}${bump ? ' bump' : ''}`}>
      <b>{n.toLocaleString('en-US')}</b>
      <span>{label}</span>
    </div>
  );
}

export interface PanelState {
  phase: Phase;
  i: number;
  loop: number;
  running: boolean;
}

/**
 * The side panel, dark theme (the extension follows the system theme; this is its dark one).
 * `height` clips it like a real panel; the timeline scrolls it down to the counters and back.
 */
export function SimPanel({ st, height, chrome = true }: { st: PanelState; height?: number; chrome?: boolean }) {
  const { phase, i, loop, running } = st;
  const bad = i >= at('hijack') && i < at('back');
  const toast = phase === 'drainer' ? 'ask' : phase === 'cancelled' ? 'done' : null;
  const down = phase === 'scroll' || phase === 'exit' || phase === 'rescued';

  const viewport = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const tiles = useRef<HTMLElement>(null);
  const [offset, setOffset] = useState(0);
  const [canScroll, setCanScroll] = useState(false);
  useLayoutEffect(() => {
    const v = viewport.current;
    const c = inner.current;
    const t = tiles.current;
    if (!v || !c || !t) return;
    const max = Math.max(0, c.scrollHeight - v.clientHeight);
    setCanScroll(max > 8);
    setOffset(down ? Math.min(max, Math.max(0, t.offsetTop + t.offsetHeight - v.clientHeight + 14)) : 0);
  }, [down, height]);

  // the counters count up the first time they are on screen, then tick with each event
  const [seen, setSeen] = useState(!running);
  useEffect(() => {
    if (!seen && running && (down || !canScroll)) setSeen(true);
  }, [down, canScroll, running]);
  const counts = tileCounts(i, loop);
  const bumped = new Set(EVENTS.filter((e) => i === at(e.after) || (e.after === 'back' && i === 0 && loop > 0)).map((e) => e.key));
  const n = Object.fromEntries(TILES.map((t) => [t.key, useTween(counts[t.key], seen)])) as Record<TileKey, number>;

  const v = bad ? SITE_VERDICT.bad : SITE_VERDICT.ok;
  return (
    <div class={`sim-panel${running ? ' is-live' : ' is-static'}`} data-sim-panel data-phase={phase} data-static={running ? undefined : ''}>
      {chrome && (
        <div class="sp-chrome" aria-hidden="true">
          <Mark size={15} />
          <span>Copeybara</span>
          <i><Icon name="pin" size={14} /></i>
          <i><Icon name="x" size={14} /></i>
        </div>
      )}
      <div class="sp-viewport" ref={viewport} style={height ? { height: `${height}px` } : undefined}>
        <div class="sp-scroll" ref={inner} style={{ transform: `translateY(${-offset}px)` }}>
          <header class="sp-top">
            <div class="sp-brand">
              <Mark size={30} />
              <span><b>Copeybara</b><small>Your DeFi safety net</small></span>
            </div>
            <span class="sp-pill ok"><i class="sp-pulse" aria-hidden="true" />Protected</span>
          </header>

          <div class="sp-body">
            <div class={`sp-card sp-site ${bad ? 'tone-bad' : 'tone-ok'}`} data-sim-section="site" data-site={bad ? 'mismatch' : 'match'}>
              <div class="sp-site-label">
                <span class="sp-label"><Icon name="globe" size={14} />This site</span>
                <span class="sp-host">{SITE_HOST}</span>
              </div>
              <div class="sp-site-hero">
                <span class="sp-copey" aria-hidden="true">
                  <img src="copey/verified.webp" alt="" class={bad ? '' : 'on'} width={78} height={78} />
                  <img src="copey/worried.webp" alt="" class={bad ? 'on' : ''} width={78} height={78} />
                </span>
                <div class="sp-grow">
                  <h4 key={v.title}>{bad ? <Icon name="x-octagon" size={17} /> : <Icon name="shield-check" size={17} />}{v.title}</h4>
                  <p>{v.detail}</p>
                </div>
              </div>
              <span class={`sp-btn block${bad ? ' danger' : ''}`}><Icon name="log-out" size={16} />Exit safely</span>
              <p class="sp-tiny sp-center">Opens {ENS_NAME}’s verified exit kit, independent of this site.</p>
            </div>

            <Section name="positions" title="Your positions" icon="wallet" aside={<span class="sp-link"><Icon name="refresh" size={13} />Scan again</span>}>
              <div class="sp-card">
                <ul class="sp-positions">
                  {PANEL_POSITIONS.map((p) => (
                    <li key={p.id}>
                      <span class="sp-pos-icon" aria-hidden="true"><Icon name="layers" size={16} /></span>
                      <div class="sp-grow">
                        <b>{p.label}</b>
                        <div class="sp-amounts">{p.amounts}</div>
                      </div>
                      <span class="sp-small-btn">Exit safely</span>
                    </li>
                  ))}
                </ul>
                <p class="sp-foot"><Icon name="link" size={13} /><span>Read straight from the contracts at block <span class="sp-num">12079512</span>.</span></p>
              </div>
            </Section>

            <Section name="protocols" title="Protocols you follow" icon="shield" aside={<span class="sp-link"><Icon name="refresh" size={13} />Check ENS now</span>}>
              <div class="sp-card">
                <div class="sp-proto">
                  <span class="sp-avatar" aria-hidden="true">{ENS_NAME.slice(0, 1)}</span>
                  <div class="sp-grow">
                    <div class="sp-spread">
                      <b>{ENS_NAME}</b>
                      <span class="sp-pill ok"><Icon name="shield-check" size={13} />All clear</span>
                    </div>
                    <div class="sp-tiny sp-muted">Exit kit <span class="sp-num">v{KIT_VERSION}</span> · checked 17 s ago</div>
                  </div>
                </div>
              </div>
            </Section>

            <Section name="activity" title="What Copeybara did" icon="activity" sref={tiles}>
              <div class="sp-tiles" data-stats>
                {TILES.map((t) => <Tile key={t.key} label={t.label} tone={t.tone} n={n[t.key]} bump={running && bumped.has(t.key)} />)}
              </div>
              <p class="sp-foot"><Icon name="lock" size={13} />Counted on this device only.</p>
            </Section>
          </div>
        </div>

        <div class={`sp-toast${toast ? ' show' : ''}${toast === 'done' ? ' done' : ''}`} data-sim-toast={toast ?? 'hidden'} aria-hidden={toast ? undefined : 'true'}>
          {toast === 'done' ? (
            <p class="sp-toast-done"><Icon name="check" size={16} />Request cancelled. Nothing left your wallet.</p>
          ) : (
            <>
              <div class="sp-toast-head">
                <span class="sp-toast-icon"><Icon name="x-octagon" size={18} /></span>
                <div class="sp-grow">
                  <b>This looks like a wallet drainer</b>
                  <p><span class="sp-mono">{DRAINER_HOST}</span> asked your wallet to let <span class="sp-mono">0x9d1f…c0de</span> spend all your DUSD.</p>
                </div>
              </div>
              <span class={`sp-btn block sm${phase === 'drainer' ? ' press' : ''}`}>Cancel request</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- exit kit */

const RAIL = ['Verify', 'Connect', 'Positions', 'Exit'];

function Node({ state, n }: { state: 'done' | 'now' | 'next'; n: number }) {
  return (
    <svg class="sk-node" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" class="sk-node-ring" />
      {state === 'done' ? (
        <path d="M10 16.5l4 4 8-8.5" fill="none" class="sk-node-mark" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ) : (
        <text x="16" y="16" dy=".36em" text-anchor="middle" class="sk-node-num">{n}</text>
      )}
    </svg>
  );
}

type KitState = 'ready' | 'exiting' | 'done';
export const kitStateOf = (i: number): KitState => (i === at('exit') ? 'exiting' : i >= at('rescued') ? 'done' : 'ready');

/** The exit kit at step 3 (positions found), then exiting and recovered. `compact` drops the title and tabs (phones). */
export function SimKit({ state, compact = false }: { state: KitState; compact?: boolean }) {
  const current = state === 'ready' ? 3 : 4;
  const preview = RESCUE.amounts.map((a) => `${a.amount} ${a.symbol}`).join(' + ');
  return (
    <div class={`sim-kit${compact ? ' compact' : ''}`} data-sim-kit data-state={state}>
      <header class="sk-top">
        <span class="sk-brand">
          <Mark size={26} />
          <span class="sk-wordmark">Copeybara</span>
          <span class="sk-brand-sub">Exit kit</span>
        </span>
        <span class="sk-chip net"><i class="dot" />Sepolia testnet</span>
      </header>
      <div class="sk-main">
        {!compact && (
          <>
            <div class="sk-hero">
              <span class="sk-label pill">Emergency withdrawal</span>
              <p class="sk-h1">Copeybara exit kit</p>
            </div>
            <div class="sk-tabs">
              <span class="on"><Icon name="exit" size={15} />Exit my positions</span>
              <span><Icon name="search" size={15} />Check a transaction</span>
              <span><Icon name="fingerprint" size={15} />Release &amp; exits</span>
            </div>
          </>
        )}
        <ol class="sk-rail">
          {RAIL.map((t, k) => {
            const s = k + 1 < current ? 'done' : k + 1 === current ? 'now' : 'next';
            return (
              <li key={t} class={s}>
                <Node state={s} n={k + 1} />
                <span class="sk-kicker">Step {k + 1}</span>
                <span class="sk-rail-title">{t}</span>
              </li>
            );
          })}
        </ol>

        <div class="sk-card">
          <div class="sk-summary-head">
            <div>
              <div class="sk-label">Protocol</div>
              <p class="sk-serif">{ENS_NAME}</p>
            </div>
            <span class="sk-chip ok-chip"><Icon name="check-circle" size={14} />Verified on ENS</span>
          </div>
          <dl class="sk-stats">
            <div><dt>Kit release</dt><dd><span class="sk-chip">Release v{KIT_VERSION}</span></dd></div>
            <div><dt>RPCs agree</dt><dd class="num">3 of 3</dd></div>
            <div class="wide"><dt>Wallet</dt><dd class="mono">{short(RESCUE.wallet)}</dd></div>
          </dl>
        </div>

        <div class="sk-card">
          <div class="sk-positions-head">
            <div>
              <div class="sk-label">Your positions · Sepolia</div>
              <p class="sk-h2">1 position found{state === 'done' && <span class="sk-muted num"> · 1 recovered</span>}</p>
            </div>
            <span class={`sk-btn${state !== 'ready' ? ' disabled' : ''}`}>Exit all</span>
          </div>
          <div class={`sk-prow${state === 'done' ? ' done' : ''}`}>
            <div class="sk-prow-main">
              <span class="sk-badge" aria-hidden="true">U3</span>
              <div class="sk-grow">
                <div class="sk-prow-title">Uniswap v3 DETH/DUSD 0.3%</div>
                {state !== 'done' && <div class="sk-preview"><span class="sk-muted">You would receive ≈</span> <span class="num">{preview}</span></div>}
              </div>
              {state !== 'done' && <span class={`sk-btn secondary${state === 'exiting' ? ' disabled' : ''}`}>{state === 'exiting' ? 'Exiting…' : 'Exit'}</span>}
            </div>
            {state === 'exiting' && (
              <div class="sk-live"><i class="sk-spinner" aria-hidden="true" />Rehearsing the withdrawal on independent RPC providers…</div>
            )}
            {state === 'done' && (
              <div class="sk-result">
                <span class="sk-chip ok-chip"><Icon name="check-circle" size={14} />Recovered</span>
                <div class="sk-delta num">{RESCUE.amounts.map((a) => `+${a.amount} ${a.symbol}`).join('   ')} back in your wallet</div>
              </div>
            )}
          </div>
        </div>
        {!compact && (
          <p class="sk-foot"><Icon name="shield-check" size={14} /><span>Still trusted: your wallet and its RPC, Ethereum, ENS, and the protocol’s release Safe. No Copeybara server, no analytics.</span></p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- browser + layout */

/** Renders `children` at a fixed design size, scaled down to the width available. */
function Fit({ w, h, children }: { w: number; h: number; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => el.clientWidth > 0 && setS(Math.min(1, el.clientWidth / w));
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <div class="sim-fit" ref={ref} style={{ height: `${Math.round(h * s)}px` }}>
      <div class="sim-fit-in" style={{ width: `${w}px`, height: `${h}px`, transform: `scale(${s})` }}>{children}</div>
    </div>
  );
}

const KIT_URL = `blackout-red.vercel.app/copeybara-kit.html?ens=${ENS_NAME}`;

function Toolbar({ url }: { url: string }) {
  return (
    <div class="sb-toolbar">
      <i><Icon name="back" size={15} /></i>
      <i><Icon name="fwd" size={15} /></i>
      <i><Icon name="reload" size={15} /></i>
      <span class="sb-url"><Icon name="tune" size={13} /><span>{url}</span><Icon name="star" size={13} /></span>
      <i class="sb-ext"><Mark size={16} /></i>
      <i><Icon name="puzzle" size={15} /></i>
      <i class="sb-on"><Icon name="sidebar" size={15} /></i>
    </div>
  );
}

const W = 900;
const H = 690;
const PANEL_W = 328;
const CHROME_H = 78;

function useSim() {
  const [ref, visible] = useInView<HTMLElement>();
  const [still] = useState(reducedMotion);
  const t = useTimeline(visible && !still);
  return { ref, st: { ...t, running: !still } };
}

/** Landing hero: the kit in a browser window with the side panel docked on the right; on phones, panel then kit. */
export function HeroSim() {
  const { ref, st } = useSim();
  const phone = useMedia('(max-width: 700px)');
  const kit = kitStateOf(st.i);
  return (
    <figure class="hero-sim" ref={ref} data-hero-sim data-layout={phone ? 'stack' : 'browser'}>
      {phone ? (
        <div class="sim-stack" aria-hidden="true">
          <div class="sim-sidepanel"><SimPanel st={st} height={470} /></div>
          <div class="sim-browser sb-mini">
            <Toolbar url={KIT_URL} />
            <SimKit state={kit} compact />
          </div>
        </div>
      ) : (
        <Fit w={W} h={H}>
          <div class="sim-browser" aria-hidden="true">
            <div class="sb-tabs">
              <span class="sb-dots"><i /><i /><i /></span>
              <span class="sb-tab"><i class="sb-fav demo">D</i>DemoSwap</span>
              <span class="sb-tab"><i class="sb-fav" />Claim your DemoSwap airdrop</span>
              <span class="sb-tab on"><Mark size={13} />Copeybara exit kit</span>
            </div>
            <Toolbar url={KIT_URL} />
            <div class="sb-view" style={{ height: `${H - CHROME_H}px` }}>
              <div class="sb-page"><SimKit state={kit} /></div>
              <div class="sb-side" style={{ width: `${PANEL_W}px` }}><SimPanel st={st} height={H - CHROME_H - 34} /></div>
            </div>
          </div>
        </Fit>
      )}
      <p class="sr-only">
        A simulation of the Copeybara exit kit with the Copeybara extension’s side panel open beside it. The panel marks the
        DemoSwap site as verified, then stops it when its code no longer matches, and cancels a wallet drainer request; the kit
        withdraws {RESCUE.recovered} straight from the contracts.
      </p>
      <figcaption>The real kit and side panel, rebuilt for this page. Kit amounts are from the last recorded Sepolia rescue; the panel shows a demo wallet, with illustrative counters.</figcaption>
    </figure>
  );
}

/** Extension page hero: the side panel on its own, as Chrome docks it. */
export function PanelSim() {
  const { ref, st } = useSim();
  return (
    <figure class="panel-sim" ref={ref} data-panel-sim>
      <div class="sim-sidepanel" aria-hidden="true"><SimPanel st={st} height={540} /></div>
      <figcaption>The side panel, rebuilt for this page with a demo wallet and illustrative counters.</figcaption>
    </figure>
  );
}
