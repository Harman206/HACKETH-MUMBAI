import { useEffect, useState } from 'preact/hooks';
import { ENS_NAME } from '../content';
import { reducedMotion, useInView } from '../motion';

/** Numbers and labels from the last recorded Sepolia rescue (demo-runs/latest.json) and the kit's own wording (apps/kit). */
const STAGES = ['down', 'verify', 'found', 'exiting', 'done'] as const;
type Stage = (typeof STAGES)[number];
const RAIL = ['Verify', 'Connect', 'Positions', 'Exit'];
const railStep: Record<Stage, number> = { down: 0, verify: 1, found: 3, exiting: 4, done: 5 };
const HOLD: Record<Stage, number> = { down: 1900, verify: 1600, found: 1900, exiting: 1500, done: 4200 };

const Check = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
);

export function KitSnippet() {
  const [ref, visible] = useInView<HTMLElement>();
  const [i, setI] = useState(() => (reducedMotion() ? STAGES.length - 1 : 0));
  const stage = STAGES[i]!;
  useEffect(() => {
    if (!visible || reducedMotion()) return;
    const t = setTimeout(() => setI((i + 1) % STAGES.length), HOLD[stage]);
    return () => clearTimeout(t);
  }, [i, visible]);
  const step = railStep[stage];
  return (
    <figure class="kit-snip" ref={ref} data-stage={stage}>
      <div class="snip-site" aria-hidden="true">
        <div class="win-bar"><i /><i /><i /><span>app.demoswap.xyz</span></div>
        <div class="snip-site-body">
          <p class="snip-site-title">This site can’t be reached</p>
          <p class="mono">DNS_PROBE_FINISHED_NXDOMAIN</p>
        </div>
      </div>
      <div class="snip-kit" aria-hidden="true">
        <div class="win-bar"><i /><i /><i /><span>copeybara-kit.html</span><em>saved file</em></div>
        <ol class="snip-rail">
          {RAIL.map((r, n) => (
            <li key={r} class={n + 1 < step ? 'done' : n + 1 === step ? 'now' : ''}>
              <span>{n + 1 < step ? <Check /> : n + 1}</span>{r}
            </li>
          ))}
        </ol>
        <div class="snip-card">
          <div>
            <p class="snip-label">Protocol</p>
            <p class="snip-name">{ENS_NAME}</p>
          </div>
          {stage === 'down' ? (
            <span class="snip-chip wait">Waiting</span>
          ) : stage === 'verify' ? (
            <span class="snip-chip wait"><i class="spin" />3 providers agree…</span>
          ) : (
            <span class="snip-chip ok"><Check />Verified on ENS</span>
          )}
        </div>
        <div class={`snip-card snip-pos ${step >= 3 ? 'show' : ''}`}>
          <div class="snip-row">
            <span class="snip-badge">U3</span>
            <div class="snip-row-text">
              <p class="snip-row-title">Uniswap v3 · DETH / DUSD</p>
              {stage === 'done' ? (
                <p class="snip-gain">+999.99 DETH + 999.99 DUSD back in your wallet</p>
              ) : (
                <p class="snip-sub">You would receive ≈ 999.99 DETH + 999.99 DUSD</p>
              )}
            </div>
            {stage === 'done' ? (
              <span class="snip-chip ok"><Check />Recovered</span>
            ) : (
              <span class={`snip-btn ${stage === 'exiting' ? 'busy' : ''}`}>{stage === 'exiting' ? 'Exiting…' : 'Exit'}</span>
            )}
          </div>
        </div>
        <div class={`snip-toast ${stage === 'done' ? 'show' : ''}`}>Saved by Copey!</div>
      </div>
      <figcaption>Illustration of the exit kit, with the amounts from the last recorded Sepolia rescue.</figcaption>
    </figure>
  );
}
