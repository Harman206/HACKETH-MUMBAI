import { LiveProof } from './LiveProof';

export function LiveDemo({ onLive }: { onLive(s: string): void }) {
  return (
    <section id="demo">
      <div class="wrap">
        <h2>Live demo</h2>
        <p class="lede">Everything below is read from the blockchain as you look at it. At the booth, the same section turns into the interactive Attack Theater.</p>
        <LiveProof onLive={onLive} />
      </div>
    </section>
  );
}
