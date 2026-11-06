import { useEffect, useState } from 'preact/hooks';
import { ENS_NAME } from '../content';
import { theaterApi } from './api';
import { CHAPTERS, gate, kitLinks, scoreboard, verifyVerdict, type TState } from './chapters';

const tx = (h: string, fork: boolean) => (fork ? null : `https://sepolia.etherscan.io/tx/${h}`);

function TxLink({ h, fork, label }: { h: string; fork: boolean; label: string }) {
  const u = tx(h, fork);
  return u ? <a href={u} target="_blank" rel="noreferrer noopener">{label}</a> : <span class="mono" title={h}>{label}</span>;
}

/** Booth mode: the interactive four-chapter attack replication, driven against the local harness. */
export function Theater({ base }: { base: string }) {
  const api = theaterApi(base);
  const [s, setS] = useState<TState | null>(null);
  const [victim, setVictim] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [hijack, setHijack] = useState<{ to: string; data: string; value: string } | null>(null);

  useEffect(() => {
    let live = true;
    const poll = () => api.state().then((x) => live && setS(x)).catch((e) => live && setErr((e as Error).message));
    poll();
    api.hijackRequest().then(setHijack).catch(() => {});
    const t = setInterval(poll, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [base]);

  const act = async (name: string, f: () => Promise<unknown>) => {
    setBusy(name);
    setErr('');
    try {
      await f();
      setS(await api.state());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const useWallet = async () => {
    const eth = (window as { ethereum?: { request(a: { method: string }): Promise<string[]> } }).ethereum;
    if (!eth) return setErr('No browser wallet found. Paste the victim address instead.');
    const [a] = await eth.request({ method: 'eth_requestAccounts' });
    if (a) setVictim(a);
  };

  if (!s) return <div class="card">Connecting to the booth harness at {base}…{err && <p class="bad">{err}</p>}</div>;
  const fork = s.network === 'local-fork';
  const board = scoreboard(s);
  const links = hijack ? kitLinks(s, s.ensName ?? ENS_NAME, hijack) : null;
  const Btn = (p: { n: 1 | 2 | 3 | 4; id: string; label: string; onClick(): void; primary?: boolean }) => {
    const g = gate(p.n, s);
    return (
      <button class={`btn ${p.primary === false ? 'ghost' : ''}`} disabled={!g.ok || busy !== null} title={g.ok ? undefined : g.why} onClick={p.onClick}>
        {busy === p.id ? 'Working…' : p.label}
      </button>
    );
  };
  const why = (n: 1 | 2 | 3 | 4) => {
    const g = gate(n, s);
    return g.ok ? null : <p class="muted" style="font-size:14px;margin-top:8px">🔒 {g.why}</p>;
  };

  return (
    <div class="theater">
      {fork && <div class="card notice" role="status"><b>LOCAL FORK</b>: Sepolia is unreachable, so this run uses a local copy of the chain. Transactions are real on the fork but not on the public testnet.</div>}
      <ol class="rail" aria-label="Story progress">
        {CHAPTERS.map((c) => (
          <li class={c.n < s.chapter ? 'done' : c.n === s.chapter ? 'now' : ''} aria-current={c.n === s.chapter ? 'step' : undefined}>
            <span class="dot">{c.n < s.chapter ? '✓' : c.n}</span> {c.title}
          </li>
        ))}
      </ol>
      {err && <div class="card notice" role="alert">{err}</div>}

      <article class="card chapter">
        <p class="num">CHAPTER 1</p><h3>{CHAPTERS[0].title}</h3><p>{CHAPTERS[0].sentence}</p>
        <label for="victim" style="display:block;margin-top:12px;font-weight:700">Victim wallet (use a second MetaMask account, e.g. “Account 2”)</label>
        <div class="cta" style="margin-top:6px">
          <input id="victim" class="field" placeholder="0x…" value={victim} onInput={(e) => setVictim((e.target as HTMLInputElement).value.trim())} />
          <button class="btn ghost" onClick={useWallet}>Use connected wallet</button>
          <Btn n={1} id="prepare" label="Prepare victim wallet" onClick={() => act('prepare', () => api.prepare(victim))} />
        </div>
        {s.victim && (
          <p style="margin-top:12px">Victim <span class="mono">{s.victim}</span> holds <b>{s.victimDusd ?? '…'} DUSD</b> and Uniswap position{s.victimPositions.length === 1 ? '' : 's'} {s.victimPositions.map((p) => `#${p}`).join(', ') || '…'}
            {s.prepareTxs.length > 0 && <> · funded in {s.prepareTxs.map((h, i) => <>{i ? ', ' : ' '}<TxLink h={h} fork={fork} label={`tx ${i + 1}`} /></>)}</>}
            {s.prepared && s.prepareTxs.length === 0 && <> · already funded, reused (no new transactions)</>}</p>
        )}
        <p style="margin-top:8px"><a href={s.links.demoswap} target="_blank" rel="noreferrer">Open DemoSwap</a>: the real site, working normally.</p>
      </article>

      <article class="card chapter">
        <p class="num">CHAPTER 2</p><h3>{CHAPTERS[1].title}</h3><p>{CHAPTERS[1].sentence}</p>
        <div class="cta" style="margin-top:12px">
          <Btn n={2} id="hijack" label="Hijack the domain" onClick={() => act('hijack', () => api.switch('hijack-on'))} />
          {s.switches.hijack && <a class="btn ghost" href={s.links.demoswap} target="_blank" rel="noreferrer">Open DemoSwap (now fake) as the victim</a>}
        </div>
        {why(2)}
        {s.switches.hijack && board.lost.length === 0 && <p style="margin-top:12px">On the fake site, click <b>Connect wallet</b> and approve the request in MetaMask, as a hurried user would. The attacker’s bot is watching.</p>}
        {s.drains.length > 0 && (
          <div class="loss-box">
            <p class="tag" style="background:#c0362c22;color:var(--bad)">Without BLACKOUT</p>
            {s.drains.map((d) => (
              <p>Approval <TxLink h={d.approveTx} fork={fork} label="tx" /> → {d.drainTx ? <>bot drained <b class="bad">{scoreboard({ ...s, drains: [d] }).lost[0] ?? '0'}</b> in <TxLink h={d.drainTx} fork={fork} label="tx" /></> : d.note ?? 'draining…'}</p>
            ))}
          </div>
        )}
      </article>

      <article class="card chapter">
        <p class="num">CHAPTER 3</p><h3>{CHAPTERS[2].title}</h3><p>{CHAPTERS[2].sentence}</p>
        <div class="cta" style="margin-top:12px">
          <Btn n={3} id="site" label={s.switches.site === 'down' ? 'Website is down' : 'Take the website down'} onClick={() => act('site', () => api.switch('site-down'))} />
          <Btn n={3} id="rpc" label={s.switches.rpc === 'down' ? 'RPC is down' : 'Take the RPC down'} onClick={() => act('rpc', () => api.switch('rpc-down'))} />
        </div>
        {why(3)}
        <p style="margin-top:12px">Website: <b class={s.switches.site === 'up' ? 'ok' : 'bad'}>{s.switches.site}</b> · Protocol RPC: <b class={s.switches.rpc === 'up' ? 'ok' : 'bad'}>{s.switches.rpc}</b> · DNS: <b class={s.switches.hijack ? 'bad' : 'ok'}>{s.switches.hijack ? 'hijacked' : 'ok'}</b></p>
      </article>

      <article class="card chapter">
        <p class="num">CHAPTER 4</p><h3>{CHAPTERS[3].title}</h3><p>{CHAPTERS[3].sentence}</p>
        <div class="cta" style="margin-top:12px">
          <Btn n={4} id="verify" label="Verify the saved kit vs the attacker’s kit" onClick={() => act('verify', () => api.verify())} />
          {links && gate(4, s).ok && <a class="btn ghost" href={links.check} target="_blank" rel="noreferrer">Show the attacker’s request in the kit</a>}
          {links && gate(4, s).ok && <a class="btn" href={links.exit} target="_blank" rel="noreferrer">Open the kit and exit</a>}
        </div>
        {why(4)}
        {s.verify && (
          <div class="cols" style="margin-top:12px">
            {[
              { title: 'Saved kit', out: s.verify.real, want: 'match' },
              { title: 'Kit served by the hijacked site', out: s.verify.tampered, want: 'mismatch' },
            ].map((k) => {
              const v = verifyVerdict(k.out);
              return (
                <div class="card">
                  <b>{k.title}</b>
                  <p class={v === 'unverified' ? 'warn' : v === k.want ? 'ok' : 'bad'}>
                    {v === 'match' ? '✓ Fingerprint matches ENS' : v === 'mismatch' ? '✕ Fingerprint does NOT match ENS' : '… Could not verify right now (an RPC provider failed); try again'}
                  </p>
                  <p class="mono">{k.out}</p>
                </div>
              );
            })}
          </div>
        )}
      </article>

      <article class="card scoreboard" aria-live="polite">
        <h3>Scoreboard</h3>
        <div class="replay">
          <div><p class="muted" style="margin:0">Without BLACKOUT (lost)</p><p class="big bad">{board.lost.join(' + ') || '—'}</p>{board.drainTxs.map((h) => <TxLink h={h} fork={fork} label="drain tx " />)}</div>
          <div><p class="muted" style="margin:0">With BLACKOUT (recovered)</p><p class="big ok">{board.recovered.join(' + ') || '—'}</p>{board.rescueTxs.map((h) => <TxLink h={h} fork={fork} label="exit tx " />)}</div>
        </div>
        <p style="margin-top:12px">Time to exit (first outage → confirmed exit): <b>{board.timeToExitSec === null ? '—' : `${board.timeToExitSec} s`}</b></p>
        <p class="muted" style="font-size:14px">Real incident for scale: Curve 2022, one victim lost 400,227.23 USDC (mainnet fork replay, see above).</p>
        <button class="btn ghost" style="margin-top:8px" disabled={busy !== null} onClick={() => act('reset', () => api.switch('reset'))}>Reset switches</button>
      </article>
    </div>
  );
}
