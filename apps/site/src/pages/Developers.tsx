import { useEffect, useRef } from 'preact/hooks';
import { ENS_NAME, EXTENSION } from '../content';
import { CAPABILITIES, CI_SUMMARY, CLI, CONFIG_SAMPLE, DEV_FACTS, DEV_HERO, GUARANTEES, NON_GOALS, PLUGINS, QUICKSTART, SPEC_RULES, SPEC_SAMPLE, VERIFY_OUTPUT, WIDGET_EMBED } from '../developers';
import { useSha } from '../sections/Sections';
import { CertifiedTick } from './Certified';

const WIDGET = 'copeybara-exit.js';

/** The real widget, loaded from the exact file this site serves (same origin, so the CSP allows it). */
function WidgetDemo() {
  const host = useRef<HTMLDivElement>(null);
  const kit = useSha('copeybara-kit.html');
  const ext = useSha(EXTENSION.chromeZip);
  useEffect(() => {
    if (!customElements.get('copeybara-exit') && !document.querySelector('script[data-copeybara-widget]')) {
      const s = document.createElement('script');
      s.src = WIDGET;
      s.dataset.copeybaraWidget = '';
      document.head.append(s);
    }
    const el = document.createElement('copeybara-exit');
    el.setAttribute('ens', ENS_NAME);
    el.setAttribute('kit', 'copeybara-kit.html');
    el.setAttribute('extension', EXTENSION.chromeZip);
    el.setAttribute('certified', '');
    host.current!.replaceChildren(el);
  }, []);
  useEffect(() => {
    const el = host.current?.firstElementChild;
    if (el && kit) el.setAttribute('sha256', kit);
    if (el && ext) el.setAttribute('extension-sha256', ext);
  }, [kit, ext]);
  return <div ref={host} class="widget-host" data-widget-demo />;
}

function Code({ children, label }: { children: string; label?: string }) {
  return (
    <figure class="code">
      {label && <figcaption>{label}</figcaption>}
      <pre><code>{children}</code></pre>
    </figure>
  );
}

export function DevelopersPage() {
  const widgetSha = useSha(WIDGET);
  return (
    <>
      <section class="section page-hero dev-hero">
        <div class="wrap dev-hero-layout">
          <div>
            <p class="eyebrow">For developers · Copeybara SDK</p>
            <h1 class="page-title">{DEV_HERO.title}</h1>
            <p class="lede">{DEV_HERO.sub}</p>
            <div class="cta">
              <a class="btn" href="#quickstart" onClick={(e) => { e.preventDefault(); document.getElementById('quickstart')?.scrollIntoView(); }}>Quick start <span aria-hidden="true">↓</span></a>
              <a class="text-link" href="#/certified">Copeybara certified <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <div class="terminal" role="img" aria-label="Output of copeybara verify against the live Sepolia demo: every check passes">
            <div class="terminal-bar"><i /><i /><i /><span>examples/demoswap · Sepolia</span></div>
            <pre>{VERIFY_OUTPUT}</pre>
          </div>
        </div>
      </section>

      <section class="section tight">
        <div class="wrap facts">
          {DEV_FACTS.map((f) => (
            <div key={f.unit} class="fact"><p class="fact-n">{f.n}<span> {f.unit}</span></p><p>{f.body}</p></div>
          ))}
        </div>
      </section>

      <section class="section tight">
        <div class="wrap">
          <header class="section-head"><h2 class="h2-sm">What you get</h2></header>
          <div class="cap-grid">
            {CAPABILITIES.map((c) => (
              <article key={c.title} class="cap">
                <p class="cap-pkg mono">{c.pkg}</p>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="quickstart" class="section evidence">
        <div class="wrap">
          <header class="section-head">
            <h2 class="h2-sm">Quick start: about an hour</h2>
            <p class="lede">From an ENS name owned by your Safe to a certified exit. Nothing here signs; your Safe owners approve one batch.</p>
          </header>
          <ol class="qs">
            {QUICKSTART.map((s, i) => (
              <li key={s.title}>
                <span class="qs-n" aria-hidden="true">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  {i === 1 ? <Code label="copeybara.config.ts">{CONFIG_SAMPLE}</Code> : s.code && <Code>{s.code}</Code>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="exits" class="section">
        <div class="wrap section-split">
          <header class="section-head">
            <h2 class="h2-sm">Declarative exits</h2>
            <p class="lede">For your own contracts, publish how to exit instead of writing adapter code. erc4626Kind() produces this for any ERC-4626 vault; the drill proves it on a fork with a sample vault described by the spec alone.</p>
            <ul class="plain-list spec-rules">{SPEC_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </header>
          <Code label="org.copeybara.exits · kinds.vault">{SPEC_SAMPLE}</Code>
        </div>
      </section>

      <section id="plugins" class="section evidence">
        <div class="wrap">
          <header class="section-head">
            <h2 class="h2-sm">Build plugins</h2>
            <p class="lede">Your build writes the fingerprint; the Safe publishes it. Every build gets a CI summary that compares it with what ENS says now.</p>
          </header>
          <div class="cols three">
            {PLUGINS.map((p) => <Code key={p.name} label={p.name}>{p.code}</Code>)}
          </div>
          <Code label="GitHub Actions job summary">{CI_SUMMARY}</Code>
        </div>
      </section>

      <section id="widget" class="section">
        <div class="wrap section-split">
          <header class="section-head">
            <h2 class="h2-sm">The widget, running</h2>
            <p class="lede">This is the real <code>&lt;copeybara-exit&gt;</code>, loaded from <a href={WIDGET}>{WIDGET}</a> on this site. Publish its sha256 in your site fingerprint like any other script.</p>
            <p class="checksum">sha256 of {WIDGET}</p>
            <p class="mono" data-widget-sha>{widgetSha ?? <a href={`${WIDGET}.sha256`}>Open the checksum file</a>}</p>
            <Code label="Embed">{WIDGET_EMBED}</Code>
          </header>
          <WidgetDemo />
        </div>
      </section>

      <section id="cli" class="section evidence">
        <div class="wrap">
          <header class="section-head"><h2 class="h2-sm">CLI reference</h2><p class="lede">Every output lands in .copeybara/. Run any command with --config to point at another config.</p></header>
          <table class="cli-table">
            <thead><tr><th>Command</th><th>What it does</th><th>Writes</th></tr></thead>
            <tbody>{CLI.map(([c, what, out]) => <tr key={c}><td class="mono">copeybara {c}</td><td>{what}</td><td class="mono">{out}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section id="guarantees" class="section">
        <div class="wrap">
          <header class="section-head"><h2 class="h2-sm">What the SDK will never do</h2><p class="lede">Each promise is a test in the repository, not a policy.</p></header>
          <div class="cap-grid">
            {GUARANTEES.map((g) => (
              <article key={g.title} class="cap">
                <h3>{g.title}</h3>
                <p>{g.body}</p>
                <p class="cap-pkg mono">{g.where}</p>
              </article>
            ))}
          </div>
          <div class="limits"><h3>Non-goals</h3><ul>{NON_GOALS.map((n) => <li key={n}>{n}</li>)}</ul></div>
        </div>
      </section>

      <section class="section cert-band">
        <div class="wrap cert-band-layout">
          <CertifiedTick size={64} />
          <div>
            <h2 class="h2-sm">Become Copeybara certified</h2>
            <p class="lede">Pass <code>copeybara certify</code>, send us the report, and your protocol gets the tick, re-checked live from ENS every time someone looks.</p>
          </div>
          <a class="btn" href="#/certified">See what it checks <span aria-hidden="true">→</span></a>
        </div>
      </section>
    </>
  );
}
