import { useEffect, useState } from 'preact/hooks';
import { Download, Footer } from './sections/Sections';
import { ExtensionBand, Faq, ForProtocols, Hero, Incidents, Scenarios, Steps } from './sections/Landing';
import { BrandMark } from './sections/Icons';
import { Benchmarks } from './sections/Benchmarks';
import { LiveDemo } from './sections/LiveDemo';
import { CertifiedPage } from './pages/Certified';
import { DevelopersPage } from './pages/Developers';
import { DocsPage } from './pages/Docs';
import { ExtensionPage } from './pages/ExtensionPage';
import { useRoute } from './router';
import { useReveal } from './motion';

export function App() {
  const route = useRoute();
  const [sha, setSha] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  useReveal(route.page === 'docs' ? `docs/${route.slug}` : route.page);
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext) {
      void navigator.serviceWorker.ready.then(() => setOffline(true));
    }
    fetch('copeybara-kit.html.sha256').then((r) => (r.ok ? r.text() : null)).then((t) => t && setSha(t.split(' ')[0]!)).catch(() => {});
  }, []);
  const here = (p: string) => (route.page === p ? { 'aria-current': 'page' as const } : {});
  return (
    <>
      <a class="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header class="top">
        <nav class="wrap nav-layout" aria-label="Main">
          <a class="brand" href="#top"><BrandMark />Copeybara</a>
          <ul>
            <li><a href="#what">What it does</a></li>
            <li><a href="#/extension" {...here('extension')}>Extension</a></li>
            <li><a href="#/developers" {...here('developers')}>Developers</a></li>
            <li><a href="#/docs" {...here('docs')}>Docs</a></li>
            <li><a href="#/certified" {...here('certified')}>Certified</a></li>
          </ul>
          <a class="nav-action" href="#download">Get the kit <span aria-hidden="true">↓</span></a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {route.page === 'developers' ? (
          <DevelopersPage />
        ) : route.page === 'extension' ? (
          <ExtensionPage />
        ) : route.page === 'docs' ? (
          <DocsPage slug={route.slug} />
        ) : route.page === 'certified' ? (
          <CertifiedPage name={route.name} />
        ) : (
          <>
            <Hero live={live} />
            <Scenarios />
            <Steps />
            <ExtensionBand />
            <Incidents />
            <LiveDemo onLive={setLive} />
            <Download sha={sha} offline={offline} />
            <ForProtocols />
            <Faq />
            <Benchmarks />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
