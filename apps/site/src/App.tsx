import { useEffect, useState } from 'preact/hooks';
import { Download, Footer, Hero, How, Problem, Protocols, Roadmap, Trust } from './sections/Sections';
import { BrandMark } from './sections/Icons';
import { LiveDemo } from './sections/LiveDemo';

export function App() {
  const [sha, setSha] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.ready.then(() => setOffline(true));
    }
    fetch('copeybara-kit.html.sha256').then((r) => (r.ok ? r.text() : null)).then((t) => t && setSha(t.split(' ')[0]!)).catch(() => {});
  }, []);
  return (
    <>
      <a class="skip-link" href="#main">Skip to content</a>
      <header class="top">
        <nav class="wrap nav-layout" aria-label="Main">
          <a class="brand" href="#top"><BrandMark />Copeybara</a>
          <ul>
            <li><a href="#how">How it works</a></li>
            <li><a href="#demo">Live demo</a></li>
            <li><a href="#protocols">For protocols</a></li>
          </ul>
          <a class="nav-action" href="#download">Get the kit <span aria-hidden="true">↓</span></a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Hero live={live} />
        <How />
        <Problem />
        <LiveDemo onLive={setLive} />
        <Trust />
        <Download sha={sha} offline={offline} />
        <Protocols />
        <Roadmap />
      </main>
      <Footer />
    </>
  );
}
