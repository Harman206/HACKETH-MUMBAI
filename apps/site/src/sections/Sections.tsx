import { useEffect, useState } from 'preact/hooks';
import { EXTENSION, ENS_NAME, DEMO_KIT_URL, SITE_URL, OLD_NAME_NOTE } from '../content';
import { BrandMark } from './Icons';
import { ExtensionPreview } from './ExtensionPreview';

/** The three ways in, shown under the hero: users, protocol teams, and anyone checking a protocol. */
const PATHS = [
  { href: '#/extension', who: 'Use DeFi', title: 'Get the extension', body: 'Checks protocol sites against ENS and holds drainer requests before your wallet sees them.', img: 'copey/protected.webp' },
  { href: '#/developers/onboarding', who: 'Run a protocol', title: 'Add your protocol', body: 'A guided setup: CLI, one Safe batch, site fingerprint, widget, watcher. About an hour.', img: 'copey/checking.webp' },
  { href: '#/certified', who: 'Check a protocol', title: 'Copeybara certified', body: 'A tick re-checked live from ENS every time you look. Follow certified protocols in one click.', img: 'copey/verified.webp' },
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

export function Download({ sha, offline }: { sha: string | null; offline: boolean }) {
  return (
    <section id="download" class="section">
      <div class="wrap download-layout">
        <div class="download-callout" data-reveal>
          <p class="kicker">Get the exit kit</p>
          <h2>Save it before you need it.</h2>
          <p>One HTML file. Keep it where you can find it during an outage.</p>
          <div class="cta">
            <a class="btn" href="copeybara-kit.html" download="copeybara-kit.html">Download the kit <span aria-hidden="true">↓</span></a>
            <a class="btn ghost on-dark" href={DEMO_KIT_URL} target="_blank" rel="noopener">Try it on the demo <span aria-hidden="true">↗</span></a>
          </div>
          {offline && <p class="offline-status" data-offline-ready>✓ This browser has an offline copy of the site and kit.</p>}
        </div>
        <div class="download-steps" data-reveal style="--d:1">
          <h3>Check your copy</h3>
          <p>Run either command in the download folder, and compare the result with the fingerprint on the protocol’s official ENS name. For the demo, that’s <a href="#demo">{ENS_NAME}</a>.</p>
          <pre>{`sha256sum copeybara-kit.html\nshasum -a 256 copeybara-kit.html`}</pre>
          <p class="checksum">Checksum from this site</p>
          <p class="mono">{sha ?? <a href="copeybara-kit.html.sha256">Open the checksum file</a>}</p>
          <h3>Open the saved kit</h3>
          <p>In the folder where you saved it, run <code>python3 -m http.server</code>, then open <a href="http://localhost:8000/copeybara-kit.html">localhost:8000/copeybara-kit.html</a> so your wallet can connect.</p>
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
        <div class="foot-brand">
          <a class="brand" href="#top"><BrandMark />Copeybara</a>
          <p>The emergency exit for DeFi. MIT-licensed; source release coming soon. Built at ETHGlobal Mumbai.</p>
          <p class="foot-muted">{OLD_NAME_NOTE}</p>
        </div>
        <nav class="foot-cols" aria-label="Footer">
          <div>
            <p class="foot-title">Product</p>
            <a href="#download">Exit kit</a>
            <a href="#/extension">Extension</a>
            <a href="#demo">Live demo</a>
          </div>
          <div>
            <p class="foot-title">Developers</p>
            <a href="#/docs">Docs</a>
            <a href="#/developers/onboarding">Add your protocol</a>
            <a href="#/developers">SDK</a>
            <a href="#/docs/agents">Build with an AI agent</a>
            <a href="llms.txt">llms.txt</a>
          </div>
          <div>
            <p class="foot-title">Trust</p>
            <a href="#/certified">Certified protocols</a>
            <a href="#/docs/security">Security model</a>
          </div>
        </nav>
        <QrCard />
      </div>
    </footer>
  );
}
