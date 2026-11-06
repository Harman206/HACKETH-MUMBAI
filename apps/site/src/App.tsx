import { useEffect, useState } from 'preact/hooks';
import { Download, Footer, Hero, How, Problem, Protocols, Trust } from './sections/Sections';
import { LiveDemo } from './sections/LiveDemo';

export function App() {
  const [sha, setSha] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => {
    fetch('blackout-kit.html.sha256').then((r) => (r.ok ? r.text() : null)).then((t) => t && setSha(t.split(' ')[0]!)).catch(() => {});
  }, []);
  return (
    <>
      <nav class="top" aria-label="Main">
        <div class="wrap">
          <a class="brand" href="#top">BLACKOUT</a>
          <ul>
            <li><a href="#problem">The problem</a></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#demo">Live demo</a></li>
            <li><a href="#protocols">For protocols</a></li>
            <li><a href="#download">Download</a></li>
          </ul>
        </div>
      </nav>
      <main>
        <Hero live={live} />
        <Problem />
        <How />
        <LiveDemo onLive={setLive} />
        <Trust />
        <Download sha={sha} />
        <Protocols />
      </main>
      <Footer />
    </>
  );
}
