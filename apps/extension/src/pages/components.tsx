import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatBuildProof, getBuildProof, type BuildProofView } from './build-proof';
import type { ProtocolState, PublicState } from '../shared/types';
import { ago, protocolHealth, send, short, type Tone } from './api';
import { Brand, Copey, Icon, type IconName } from './icons';
import { CERTIFIED, type CertifiedEntry, type CertifiedVerdict } from '../shared/certified';

export const TONE_ICON: Record<Tone, IconName> = { ok: 'shield-check', bad: 'x-octagon', warn: 'alert-triangle', grey: 'help-circle' };

/** Tinted status chip with a small icon (or a dot). */
export function Chip({ tone, icon, children, title, pulse }: { tone: Tone; icon?: IconName; children: ComponentChildren; title?: string; pulse?: boolean }) {
  return (
    <span class={`pill ${tone}`} title={title}>
      {pulse !== undefined ? <span class={`pulse${pulse ? ' live' : ''}`} aria-hidden="true" /> : icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export const shortHealth = (t: Tone) => (t === 'ok' ? 'All clear' : t === 'bad' ? 'Compromised' : 'Check');

export function StatusMark({ tone, size = 26, icon }: { tone: Tone; size?: number; icon?: IconName }) {
  return (
    <span class={`status-mark ${tone}`} aria-hidden="true">
      <Icon name={icon ?? TONE_ICON[tone]} size={size} />
    </span>
  );
}

type Badge = { tone: 'info' | 'warn'; text: string };
/** Hook / position badges an adapter may attach (e.g. Uniswap v4 hooks), as small chips. */
export function Badges({ position }: { position: object }) {
  const b = (position as { badges?: Badge[] }).badges;
  if (!b || b.length === 0) return null;
  return (
    <div class="badges">
      {b.map((x) => <Chip tone={x.tone === 'warn' ? 'warn' : 'grey'} icon={x.tone === 'warn' ? 'alert-triangle' : 'layers'}>{x.text}</Chip>)}
    </div>
  );
}

/** Overall guard status for the header chip, from the worker's public state. */
export function guardStatus(st: PublicState): { tone: Tone; text: string; live: boolean } {
  if (st.protocols.some((p) => p.snapshot?.status?.state === 'compromised')) return { tone: 'bad', text: 'Alert', live: true };
  const synced = st.protocols.length > 0 && st.protocols.every((p) => p.snapshot);
  if (st.settings.setupDone && synced) return { tone: 'ok', text: 'Protected', live: true };
  if (st.protocols.length > 0) return { tone: 'warn', text: synced ? 'Finish setup' : 'Syncing', live: false };
  return { tone: 'grey', text: 'Not set up', live: false };
}

/** Slim sticky header: logo + wordmark, then whatever sits on the right. */
export function TopBar({ caption, children }: { caption?: string; children?: ComponentChildren }) {
  return (
    <header class="topbar">
      <Brand caption={caption} />
      {children && <div class="row">{children}</div>}
    </header>
  );
}

export function GuardChip({ st }: { st: PublicState }) {
  const g = guardStatus(st);
  return (
    <Chip tone={g.tone} pulse={g.live} title="Copeybara checks every page and wallet request in this browser">
      {g.text}
    </Chip>
  );
}

function Contracts({ p }: { p: ProtocolState }) {
  const chains = p.snapshot?.manifest.chains ?? {};
  const rows = Object.entries(chains['11155111'] ?? {}).flatMap(([proto, roles]) =>
    Object.entries(roles ?? {}).map(([role, t]) => ({ proto, role, address: t.address, n: t.selectors.length })),
  );
  return (
    <ul class="clean small contracts">
      {rows.map((r) => (
        <li>
          <span>{r.proto} · {r.role}</span>
          <span class="mono">{short(r.address)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProtocolCard({ p }: { p: ProtocolState }) {
  const h = protocolHealth(p);
  const s = p.snapshot;
  return (
    <div class="card" data-protocol={p.name}>
      <div class="spread nowrap">
        <div class="proto-row grow">
          <span class="proto-avatar" aria-hidden="true">{p.name.slice(0, 1)}</span>
          <div class="grow">
            <h2 class="name" style="margin:0;font-size:17px">{p.name}</h2>
            <div class="tiny muted">{s ? `Read from ENS at block ${s.block}, ${ago(s.syncedAt)}` : 'ENS records'}</div>
          </div>
        </div>
        <Chip tone={h.tone} icon={TONE_ICON[h.tone]} title={h.text}>{shortHealth(h.tone)}</Chip>
      </div>
      {h.tone !== 'ok' && s && <p class={`small tone-text ${h.tone}`} style="margin:10px 0 0">{h.text}</p>}
      {s ? (
        <>
          <dl class="kv">
            <dt>Exit kit release</dt>
            <dd><b class="num">v{s.release.version}</b></dd>
            <dt>Site fingerprint</dt>
            <dd><b>{s.site ? `${s.site.length} script${s.site.length === 1 ? '' : 's'}` : 'not published'}</b></dd>
            <dt>Official site</dt>
            <dd class="mono">{s.url ?? 'not set'}</dd>
          </dl>
          <h3 class="label" style="margin:18px 0 4px"><Icon name="layers" size={14} />Contracts you can exit from (Sepolia)</h3>
          <Contracts p={p} />
          <p class="foot-note" style="margin:10px 0 0">
            <Icon name="lock" size={14} />
            Checked through 3 independent RPCs. Only the protocol’s 2-of-3 Safe can change these records.
          </p>
          {s.problems.length > 0 && <p class="small warn-text">Unreadable records: {s.problems.map((x) => x.key).join(', ')}</p>}
        </>
      ) : (
        <p class="small warn-text">{p.error ?? 'Reading…'}</p>
      )}
    </div>
  );
}

/** "Build proof": the worker hashes the installed files and compares them with the protocol's ENS record. */
export function BuildProofCard({ compact }: { compact?: boolean }) {
  const [v, setV] = useState<BuildProofView | null>(null);
  useEffect(() => {
    void getBuildProof()
      .then((r) => setV(r ? formatBuildProof(r) : { tone: 'grey', title: 'Build proof unavailable', detail: 'The worker did not answer.', rows: [] }))
      .catch((e) => setV({ tone: 'grey', title: 'Build proof unavailable', detail: (e as Error).message, rows: [] }));
  }, []);
  if (!v) return null;
  const icon = v.tone === 'ok' ? 'shield-check' : v.tone === 'bad' ? 'x-octagon' : v.tone === 'warn' ? 'alert-triangle' : 'shield';
  const shortHash = (x: string) => (/^(0x)?[0-9a-f]{64}$/i.test(x) ? `${x.slice(0, 10)}…${x.slice(-8)}` : x);
  return (
    <div class={`card proof tone-${v.tone}${compact ? ' compact' : ''}`} data-build-proof={v.tone}>
      <div class="proof-head">
        <span class={`status-mark ${v.tone}`} aria-hidden="true"><Icon name={icon} size={18} /></span>
        <div class="grow">
          <p class="label" style="margin-bottom:3px">Build proof</p>
          <b>{v.title}</b>
          <p class="small muted" style="margin:2px 0 0">{v.detail}</p>
        </div>
      </div>
      {v.rows.length > 0 && (
        <details class="more">
          <summary>Hashes</summary>
          <dl class="kv" style="margin-top:8px">
            {v.rows.map((r) => <><dt>{r.label}</dt><dd class="mono" title={r.value}>{shortHash(r.value)}</dd></>)}
          </dl>
        </details>
      )}
    </div>
  );
}

type Live = { state: 'checking' } | { state: 'done'; certified: boolean; block: string; failed: string[] } | { state: 'error'; error: string };

/** One bundled certified entry, its tick re-checked on chain by the worker right now (never taken from the list). */
function CertifiedRow({ e, followed, busy, onFollow }: { e: CertifiedEntry; followed: boolean; busy: boolean; onFollow: (name: string) => void }) {
  const [live, setLive] = useState<Live>({ state: 'checking' });
  useEffect(() => {
    let on = true;
    send<CertifiedVerdict | { error: string }>({ t: 'checkCertified', name: e.name })
      .then((r) => on && setLive(r && 'certified' in r ? { state: 'done', ...r } : { state: 'error', error: (r as { error?: string })?.error ?? 'no answer' }))
      .catch((x) => on && setLive({ state: 'error', error: String((x as Error)?.message ?? x) }));
    return () => void (on = false);
  }, [e.name]);
  const chip =
    live.state === 'checking' ? (
      <Chip tone="grey" pulse={false}>Checking on chain…</Chip>
    ) : live.state === 'error' ? (
      <Chip tone="warn" icon="alert-triangle" title={live.error}>Couldn’t check now</Chip>
    ) : live.certified ? (
      <Chip tone="ok" icon="shield-check" title={`Re-checked at Sepolia block ${live.block}`}>Certified · block {live.block}</Chip>
    ) : (
      <Chip tone="bad" icon="x-octagon" title={`Failing: ${live.failed.join(', ')}`}>Suspended</Chip>
    );
  return (
    <li class="cert-row" data-certified={e.name} data-live={live.state === 'done' ? (live.certified ? 'certified' : 'suspended') : live.state}>
      <span class="cert-avatar" aria-hidden="true">{e.protocol.slice(0, 1)}</span>
      <div class="grow">
        <div class="cert-name"><b>{e.protocol}</b>{chip}</div>
        <div class="mono cert-ens">{e.name}</div>
        {e.note && <p class="tiny muted cert-note">{e.note}</p>}
        {live.state === 'done' && !live.certified && <p class="tiny tone-text bad cert-note">Failing now: {live.failed.join(', ')}. You can still follow it; Copeybara keeps checking its records.</p>}
      </div>
      {followed ? (
        <Chip tone="ok" icon="check">Following</Chip>
      ) : (
        <button class="small-btn" disabled={busy} onClick={() => onFollow(e.name)}>Follow {e.protocol}</button>
      )}
    </li>
  );
}

/** "Pick from Copeybara certified": the directory bundled with this build; each tick re-checked live through the quorum. */
export function CertifiedPicker({ st, busy, onFollow }: { st: PublicState; busy: boolean; onFollow: (name: string) => void }) {
  if (CERTIFIED.length === 0) return null;
  return (
    <section class="cert-pick" aria-labelledby="cert-pick-title">
      <div class="cert-pick-head">
        <Copey mood="verified" size={46} class="cert-pick-copey" />
        <div class="grow">
          <p class="label"><Icon name="shield-check" size={14} />Copeybara certified</p>
          <h3 id="cert-pick-title">Pick a certified protocol</h3>
          <p class="small muted">We checked each one before listing it. The tick is checked again on chain right now, through 3 RPCs.</p>
        </div>
      </div>
      <ul class="clean cert-list">
        {CERTIFIED.map((e) => <CertifiedRow key={e.name} e={e} busy={busy} followed={st.protocols.some((p) => p.name === e.name)} onFollow={onFollow} />)}
      </ul>
    </section>
  );
}
