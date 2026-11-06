import { BLOCKS, EXT_HERO, EXT_LIMITS, LAYERS, VERDICTS, VERIFY_INSTALL } from '../extension';
import { Extension } from '../sections/Sections';
import { ExtensionPreview } from '../sections/ExtensionPreview';

export function ExtensionPage() {
  return (
    <>
      <section class="section page-hero">
        <div class="wrap dev-hero-layout">
          <div>
            <p class="eyebrow">Copeybara for Chrome</p>
            <h1 class="page-title">{EXT_HERO.title}</h1>
            <p class="lede">{EXT_HERO.sub}</p>
            <div class="cta">
              <a class="btn" href="#extension">Download <span aria-hidden="true">↓</span></a>
              <a class="text-link" href="#/developers">For protocol teams <span aria-hidden="true">→</span></a>
            </div>
          </div>
          <ExtensionPreview />
        </div>
      </section>

      <section class="section evidence">
        <div class="wrap">
          <header class="section-head">
            <h2 class="h2-sm">Five verdicts, one decision point</h2>
            <p class="lede">Every request that moves something gets a verdict before your wallet sees it. Requests that move nothing go straight through.</p>
          </header>
          <table class="cli-table verdicts">
            <thead><tr><th>Verdict</th><th>When</th><th>What happens</th></tr></thead>
            <tbody>
              {VERDICTS.map((v) => (
                <tr key={v.v}><td><span class={`pill ${v.tone}`}>{v.v}</span></td><td>{v.what}</td><td>{v.then}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <header class="section-head"><h2 class="h2-sm">What it stops</h2></header>
          <div class="cap-grid two">
            {BLOCKS.map((b) => <article key={b.title} class="cap"><h3>{b.title}</h3><p>{b.body}</p></article>)}
          </div>
        </div>
      </section>

      <section class="section evidence">
        <div class="wrap section-split">
          <header class="section-head">
            <h2 class="h2-sm">One place decides</h2>
            <p class="lede">A web page can lie about itself. So nothing a page says is trusted, and nothing the extension shows is drawn inside the page.</p>
          </header>
          <dl class="feature-list">
            {LAYERS.map((l) => <div key={l.title}><dt>{l.title}</dt><dd>{l.body}</dd></div>)}
          </dl>
        </div>
      </section>

      <section class="section">
        <div class="wrap section-split">
          <header class="section-head">
            <h2 class="h2-sm">Check your install</h2>
            <p class="lede">The build is reproducible. The protocol’s Safe publishes the zip’s sha256 and a tree hash of the unpacked folder on ENS, so you can check what you loaded from outside the browser.</p>
          </header>
          <pre>{VERIFY_INSTALL}</pre>
        </div>
      </section>

      <Extension />

      <section class="section boundaries">
        <div class="wrap">
          <div class="limits" style="margin:0;border:0;padding:0"><h3>Honest limits</h3><ul>{EXT_LIMITS.map((l) => <li key={l}>{l}</li>)}</ul></div>
        </div>
      </section>
    </>
  );
}
