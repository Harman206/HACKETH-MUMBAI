import type { ProtocolState } from '../shared/types';
import { ago, protocolHealth, short } from './api';

function Contracts({ p }: { p: ProtocolState }) {
  const chains = p.snapshot?.manifest.chains ?? {};
  const rows = Object.entries(chains['11155111'] ?? {}).flatMap(([proto, roles]) =>
    Object.entries(roles ?? {}).map(([role, t]) => ({ proto, role, address: t.address, n: t.selectors.length })),
  );
  return (
    <ul class="clean small">
      {rows.map((r) => (
        <li class="spread">
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
      <div class="spread">
        <h2 style="margin:0">{p.name}</h2>
        <span class={`pill ${h.tone}`}>{h.text}</span>
      </div>
      {s ? (
        <>
          <p class="small">
            Exit kit release <b>v{s.release.version}</b> · site fingerprint{' '}
            <b>{s.site ? `${s.site.length} script${s.site.length === 1 ? '' : 's'}` : 'not published'}</b> · official site{' '}
            <span class="mono">{s.url ?? 'not set'}</span>
          </p>
          <p class="muted small">Read from ENS through 3 independent RPCs at block {s.block}, {ago(s.syncedAt)}. Only the protocol’s 2-of-3 Safe can change these records.</p>
          <h3>Contracts you can exit from (Sepolia)</h3>
          <Contracts p={p} />
          {s.problems.length > 0 && <p class="small" style="color:var(--warn)">Unreadable records: {s.problems.map((x) => x.key).join(', ')}</p>}
        </>
      ) : (
        <p class="small" style="color:var(--warn)">{p.error ?? 'Reading…'}</p>
      )}
    </div>
  );
}

