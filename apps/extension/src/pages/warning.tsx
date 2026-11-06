import { render } from 'preact';
import { useState } from 'preact/hooks';
import './ui.css';
import { ICON, send } from './api';

const q = new URLSearchParams(location.search);
const reason = q.get('reason') as 'compromised' | 'blocklist' | 'mismatch' | null;
const name = q.get('name') ?? '';
const note = q.get('note');
const domain = q.get('domain');
const from = q.get('from');
const unknown = (q.get('unknown') ?? '').split('\n').filter(Boolean);

const TEXT = {
  mismatch: {
    title: 'Stopped: this site is not running the code its team published',
    body: `Copeybara compared every script on this page with the fingerprint ${name}’s 2-of-3 Safe published on ENS. Some code on the page was not published by them. This is what a hijacked website or DNS looks like.`,
  },
  compromised: {
    title: `Stopped: ${name} says its website is compromised`,
    body: `${name}’s ENS record reports the official website as compromised. Copeybara blocked it before it loaded.`,
  },
  blocklist: {
    title: 'Stopped: a known fake site',
    body: `${name} lists ${domain ?? 'this domain'} as an impersonator of its website.`,
  },
};

function Warning() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = TEXT[reason ?? 'mismatch'] ?? TEXT.mismatch;
  return (
    <div class="wrap" data-reason={reason}>
      <div class="brand"><img src={ICON} alt="" />Copeybara</div>
      <div class="alert bad" role="alert">
        <div class="big-icon" aria-hidden="true">⛔</div>
        <h1 style="margin-top:8px">{t.title}</h1>
        <p>{t.body}</p>
        {note && <p><b>Note from {name}:</b> {note}</p>}
      </div>
      <div class="card">
        <h2>Your funds are not lost</h2>
        <p>Your positions live in {name}’s contracts, not on its website. The Copeybara exit kit withdraws them straight from the contracts, checked against {name}’s ENS records.</p>
        <div class="row" style="margin-top:10px">
          <button id="exit" onClick={async () => {
            const r = await send<{ ok: boolean; error?: string }>({ t: 'openKit', name });
            setMsg(r.ok ? 'The verified exit kit opened in a new tab.' : (r.error ?? 'Could not open the kit.'));
          }}>Exit safely with the kit</button>
          <button class="secondary" onClick={() => (history.length > 2 ? history.go(-2) : location.replace('about:blank'))}>Leave this site</button>
        </div>
        {msg && <p class="small" data-kit-msg>{msg}</p>}
      </div>
      <div class="card small">
        <h3 style="margin-top:0">Details</h3>
        {from && <p>Page: <span class="mono">{from}</span></p>}
        {unknown.length > 0 && (
          <>
            <p>Code not published by {name}:</p>
            <ul data-unknown>{unknown.map((u) => <li class="mono">{u}</li>)}</ul>
          </>
        )}
        <p class="muted">There is no “continue anyway” button on purpose: nobody, including this page, can override the check.</p>
      </div>
    </div>
  );
}

render(<Warning />, document.getElementById('app')!);
