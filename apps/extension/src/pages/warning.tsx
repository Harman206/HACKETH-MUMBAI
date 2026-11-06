import { render } from 'preact';
import { useState } from 'preact/hooks';
import './ui.css';
import { send } from './api';
import { StatusMark, TopBar } from './components';
import { Copey, Icon } from './icons';
import { Celebration } from './celebrate';
import { blockedReason } from './saved';

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
  const [party, setParty] = useState(true); // "Saved by Copey!" once, on arrival (no gesture yet: the song needs a tap)
  const t = TEXT[reason ?? 'mismatch'] ?? TEXT.mismatch;
  return (
    <div class="wrap warn-wrap" data-reason={reason}>
      <TopBar caption="Protection">
        <span class="pill bad"><Icon name="x-octagon" size={14} />Page blocked</span>
      </TopBar>
      <div class="warn-hero" role="alert">
        <div class="copey-stage bad" aria-hidden="true">
          <Copey mood="worried" size={156} />
          <span class="badge"><Icon name="x-octagon" size={20} /></span>
        </div>
        <p class="label" style="justify-content:center;color:var(--bad)">Copeybara stopped this page</p>
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        {note && (
          <div class="alert bad small with-icon note">
            <Icon name="alert-triangle" size={18} />
            <div><b>Note from {name}:</b> {note}</div>
          </div>
        )}
      </div>
      <div class="card safe-card">
        <div class="safe-head">
          <StatusMark tone="ok" size={22} />
          <h2>Your funds are not lost</h2>
        </div>
        <p class="muted">Your positions live in {name}’s contracts, not on its website. The Copeybara exit kit withdraws them straight from the contracts, checked against {name}’s ENS records.</p>
        <div class="row">
          <button id="exit" onClick={async () => {
            const r = await send<{ ok: boolean; error?: string }>({ t: 'openKit', name });
            setMsg(r.ok ? 'The verified exit kit opened in a new tab.' : (r.error ?? 'Could not open the kit.'));
          }}><Icon name="log-out" size={17} />Exit safely with the kit</button>
          {reason !== 'mismatch' && from && (
            <button
              id="recheck"
              class="secondary"
              onClick={async () => {
                setMsg('Reading ENS again…');
                const st = await send<{ protocols?: { name: string; snapshot: { status: { state: string } | null; blocklist: string[] } | null }[] }>({ t: 'sync' });
                const p = st.protocols?.find((x) => x.name === name);
                const host = new URL(from).hostname;
                const still = p?.snapshot?.status?.state === 'compromised' || (p?.snapshot?.blocklist ?? []).some((d) => host === d || host.endsWith(`.${d}`));
                if (still) setMsg(`${name}'s ENS records still flag this site. Use the exit kit.`);
                else location.replace(from);
              }}
            >
              Check ENS again
            </button>
          )}
          <button class="secondary" onClick={() => (history.length > 2 ? history.go(-2) : location.replace('about:blank'))}>Leave this site</button>
        </div>
        {msg && <p class="small" data-kit-msg style="margin-top:12px">{msg}</p>}
      </div>
      <div class="card small">
        <p class="label" style="margin-bottom:10px"><Icon name="eye" size={14} />Details</p>
        {from && <dl class="kv" style="margin:0 0 6px"><dt>Page</dt><dd class="mono">{from}</dd></dl>}
        {unknown.length > 0 && (
          <>
            <p>Code not published by {name}:</p>
            <ul data-unknown class="unknown">{unknown.map((u) => <li>{u}</li>)}</ul>
          </>
        )}
        <p class="muted policy"><Icon name="lock" size={15} /><span>There is no “continue anyway” button on purpose: nobody, including this page, can override the check.</span></p>
      </div>
      {party && <Celebration reason={blockedReason(reason, name)} autoplay={false} onDone={() => setParty(false)} />}
    </div>
  );
}

render(<Warning />, document.getElementById('app')!);
