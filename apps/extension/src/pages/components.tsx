import type { ComponentChildren } from 'preact';
import type { ProtocolState, PublicState } from '../shared/types';
import { ago, protocolHealth, short, type Tone } from './api';
import { Brand, Icon, type IconName } from './icons';

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
