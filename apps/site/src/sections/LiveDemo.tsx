import { useEffect, useState } from 'preact/hooks';
import { LiveProof } from './LiveProof';
import { Theater } from '../theater/Theater';
import { boothUrl, theaterApi } from '../theater/api';

/** Booth mode when ?booth= points at a reachable local harness; otherwise public live proof. */
export function LiveDemo({ onLive }: { onLive(s: string): void }) {
  const booth = typeof location !== 'undefined' ? boothUrl(location.href) : null;
  const asked = typeof location !== 'undefined' && new URL(location.href).searchParams.has('booth');
  const [reachable, setReachable] = useState<boolean | null>(booth ? null : false);
  useEffect(() => {
    if (booth) theaterApi(booth).state().then(() => setReachable(true), () => setReachable(false));
  }, [booth]);
  return (
    <section id="demo">
      <div class="wrap">
        <header class="section-head" data-reveal>
          <p class="kicker">{reachable ? 'Attack Theater' : 'Live demo'}</p>
          <h2>{reachable ? 'Live: hijack, outage, rescue.' : 'Live on chain. Check it yourself.'}</h2>
          <p class="lede">
            {reachable
              ? 'Follow a test wallet through a site hijack, an outage, and a withdrawal using the saved kit.'
              : 'This page asks Sepolia, right now, which kit release is official, and shows the last recorded rescue.'}
          </p>
        </header>
        {asked && reachable === false && (
          <div class="card notice" role="status" style="margin-bottom:16px">
            {booth ? `The booth harness at ${booth} is not reachable` : 'The booth address must be http://localhost or 127.0.0.1'}, so this page shows the public demo.
          </div>
        )}
        {reachable ? <Theater base={booth!} /> : reachable === false ? <LiveProof onLive={onLive} /> : <div class="card">Connecting to the booth…</div>}
      </div>
    </section>
  );
}
