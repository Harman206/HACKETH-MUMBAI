import { EXT_PITCH, HERO, HOW, INCIDENTS, LIMITS, NOT_TRUSTED, REPLAY_R1, SCENARIOS, STEPS_SIMPLE, TRUSTED, type Incident } from '../content';
import { useCountUp, useInView } from '../motion';
import { CertifiedTick } from '../pages/Certified';
import { ExtensionPreview } from './ExtensionPreview';
import { KitSnippet } from './KitSnippet';

const etherscan = (h: string) => `https://etherscan.io/tx/${h}`;

export function Hero({ live }: { live: string | null }) {
  return (
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-glow" aria-hidden="true"><i /><i /><i /></div>
      <div class="wrap hero-layout">
        <div class="hero-copy">
          <p class="hero-pill" data-reveal><i aria-hidden="true" />{live ?? HERO.note}</p>
          <h1 id="hero-title" data-reveal style="--d:1">{HERO.title}</h1>
          <p class="hero-summary" data-reveal style="--d:2">{HERO.sub}</p>
          <div class="cta" data-reveal style="--d:3">
            <a class="btn" href="#download">Get the exit kit <span aria-hidden="true">↓</span></a>
            <a class="btn ghost on-dark" href="#demo">See the live demo</a>
          </div>
        </div>
        <div class="hero-visual" data-reveal style="--d:2">
          <KitSnippet />
        </div>
      </div>
    </section>
  );
}

const ScenarioIcon = ({ n }: { n: number }) => (
  <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" class="scn-icon">
    <rect x="4" y="8" width="40" height="30" rx="5" fill="none" stroke="currentColor" stroke-width="2" />
    <path d="M4 15h40" stroke="currentColor" stroke-width="2" />
    {n === 0 && <path class="c" d="M18 23l12 10m0-10L18 33" />}
    {n === 1 && <path class="c" d="M24 21v7m0 4.5v.5" />}
    {n === 2 && <path class="c" d="M16 27c4-6 12-6 16 0m-8 4v.5" />}
  </svg>
);

export function Scenarios() {
  return (
    <section id="what" class="section">
      <div class="wrap">
        <header class="section-head center" data-reveal>
          <p class="kicker">What Copeybara does</p>
          <h2>A way out for the day the website fails you.</h2>
        </header>
        <div class="scn-grid">
          {SCENARIOS.map((s, i) => (
            <article key={s.kicker} class="scn" data-reveal style={`--d:${i}`}>
              <ScenarioIcon n={i} />
              <p class="kicker">{s.kicker}</p>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepVisual({ n }: { n: number }) {
  if (n === 0)
    return (
      <div class="mini mini-file" aria-hidden="true">
        <span class="mini-doc">HTML</span>
        <div><p class="mini-strong">copeybara-kit.html</p><p class="mini-muted">One file · works offline</p></div>
      </div>
    );
  if (n === 1)
    return (
      <div class="mini mini-verify" aria-hidden="true">
        <p class="mono">$ shasum -a 256 copeybara-kit.html</p>
        <p class="mini-match"><span>✓</span> Same fingerprint as the release on ENS</p>
      </div>
    );
  return (
    <div class="mini mini-done" aria-hidden="true">
      <span class="snip-chip ok">✓ Recovered</span>
      <p class="snip-gain">+999.99 DUSD back in your wallet</p>
    </div>
  );
}

export function Steps() {
  return (
    <section class="section steps-band">
      <div class="wrap">
        <header class="section-head" data-reveal>
          <p class="kicker">The exit kit</p>
          <h2>Three steps. No website needed.</h2>
        </header>
        <ol class="steps">
          {STEPS_SIMPLE.map((s, i) => (
            <li key={s.title} data-reveal style={`--d:${i}`}>
              <StepVisual n={i} />
              <p class="step-n">0{i + 1}</p>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ExtensionBand() {
  return (
    <section id="extension" class="section dark-band">
      <div class="wrap ext-band">
        <div data-reveal>
          <p class="kicker">The browser extension</p>
          <h2>Stops the drainer before your wallet sees it.</h2>
          <ul class="tick-list">{EXT_PITCH.map((p) => <li key={p}>{p}</li>)}</ul>
          <div class="cta">
            <a class="btn" href="#/extension">Get the extension <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div class="ext-stage" data-reveal style="--d:1">
          <ExtensionPreview />
        </div>
      </div>
    </section>
  );
}

const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

function IncidentFigure({ i, start }: { i: Incident; start: boolean }) {
  const n = useCountUp(i.usd ?? 0, start);
  return (
    <li>
      <p class="inc-figure">{money(n)}{i.usdAtLeast && '+'}</p>
      <p class="inc-name">{i.name}</p>
      <p class="inc-date">{i.date}</p>
    </li>
  );
}

export function Incidents() {
  const [ref, visible] = useInView<HTMLUListElement>();
  return (
    <section id="problem" class="section">
      <div class="wrap">
        <header class="section-head" data-reveal>
          <p class="kicker">Why it matters</p>
          <h2>Websites get hijacked. Contracts keep working.</h2>
          <p class="lede">In each of these, the protocol’s contracts were fine. The website in front of them was not.</p>
        </header>
        <ul class="inc-grid" ref={ref}>
          {INCIDENTS.filter((i) => i.usd).map((i) => <IncidentFigure key={i.name} i={i} start={visible} />)}
        </ul>
        <div class="replay-note" data-reveal>
          <p><b>Replayed on a mainnet fork:</b> Copeybara’s guard refuses the approval that cost one Curve user {REPLAY_R1.lostWithout} {REPLAY_R1.token} in 2022.</p>
          <p class="case-links"><a href={etherscan(REPLAY_R1.approveTx)}>The approval ↗</a><a href={etherscan(REPLAY_R1.drainTx)}>The drain ↗</a></p>
        </div>
        <details class="incidents">
          <summary>Sources and details</summary>
          <ul class="incident-list">
            {INCIDENTS.map((incident) => (
              <li key={incident.name}>
                <p class="muted">{incident.date}{incident.unverified && ' · Unverified report'}</p>
                <h3>{incident.name}</h3>
                <p>{incident.what} {incident.loss === 'not collected' ? 'Loss unknown.' : `Reported loss: ${incident.loss}.`}</p>
                {incident.sources && (
                  <p class="case-links">
                    {incident.sources.map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.label} ↗</a>)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

export function ForProtocols() {
  return (
    <section id="protocols" class="section">
      <div class="wrap proto-band" data-reveal>
        <CertifiedTick size={72} />
        <div>
          <p class="kicker">For protocol teams</p>
          <h2 class="h2-sm">Give your users an exit. Get the tick.</h2>
          <p class="lede">Publish a verified exit kit for your contracts with the Copeybara SDK. Protocols that pass every check are listed as Copeybara certified, re-checked live on every view.</p>
        </div>
        <div class="proto-cta">
          <a class="btn" href="#/docs/quickstart">Read the docs <span aria-hidden="true">→</span></a>
          <a class="btn ghost" href="#/developers">SDK overview</a>
          <a class="text-link" href="#/certified">Certified protocols <span aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" class="section">
      <div class="wrap faq-layout">
        <header class="section-head" data-reveal>
          <p class="kicker">Good to know</p>
          <h2 class="h2-sm">Questions, honestly answered.</h2>
        </header>
        <div class="faq" data-reveal style="--d:1">
          <details>
            <summary>Can I use it on mainnet today?</summary>
            <p>Not yet. This is a Sepolia testnet demo. The exits for Aave and Curve are tested on mainnet forks.</p>
          </details>
          <details>
            <summary>What can’t it do?</summary>
            <ul>{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
          </details>
          <details>
            <summary>What do I still have to trust?</summary>
            <ul>{TRUSTED.map((t) => <li key={t}>{t}</li>)}</ul>
            <p class="muted">It works around: {NOT_TRUSTED.map((t) => t.charAt(0).toLowerCase() + t.slice(1)).join('; ')}.</p>
          </details>
          <details>
            <summary>How does it work under the hood?</summary>
            <ul>{HOW.map((h) => <li key={h.title}><b>{h.title}.</b> {h.body}</li>)}</ul>
            <p><a href="#/docs/security">Read the security model →</a></p>
          </details>
        </div>
      </div>
    </section>
  );
}
