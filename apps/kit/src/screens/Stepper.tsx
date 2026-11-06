import { STEPS } from '../copy';

/** Verify → Connect → Positions → Exit, with a plain-language explanation of the current step. */
export function Stepper({ current, facts }: { current: 1 | 2 | 3 | 4; facts?: { label: string; value: string }[] }) {
  const step = STEPS[current - 1]!;
  return (
    <section class="stepper" aria-label="Progress">
      <ol>
        {STEPS.map((s) => (
          <li class={s.n < current ? 'done' : s.n === current ? 'now' : ''} aria-current={s.n === current ? 'step' : undefined}>
            <span class="dot">{s.n < current ? '✓' : s.n}</span>
            <span>{s.title}</span>
          </li>
        ))}
      </ol>
      <details class="whats" open>
        <summary>What’s happening: {step.title}</summary>
        <p>{step.what}</p>
        {facts && facts.length > 0 && (
          <dl class="facts">
            {facts.map((f) => (
              <>
                <dt>{f.label}</dt>
                <dd class={f.value.length > 40 ? 'mono' : ''}>{f.value}</dd>
              </>
            ))}
          </dl>
        )}
      </details>
    </section>
  );
}
