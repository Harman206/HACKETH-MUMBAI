import { BENCH_DATE, BENCH_DOCS, BENCH_LIMITS, BENCH_REPRO, BENCH_STATS, BENCHMARKS, DATASETS, GAPS, benchDoc, type GapStatus } from '../benchmarks';

const STATUS: Record<GapStatus, string> = { fixed: 'Fixed', partly: 'Partly', changed: 'Changed' };
const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** B1 before → after table (shipped default settings), from docs/benchmarks/README.md. */
const B1_ROWS = [
  { set: 'Our drainer set', stopped: ['99.6%', '99.6%'], red: ['42.5%', '1.6%'] },
  { set: 'PTXPhish (NDSS ’25)', stopped: ['79.2%', '99.9%'], red: ['17.9%', '8.7%'] },
];

export function Benchmarks() {
  return (
    <section id="benchmarks" class="section bench">
      <div class="wrap">
        <header class="section-head" data-reveal>
          <p class="kicker">Benchmarks · run {BENCH_DATE}</p>
          <h2>Tested on real attacks, not only our demo.</h2>
          <p class="lede">
            We ran Copeybara’s own detection code on public data from past drains and hijacks. The first run found eight gaps.
            We fixed them and ran it again. Here is what it catches now, and what still gets through.
          </p>
        </header>

        <ul class="bench-stats" data-reveal>
          {BENCH_STATS.map((s) => (
            <li key={s.label}>
              <p class="bench-figure">{s.figure}</p>
              <p class="bench-label">{s.label}</p>
              <p class="bench-detail">{s.detail}{s.before && <> · was {s.before}</>}</p>
            </li>
          ))}
        </ul>

        <div class="bench-data" data-reveal>
          <p class="bench-sub">What we ran it on</p>
          <ul>
            {DATASETS.map((d) => (
              <li key={d.name}><a href={d.url} {...ext}>{d.name} ↗</a><span>{d.what}</span></li>
            ))}
          </ul>
        </div>

        <div class="bench-list">
          {BENCHMARKS.map((b) => (
            <article key={b.id} class="bench-card" data-reveal>
              <header class="bench-card-head">
                <span class="bench-id">{b.id}</span>
                <div>
                  <h3>{b.title}</h3>
                  <p class="muted small">Measures {b.code}</p>
                </div>
                <a class="text-link small" href={benchDoc(b.report)} {...ext}>Full report ↗</a>
              </header>
              <p class="bench-ran"><b>What we ran.</b> {b.ran}</p>
              {b.id === 'B1' && (
                <div class="bench-table-wrap">
                  <table class="bench-table">
                    <caption>Shipped defaults, before → after the fixes</caption>
                    <thead><tr><th scope="col">Set</th><th scope="col">Phishing stopped</th><th scope="col">Real dapp requests raising the red alarm</th></tr></thead>
                    <tbody>
                      {B1_ROWS.map((r) => (
                        <tr key={r.set}>
                          <th scope="row">{r.set}</th>
                          <td><span class="was">{r.stopped[0]}</span> → <b>{r.stopped[1]}</b></td>
                          <td><span class="was">{r.red[0]}</span> → <b>{r.red[1]}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div class="bench-cols">
                <div>
                  <p class="bench-sub ok">What worked</p>
                  <ul class="bench-points ok">{b.worked.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
                <div>
                  <p class="bench-sub bad">What didn’t</p>
                  <ul class="bench-points bad">{b.missed.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div class="bench-gaps" data-reveal>
          <h3>The eight gaps the first run found</h3>
          <div class="bench-table-wrap">
            <table class="bench-table">
              <thead><tr><th scope="col">Gap</th><th scope="col">First run</th><th scope="col">Now</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {GAPS.map((g) => (
                  <tr key={g.gap}>
                    <th scope="row">{g.gap}</th>
                    <td class="was">{g.before}</td>
                    <td>{g.after}</td>
                    <td><span class={`bench-status ${g.status}`}>{STATUS[g.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div class="bench-foot" data-reveal>
          <div>
            <h3>Read the numbers with this in mind</h3>
            <ul class="bench-points">{BENCH_LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
          <div>
            <h3>Run it yourself</h3>
            <p class="muted small">The committed data files are the exact inputs and outputs, so B1 reruns offline in seconds.</p>
            <pre class="bench-code"><code>{BENCH_REPRO}</code></pre>
            <a class="text-link" href={BENCH_DOCS} {...ext}>All reports, data and scripts ↗</a>
          </div>
        </div>
      </div>
    </section>
  );
}
