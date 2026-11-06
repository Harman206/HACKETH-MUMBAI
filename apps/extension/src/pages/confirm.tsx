import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PendingConfirm } from '../shared/types';
import { send } from './api';
import { Chip, TopBar } from './components';
import { Copey, Icon } from './icons';

const id = new URLSearchParams(location.search).get('id') ?? '';

function Confirm() {
  const [p, setP] = useState<PendingConfirm | null | undefined>(undefined);
  const [understood, setUnderstood] = useState(false);
  useEffect(() => {
    void send<PendingConfirm | null>({ t: 'getConfirm', id }).then(setP);
  }, []);
  const decide = async (allow: boolean) => {
    // the worker closes this window when the decision arrives; window.close() is the fallback
    await send({ t: 'confirmDecision', id, allow }).catch(() => undefined);
    window.close();
  };
  if (p === undefined) return <div class="wrap confirm muted" style="padding-top:20px">Loading…</div>;
  if (p === null)
    return (
      <div class="wrap confirm">
        <TopBar caption="Wallet request" />
        <div class="card"><p>This request is no longer waiting.</p><button onClick={() => window.close()}>Close</button></div>
      </div>
    );
  const c = p.classification;
  const dangerous = c.verdict === 'dangerous';
  const tone = dangerous ? 'bad' : 'warn';
  // a connect request from a look-alike site, stopped before the wallet's own connect popup
  const connect = c.method === 'eth_requestAccounts' || c.method === 'wallet_requestPermissions';
  return (
    <div class="wrap confirm" data-verdict={c.verdict}>
      <TopBar caption="Wallet request">
        <Chip tone={tone} icon={dangerous ? 'x-octagon' : 'alert-triangle'}>{dangerous ? 'Dangerous' : 'Review'}</Chip>
      </TopBar>
      <div class={`card risk-card ${tone}`}>
        <div class="risk-head">
          <Copey mood="worried" size={72} class="risk-copey" />
          <div class="grow">
            <p class="label" style={`color:var(--${tone})`}>{dangerous ? 'High risk' : connect ? 'Look-alike site' : 'Unusual request'}</p>
            <h1>{dangerous ? 'This looks like a wallet drainer' : connect ? 'Don’t connect your wallet here' : 'Check this request'}</h1>
            <p class="small">
              <span class="mono">{p.origin}</span> {connect ? 'asked to connect your wallet' : <>asked your wallet for <b class="num">{c.method}</b></>}.
            </p>
          </div>
        </div>
        <div class="risk-body">
          <ul data-reasons class="reasons">
            {c.reasons.map((r) => <li><Icon name="alert-triangle" size={16} /><span>{r}</span></li>)}
          </ul>
          {(p.context || c.counterparty) && (
            <dl class="kv" style="border-top:1px solid var(--line-soft);padding-top:12px">
              {p.context && <><dt>Context</dt><dd><b>{p.context}</b></dd></>}
              {c.counterparty && <><dt>Address involved</dt><dd class="mono">{c.counterparty}</dd></>}
            </dl>
          )}
        </div>
      </div>
      <div class="decide">
        <button id="cancel" onClick={() => decide(false)}><Icon name="shield-check" size={17} />Cancel request (recommended)</button>
        {dangerous && (
          <label class="check small">
            <input id="understand" type="checkbox" checked={understood} onChange={(e) => setUnderstood((e.target as HTMLInputElement).checked)} />
            I understand this can give away the tokens in my wallet.
          </label>
        )}
        <button id="continue" class="secondary" disabled={dangerous && !understood} onClick={() => decide(true)}>
          {connect ? 'Connect anyway' : 'Continue to my wallet anyway'}
        </button>
      </div>
    </div>
  );
}

render(<Confirm />, document.getElementById('app')!);
