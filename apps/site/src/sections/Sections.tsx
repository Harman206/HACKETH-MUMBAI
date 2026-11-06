import { useEffect, useState } from 'preact/hooks';
import { EXTENSION, HERO, HOW, INCIDENTS, LIMITS, NOT_TRUSTED, PROTOCOL_STEPS, REPLAY_R1, TRUSTED, ENS_NAME, DEMO_KIT_URL, SITE_URL, OLD_NAME_NOTE } from '../content';
import { BrandMark, ExitIllustration } from './Icons';
import { ExtensionPreview } from './ExtensionPreview';
import { CertifiedTick } from '../pages/Certified';
import copeyVerified from '../../../../assets/brand/copey-verified.png';
import copeyChecking from '../../../../assets/brand/copey-checking.png';
import copeyProtected from '../../../../assets/brand/copey-protected.png';
import { REPO_URL } from '../developers';

/** The three ways in, shown under the hero: users, protocol teams, and anyone checking a protocol. */
const PATHS = [
  { href: '#/extension', who: 'Use DeFi', title: 'Get the extension', body: 'Checks protocol sites against ENS and holds drainer requests before your wallet sees them.', img: copeyProtected },
  { href: '#/developers/onboarding', who: 'Run a protocol', title: 'Add your protocol', body: 'A guided setup: CLI, one Safe batch, site fingerprint, widget, watcher. About an hour.', img: copeyChecking },
  { href: '#/certified', who: 'Check a protocol', title: 'Copeybara certified', body: 'A tick re-checked live from ENS every time you look. Follow certified protocols in one click.', img: copeyVerified },
];

export function Paths() {
  return (
    <nav class="paths" aria-label="Start here">
      {PATHS.map((p) => (
        <a key={p.href} class="path" href={p.href}>
          <img src={p.img} alt="" width={72} height={72} loading="lazy" />
          <span>
            <small>{p.who}</small>
            <b>{p.title} <span aria-hidden="true">→</span></b>
            <span class="path-body">{p.body}</span>
          </span>
        </a>
      ))}
    </nav>
  );
}

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
              <a class="btn ghost" href="#/extension">Get the extension <span aria-hidden="true">→</span></a>
              <a class="text-link" href="#demo">See the demo <span aria-hidden="true">↓</span></a>
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
        <Paths />
      </div>
    </section>
  );
}

/** sha256 of a file this site serves, read from its .sha256 sidecar (same origin, so the CSP allows it). */
export function useSha(file: string): string | null {
  const [sha, setSha] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${file}.sha256`)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => {
        const h = t?.split(' ')[0];
        if (h && /^[0-9a-f]{64}$/.test(h)) setSha(h);
      })
      .catch(() => {});
  }, [file]);
  return sha;
}

export function Extension({ preview }: { preview?: boolean }) {
  const chrome = useSha(EXTENSION.chromeZip);
  const firefox = useSha(EXTENSION.firefoxZip);
  return (
    <section id="extension" class="section" aria-labelledby="extension-title">
      <div class="wrap download-layout">
        <div class="download-callout">
          <h2 id="extension-title">{EXTENSION.title}</h2>
          <p>{EXTENSION.lede}</p>
          <a class="btn" href={EXTENSION.chromeZip} download={EXTENSION.chromeZip}>Download for Chrome <span aria-hidden="true">↓</span></a>
          <a class="text-link" href={EXTENSION.firefoxZip} download={EXTENSION.firefoxZip}>Firefox build (zip) <span aria-hidden="true">↓</span></a>
          <p class="checksum">sha256 of {EXTENSION.chromeZip}</p>
          <p class="mono" data-ext-sha>{chrome ?? <a href={`${EXTENSION.chromeZip}.sha256`}>Open the checksum file</a>}</p>
          <p class="checksum">Firefox zip (checksum from this site only; ENS publishes the Chrome zip’s)</p>
          <p class="mono">{firefox ?? <a href={`${EXTENSION.firefoxZip}.sha256`}>Open the checksum file</a>}</p>
          {preview && <ExtensionPreview />}
        </div>
        <div class="download-steps">
          <h3>What it does</h3>
          <dl class="feature-list">
            {EXTENSION.bullets.map((b) => (
              <div key={b.title}><dt>{b.title}</dt><dd>{b.body}</dd></div>
            ))}
          </dl>
          <h3>Install in four steps</h3>
          <ol class="protocol-steps install-steps">{EXTENSION.steps.map((s) => <li key={s}><p>{s}</p></li>)}</ol>
          <p>{EXTENSION.note}</p>
          <p class="watcher-note">{EXTENSION.watcher}</p>
          {preview && <p class="watcher-note"><a class="text-link" href="#/extension">How the extension decides <span aria-hidden="true">→</span></a></p>}
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
          <a class="btn" href="copeybara-kit.html" download="copeybara-kit.html">Download the kit <span aria-hidden="true">↓</span></a>
          <a class="text-link" href="copeybara-kit.html" target="_blank" rel="noopener">Open in browser <span aria-hidden="true">↗</span></a>
          {offline && <p class="offline-status" data-offline-ready>✓ This browser has an offline copy of the site and kit.</p>}
        </div>
        <div class="download-steps">
          <h3>Check your copy</h3>
          <p>Run either command in the download folder. Compare the result with the fingerprint on the protocol’s official ENS name before opening the kit. For the demo, check <a href="#demo">{ENS_NAME}</a>.</p>
          <pre>{`sha256sum copeybara-kit.html\nshasum -a 256 copeybara-kit.html`}</pre>
          <p class="checksum">Checksum from this site</p>
          <p class="mono">{sha ?? <a href="copeybara-kit.html.sha256">Open the checksum file</a>}</p>
          <h3>Open the saved kit</h3>
          <p>In the folder where you saved the file, run <code>python3 -m http.server</code>. Then open <a href="http://localhost:8000/copeybara-kit.html">localhost:8000/copeybara-kit.html</a> so your wallet can connect.</p>
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
        <div>
          <ol class="protocol-steps">
            {PROTOCOL_STEPS.map((step) => (
              <li key={step.title}><h3>{step.title}</h3><p>{step.body}</p></li>
            ))}
          </ol>
          <div class="cta protocol-cta">
            <a class="btn" href="#/developers">Read the SDK guide <span aria-hidden="true">→</span></a>
            <a class="text-link" href="#/certified">Copeybara certified protocols <span aria-hidden="true">→</span></a>
          </div>
        </div>
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
          <p>MIT-licensed; source release coming soon. Built at ETHGlobal Mumbai.</p>
          <p class="muted">{OLD_NAME_NOTE}</p>
        </div>
        <nav class="foot-nav" aria-label="Footer">
          <a href="#download">Exit kit</a>
          <a href="#/extension">Extension</a>
          <a href="#/developers/onboarding">Add your protocol</a>
          <a href="#/developers">Developers</a>
          <a href="#/certified"><CertifiedTick size={15} /> Certified</a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
        </nav>
        <QrCard />
      </div>
    </footer>
  );
}
