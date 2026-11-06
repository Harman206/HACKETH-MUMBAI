import { HERO, HOW, INCIDENTS, LIMITS, NOT_TRUSTED, PROTOCOL_STEPS, REPLAY_R1, TRUSTED, ENS_NAME } from '../content';
import { Icons } from './Icons';

const etherscan = (h: string) => `https://etherscan.io/tx/${h}`;

export function Hero({ live }: { live: string | null }) {
  return (
    <section class="hero" id="top">
      <div class="wrap">
        <p class="chip"><span class="dot" aria-hidden="true" />{live ?? 'Live on Sepolia testnet'}</p>
        <h1>{HERO.title}</h1>
        <p>{HERO.sub}</p>
        <div class="cta">
          <a class="btn" href="#demo">See the attack live</a>
          <a class="btn ghost" href="blackout-kit.html" target="_blank" rel="noopener">Open the kit</a>
          <a class="btn ghost" href="#download">Download the kit</a>
        </div>
      </div>
    </section>
  );
}

export function Problem() {
  return (
    <section id="problem">
      <div class="wrap">
        <h2>The contracts were fine. The websites were not.</h2>
        <p class="lede">In each of these attacks nobody broke the smart contracts. Attackers took over the website people use to reach them, and asked for one innocent-looking signature.</p>
        <div class="grid">
          {INCIDENTS.map((i) => (
            <article class="card">
              <p class="muted" style="margin:0 0 4px;font-size:14px">{i.date}{i.unverified && <> · <span class="tag">unverified</span></>}</p>
              <h3>{i.name}</h3>
              <p>{i.what}</p>
              <p style="margin-top:10px">Loss: <span class="loss">{i.loss}</span></p>
            </article>
          ))}
        </div>
        <div class="card" style="margin-top:24px">
          <p style="margin:0 0 8px">{REPLAY_R1.labels.map((l) => <span class="tag label" style="margin-right:6px">{l}</span>)}</p>
          <h3>{REPLAY_R1.title}</h3>
          <p>{REPLAY_R1.body}</p>
          <div class="replay">
            <div><p class="muted" style="margin:0">Without BLACKOUT</p><p class="big bad">{REPLAY_R1.lostWithout} {REPLAY_R1.token}</p><p class="muted" style="margin:0">lost by one victim (<a href={etherscan(REPLAY_R1.approveTx)}>approve</a> → <a href={etherscan(REPLAY_R1.drainTx)}>drain</a>)</p></div>
            <div><p class="muted" style="margin:0">With BLACKOUT</p><p class="big ok">{REPLAY_R1.lostWith} {REPLAY_R1.token}</p><p class="muted" style="margin:0">the Guard rejects the approval; the drain moves nothing</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function How() {
  return (
    <section id="how">
      <div class="wrap">
        <h2>How BLACKOUT works</h2>
        <p class="lede">Four simple ideas. Together they mean a dead or fake website can neither block your exit nor trick it.</p>
        <div class="grid">
          {HOW.map((h, i) => (
            <article class="card">
              {Icons[i]}
              <p class="num">0{i + 1}</p>
              <h3>{h.title}</h3>
              <p>{h.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Trust() {
  return (
    <section id="trust">
      <div class="wrap">
        <h2>What you still trust, and what you don’t</h2>
        <div class="cols">
          <div class="card"><h3>Trusted</h3><ul class="ticks">{TRUSTED.map((t) => <li>{t}</li>)}</ul></div>
          <div class="card"><h3>Not trusted at all</h3><ul class="crosses">{NOT_TRUSTED.map((t) => <li>{t}</li>)}</ul></div>
        </div>
        <div class="card" style="margin-top:16px"><h3>Honest limits</h3><ul>{LIMITS.map((l) => <li>{l}</li>)}</ul></div>
      </div>
    </section>
  );
}

export function Download({ sha }: { sha: string | null }) {
  return (
    <section id="download">
      <div class="wrap">
        <h2>Download and verify</h2>
        <p class="lede">Keep a copy before you need it. Any mirror is fine: the fingerprint on ENS is what you check, not this website.</p>
        <div class="cols">
          <div class="card">
            <h3>1. Use it now, or keep a copy</h3>
            <p class="cta"><a class="btn" href="blackout-kit.html" target="_blank" rel="noopener">Open the kit</a><a class="btn ghost" href="blackout-kit.html" download>Download blackout-kit.html</a></p>
            <p class="muted" style="margin-top:8px;font-size:14px">Opening it here works while this site is up. Keep a downloaded copy for the day it isn’t. To try it: enter <b>demoswap-blackout.eth</b> and connect a Sepolia wallet.</p>
            <p style="margin-top:12px">sha256 of this copy:</p>
            <p class="mono">{sha ?? 'see blackout-kit.html.sha256'}</p>
          </div>
          <div class="card">
            <h3>2. Verify it yourself</h3>
            <p>Compare the fingerprint with the release record on <b>{ENS_NAME}</b> (read live in the demo section above):</p>
            <pre>{`sha256sum blackout-kit.html\n# or: shasum -a 256 blackout-kit.html`}</pre>
            <h3 style="margin-top:12px">3. Run it</h3>
            <pre>{`python3 -m http.server   # then open\nhttp://localhost:8000/blackout-kit.html`}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Protocols() {
  return (
    <section id="protocols">
      <div class="wrap">
        <h2>For protocol teams</h2>
        <p class="lede">Ten minutes of setup gives every one of your users a verified exit that survives your website.</p>
        <div class="grid">
          {PROTOCOL_STEPS.map((p, i) => (
            <article class="card"><p class="num">STEP {i + 1}</p><h3>{p.title}</h3><p>{p.body}</p></article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer><div class="wrap">BLACKOUT · open source (MIT) · no analytics, no trackers, no server · built at ETHGlobal with ENSv2, Uniswap v3 and the CROPS principles.</div></footer>
  );
}
