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
        <h2>{reachable ? 'Attack Theater: live' : 'Live demo'}</h2>
        <p class="lede">
          {reachable
            ? 'A real attack and a real rescue, on the Sepolia testnet, in four chapters. Every number below is read from the chain.'
            : 'Everything below is read from the blockchain as you look at it. At the booth, this section becomes the interactive Attack Theater.'}
        </p>
        {asked && reachable === false && (
          <div class="card notice" role="status" style="margin-bottom:16px">
            {booth ? `The booth harness at ${booth} is not reachable` : 'The booth address must be http://localhost or 127.0.0.1'}, so you are seeing the public live proof instead.
          </div>
        )}
        {reachable ? <Theater base={booth!} /> : reachable === false ? <LiveProof onLive={onLive} /> : <div class="card">Connecting to the booth…</div>}
      </div>
    </section>
  );
}
