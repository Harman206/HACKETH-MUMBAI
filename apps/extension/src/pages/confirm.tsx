import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PendingConfirm } from '../shared/types';
import { ICON, send } from './api';

const id = new URLSearchParams(location.search).get('id') ?? '';

function Confirm() {
  const [p, setP] = useState<PendingConfirm | null | undefined>(undefined);
  const [understood, setUnderstood] = useState(false);
  useEffect(() => {
    void send<PendingConfirm | null>({ t: 'getConfirm', id }).then(setP);
  }, []);
  const decide = async (allow: boolean) => {
    await send({ t: 'confirmDecision', id, allow });
    window.close();
  };
  if (p === undefined) return <div class="wrap muted">Loading…</div>;
  if (p === null) return <div class="wrap"><p>This request is no longer waiting.</p><button onClick={() => window.close()}>Close</button></div>;
  const c = p.classification;
  const dangerous = c.verdict === 'dangerous';
  return (
    <div class="wrap" data-verdict={c.verdict}>
      <div class="brand"><img src={ICON} alt="" />Copeybara</div>
      <div class={`alert ${dangerous ? 'bad' : 'warn'}`}>
        <div class="big-icon" aria-hidden="true">{dangerous ? '⛔' : '⚠️'}</div>
        <h1 style="margin-top:8px">{dangerous ? 'This looks like a wallet drainer' : 'Check this request'}</h1>
        <p class="small"><span class="mono">{p.origin}</span> asked your wallet for <b>{c.method}</b>.</p>
      </div>
      <div class="card">
        <ul data-reasons>{c.reasons.map((r) => <li>{r}</li>)}</ul>
        {p.context && <p class="small"><b>{p.context}</b></p>}
        {c.counterparty && <p class="small">Address involved: <span class="mono">{c.counterparty}</span></p>}
      </div>
      <button id="cancel" style="width:100%" onClick={() => decide(false)}>Cancel request (recommended)</button>
      {dangerous && (
        <label class="check small">
          <input id="understand" type="checkbox" checked={understood} onChange={(e) => setUnderstood((e.target as HTMLInputElement).checked)} />
          I understand this can give away the tokens in my wallet.
        </label>
      )}
      <button id="continue" class="secondary" style="width:100%;margin-top:8px" disabled={dangerous && !understood} onClick={() => decide(true)}>
        Continue to my wallet anyway
      </button>
    </div>
  );
}

render(<Confirm />, document.getElementById('app')!);
