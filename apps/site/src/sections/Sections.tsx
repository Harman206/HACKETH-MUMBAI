import { HERO, HOW, INCIDENTS, LIMITS, NOT_TRUSTED, PROTOCOL_STEPS, REPLAY_R1, TRUSTED, ENS_NAME, DEMO_KIT_URL, SITE_URL } from '../content';
import { BrandMark, ExitIllustration } from './Icons';

const etherscan = (h: string) => `https://etherscan.io/tx/${h}`;

export function Hero({ live }: { live: string | null }) {
  return (
    <section class="hero" aria-labelledby="hero-title">
      <div class="wrap">
        <div class="hero-layout">
          <div class="hero-copy">
            <h1 id="hero-title">{HERO.title}</h1>
            <p class="hero-summary">{HERO.sub}</p>
            <div class="cta">
              <a class="btn" href="#download">Get the exit kit <span aria-hidden="true">↓</span></a>
              <a class="text-link" href="#demo">See the demo <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <a class="hero-art" href="#how">
            <ExitIllustration />
            <span class="art-link-label">How the kit works</span>
          </a>
        </div>
        <div class="hero-meta">
          <span><i aria-hidden="true" />{live ?? 'Sepolia testnet demo'}</span>
          <a class="text-link" href={DEMO_KIT_URL} target="_blank" rel="noopener">Try the kit on the demo protocol <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </section>
  );
}

export function Problem() {
  return (
    <section id="problem" class="section evidence">
      <div class="wrap">
        <header class="section-head">
          <h2>When the website is the attack</h2>
          <p class="lede">A look-alike site can ask your wallet for permission to spend your tokens while the protocol’s contracts keep running.</p>
        </header>
        <article class="replay-sheet">
          <div class="replay-copy">
            <p class="case-label">Curve Finance · August 2022</p>
            <h3>{REPLAY_R1.title}</h3>
            <p>{REPLAY_R1.body}</p>
            <p class="case-links"><a href={etherscan(REPLAY_R1.approveTx)}>Approval transaction ↗</a><a href={etherscan(REPLAY_R1.drainTx)}>Drain transaction ↗</a></p>
          </div>
          <dl class="replay-figures">
            <div><dt>Actual loss for one victim</dt><dd class="bad">{REPLAY_R1.lostWithout} <small>{REPLAY_R1.token}</small></dd></div>
            <div><dt>Simulated loss with Copeybara</dt><dd class="ok">{REPLAY_R1.lostWith} <small>{REPLAY_R1.token}</small></dd></div>
          </dl>
        </article>
        <details class="incidents">
          <summary>More about frontend attacks</summary>
          <ul class="incident-list">
            {INCIDENTS.map((incident) => (
              <li key={incident.name}>
                <p class="muted">{incident.date}{incident.unverified && ' · Unverified report'}</p>
                <h3>{incident.name}</h3>
                <p>{incident.what} {incident.loss === 'not collected' ? 'Loss unknown.' : `Reported loss: ${incident.loss}.`}</p>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}

export function How() {
  return (
    <section id="how" class="section">
      <div class="wrap section-split">
        <header class="section-head">
          <h2>How the kit works</h2>
          <p class="lede">You’ll need the saved file, your wallet, and the protocol’s official ENS name.</p>
        </header>
        <dl class="feature-list">
          {HOW.map((item) => (
            <div key={item.title}>
              <dt>{item.title}</dt>
              <dd>{item.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function Trust() {
  return (
    <section id="trust" class="section boundaries">
      <div class="wrap">
        <header class="section-head">
          <h2>What the kit can protect</h2>
          <p class="lede">The kit gives you a second way to reach supported contracts when the usual website is down or compromised.</p>
        </header>
        <div class="cols trust-cols">
          <div><h3>You still rely on</h3><ul class="plain-list">{TRUSTED.map((item) => <li key={item}>{item}</li>)}</ul></div>
          <div><h3>The kit can work around</h3><ul class="plain-list">{NOT_TRUSTED.map((item) => <li key={item}>{item}</li>)}</ul></div>
        </div>
        <div class="limits"><h3>Limits and coverage</h3><ul>{LIMITS.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </section>
  );
}

export function Download({ sha, offline }: { sha: string | null; offline: boolean }) {
  return (
    <section id="download" class="section">
      <div class="wrap download-layout">
        <div class="download-callout">
          <h2>Download and verify</h2>
          <p>Save the HTML file where you can find it during an outage.</p>
          <a class="btn" href="blackout-kit.html" download="blackout-kit.html">Download the kit <span aria-hidden="true">↓</span></a>
          <a class="text-link" href="blackout-kit.html" target="_blank" rel="noopener">Open in browser <span aria-hidden="true">↗</span></a>
          {offline && <p class="offline-status" data-offline-ready>✓ This browser has an offline copy of the site and kit.</p>}
        </div>
        <div class="download-steps">
          <h3>Check your copy</h3>
          <p>Run either command in the download folder. Compare the result with the fingerprint on the protocol’s official ENS name before opening the kit. For the demo, check <a href="#demo">{ENS_NAME}</a>.</p>
          <pre>{`sha256sum blackout-kit.html\nshasum -a 256 blackout-kit.html`}</pre>
          <p class="checksum">Checksum from this site</p>
          <p class="mono">{sha ?? <a href="blackout-kit.html.sha256">Open the checksum file</a>}</p>
          <h3>Open the saved kit</h3>
          <p>In the folder where you saved the file, run <code>python3 -m http.server</code>. Then open <a href="http://localhost:8000/blackout-kit.html">localhost:8000/blackout-kit.html</a> so your wallet can connect.</p>
        </div>
      </div>
    </section>
  );
}

export function Protocols() {
  return (
    <section id="protocols" class="section">
      <div class="wrap section-split">
        <header class="section-head">
          <h2>Give your users a backup exit</h2>
          <p class="lede">For protocol teams setting up a release, ENS gives users a place to check the kit and its supported contracts.</p>
        </header>
        <ol class="protocol-steps">
          {PROTOCOL_STEPS.map((step) => (
            <li key={step.title}><h3>{step.title}</h3><p>{step.body}</p></li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Roadmap() {
  return (
    <section id="roadmap" class="section">
      <div class="wrap section-split">
        <header class="section-head">
          <h2>Browser protection is planned</h2>
          <p class="lede">The exit kit is available today. The next phase adds a way to spot compromised sites before you try to withdraw.</p>
          <p class="roadmap-link"><a href="https://github.com/Harman206/HACKETH-MUMBAI/blob/4940792/docs/superpowers/specs/2026-11-06-copeybara-extension-design.md">Read the extension and watcher design</a></p>
        </header>
        <dl class="feature-list">
          <div>
            <dt>Browser extension</dt>
            <dd>The design calls for checking a protocol site’s scripts against fingerprints published on ENS, warning about risky wallet requests, and opening the exit kit when a site goes down.</dd>
          </div>
          <div>
            <dt>Protocol watcher</dt>
            <dd>A separate service would check protocol sites for script changes and publish warnings on ENS. Those warnings would only affect website access. Users could still open the exit kit directly.</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/** Scan-to-open card (booth visitors take the site with them). The SVG is generated at build time. */
export function QrCard({ big }: { big?: boolean }) {
  return (
    <figure class={`qr ${big ? 'qr-large' : ''}`} data-qr>
      <img src="qr.svg" alt={`QR code for ${SITE_URL}`} width={big ? 168 : 96} height={big ? 168 : 96} />
      <figcaption>
        Open the public site on your phone
        <br />
        <a href={SITE_URL}>{SITE_URL.replace(/^https:\/\//, '')}</a>
      </figcaption>
    </figure>
  );
}

export function Footer() {
  return (
    <footer>
      <div class="wrap foot">
        <div>
          <a class="brand" href="#top"><BrandMark />Copeybara</a>
          <p>Open source under the MIT license. Built at ETHGlobal.</p>
        </div>
        <QrCard />
      </div>
    </footer>
  );
}
