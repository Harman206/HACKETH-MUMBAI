import { STEPS } from '../copy';

/** One node of the rail: a ring, a filled ring (now) or a check (done). */
function Node({ state, n }: { state: 'done' | 'now' | 'next'; n: number }) {
  return (
    <svg class="node" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" class="node-ring" />
      {state === 'done' ? (
        <path d="M10 16.5l4 4 8-8.5" fill="none" class="node-mark" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ) : (
        <text x="16" y="16" dy=".36em" text-anchor="middle" class="node-num">
          {n}
        </text>
      )}
    </svg>
  );
}

/** Verify → Connect → Positions → Exit as a horizontal rail, with a plain-language explanation of the current step. */
export function Stepper({ current, facts }: { current: 1 | 2 | 3 | 4; facts?: { label: string; value: string }[] }) {
  const step = STEPS[current - 1]!;
  return (
    <section class="stepper" aria-label="Progress">
      <ol class="rail">
        {STEPS.map((s) => {
          const st = s.n < current ? 'done' : s.n === current ? 'now' : 'next';
          return (
            <li class={`rail-step ${st}`} aria-current={s.n === current ? 'step' : undefined}>
              <Node state={st} n={s.n} />
              <span class="rail-label">
                <span class="rail-kicker">Step {s.n}</span>
                <span class="rail-title">{s.title}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <details class="whats" open>
        <summary>
          <span class="label">Now</span> {step.title}
        </summary>
        <p>{step.what}</p>
        {facts && facts.length > 0 && (
          <dl class="facts">
            {facts.map((f) => (
              <>
                <dt>{f.label}</dt>
                <dd class={f.value.length > 40 ? 'mono' : 'num'}>{f.value}</dd>
              </>
            ))}
          </dl>
        )}
      </details>
    </section>
  );
}
