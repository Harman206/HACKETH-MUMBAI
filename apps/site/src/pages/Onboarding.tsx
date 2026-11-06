import { useEffect, useState } from 'preact/hooks';
import { CONFIG_SAMPLE, ONBOARDING, PLUGINS, RUNBOOK, type OnbStep } from '../developers';
import { Code, Command, CopyButton, Lnk, scrollToId } from '../sections/Ui';
import copeyChecking from '../../../../assets/brand/copey-checking.png';
import copeyProtected from '../../../../assets/brand/copey-protected.png';

/** Ticked steps are a per-browser convenience only: nothing here is sent anywhere. */
const KEY = 'copeybara.onboarding.v1';
const IDS = new Set(ONBOARDING.map((s) => s.id));

function loadDone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && IDS.has(x)) : [];
  } catch {
    return [];
  }
}
function saveDone(ids: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private window or blocked storage: progress just isn't remembered */
  }
}

function PluginTabs() {
  const [i, setI] = useState(0);
  const p = PLUGINS[i]!;
  return (
    <div class="tabs">
      <div class="tab-list" role="tablist" aria-label="Build plugin">
        {PLUGINS.map((x, j) => (
          <button key={x.name} type="button" role="tab" id={`plugin-tab-${j}`} aria-selected={i === j} aria-controls="plugin-panel" tabIndex={i === j ? 0 : -1} class={i === j ? 'on' : ''} onClick={() => setI(j)}>
            {x.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="plugin-panel" aria-labelledby={`plugin-tab-${i}`}>
        <Code copy>{p.code}</Code>
      </div>
    </div>
  );
}

function Body({ s, done, onDone, last }: { s: OnbStep; done: boolean; onDone: (v: boolean, next: boolean) => void; last: boolean }) {
  return (
    <div class="onb-body" id={`onb-body-${s.id}`}>
      <div class="onb-part">
        <p class="onb-label">What you do</p>
        <p>{s.does}</p>
        {s.extra === 'config' && <Code label="copeybara.config.ts" copy>{CONFIG_SAMPLE}</Code>}
        {s.extra === 'plugins' && <PluginTabs />}
      </div>
      <div class="onb-part">
        <p class="onb-label">{s.cmds.length > 1 ? 'Run, in order' : 'Run'}</p>
        {s.cmds.map((c) => <Command key={c.code} code={c.code} note={c.note} />)}
      </div>
      <div class="onb-part">
        <p class="onb-label">What you should see</p>
        <pre class="onb-see">{s.see}</pre>
      </div>
      {s.extra === 'runbook' && (
        <dl class="runbook">
          {RUNBOOK.map((r) => <div key={r.when}><dt>{r.when}</dt><dd>{r.then}</dd></div>)}
        </dl>
      )}
      {s.links && (
        <p class="onb-links">
          {s.links.map((l) => <Lnk key={l.href} href={l.href}>{l.label} <span aria-hidden="true">→</span></Lnk>)}
        </p>
      )}
      <div class="onb-actions">
        <label class="onb-check">
          <input type="checkbox" checked={done} onChange={(e) => onDone((e.target as HTMLInputElement).checked, false)} data-done-check={s.id} />
          <span><b>Done</b> · {s.done}</span>
        </label>
        <button type="button" class="btn" onClick={() => onDone(true, true)}>
          {last ? 'Done, finish' : 'Done, next step'} <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

/** "Add your protocol": every step of the SDK, with the exact command, what it prints and a done check. */
export function Onboarding() {
  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(ONBOARDING[0]!.id);
  useEffect(() => {
    const d = loadDone();
    setDone(d);
    setOpen(ONBOARDING.find((s) => !d.includes(s.id))?.id ?? null);
  }, []);

  const mark = (id: string, v: boolean, next: boolean) => {
    const d = v ? [...new Set([...done, id])] : done.filter((x) => x !== id);
    setDone(d);
    saveDone(d);
    if (next) {
      const i = ONBOARDING.findIndex((s) => s.id === id);
      const n = ONBOARDING.slice(i + 1).find((s) => !d.includes(s.id)) ?? ONBOARDING.find((s) => !d.includes(s.id));
      setOpen(n?.id ?? null);
      requestAnimationFrame(() => scrollToId(n ? `step-${n.id}` : 'onb-finished'));
    }
  };
  const go = (id: string) => {
    setOpen(id);
    requestAnimationFrame(() => scrollToId(`step-${id}`));
  };
  const count = done.length;
  const total = ONBOARDING.length;
  const all = count === total;

  return (
    <section id="onboarding" class="section onb" aria-labelledby="onb-title">
      <div class="wrap">
        <header class="onb-head">
          <div>
            <p class="eyebrow">Add your protocol</p>
            <h2 id="onb-title" class="h2-sm">From your ENS name to a certified exit.</h2>
            <p class="lede">{total} steps, about an hour. Nothing here signs: your Safe owners approve one batch. Tick each step as you go. Your progress stays in this browser.</p>
          </div>
          <img class="onb-copey" src={all ? copeyProtected : copeyChecking} alt="" width={140} height={140} />
        </header>

        <div class="onb-progress" data-progress={count}>
          <div class="onb-meter" role="progressbar" aria-label="Onboarding progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={count}>
            <span style={{ width: `${(count / total) * 100}%` }} />
          </div>
          <p><b>{count} of {total} done</b>{count > 0 && <> · <button type="button" class="link-btn" onClick={() => { setDone([]); saveDone([]); go(ONBOARDING[0]!.id); }}>Start over</button></>}</p>
        </div>

        <div class="onb-layout">
          <nav class="onb-rail" aria-label="Onboarding steps">
            <ol>
              {ONBOARDING.map((s, i) => {
                const d = done.includes(s.id);
                return (
                  <li key={s.id} class={`${d ? 'done' : ''} ${open === s.id ? 'on' : ''}`}>
                    <button type="button" onClick={() => go(s.id)} aria-current={open === s.id ? 'step' : undefined}>
                      <span class="node" aria-hidden="true">{d ? '✓' : i + 1}</span>
                      <span>{s.short}</span>
                      {d && <span class="sr-only"> (done)</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <ol class="onb-steps">
            {ONBOARDING.map((s, i) => {
              const d = done.includes(s.id);
              const isOpen = open === s.id;
              return (
                <li key={s.id} id={`step-${s.id}`} class={`onb-step ${isOpen ? 'is-open' : ''} ${d ? 'is-done' : ''}`} data-onb-step={s.id}>
                  <button type="button" class="onb-toggle" aria-expanded={isOpen} aria-controls={`onb-body-${s.id}`} onClick={() => setOpen(isOpen ? null : s.id)}>
                    <span class="onb-n" aria-hidden="true">{d ? '✓' : i + 1}</span>
                    <span class="onb-title">
                      <small>Step {i + 1}{d ? ' · done' : ''}</small>
                      {s.title}
                    </span>
                    <span class="onb-chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && <Body s={s} done={d} last={i === total - 1} onDone={(v, next) => mark(s.id, v, next)} />}
                </li>
              );
            })}
          </ol>
        </div>

        {all && (
          <div id="onb-finished" class="onb-finished">
            <img src={copeyProtected} alt="" width={96} height={96} />
            <div>
              <h3>Your users have a way out.</h3>
              <p>Even with your website, DNS and RPC down, they can check the kit against your ENS name and exit straight from your contracts.</p>
            </div>
            <a class="btn" href="#/certified">See the certified directory <span aria-hidden="true">→</span></a>
          </div>
        )}
        <p class="onb-foot">Stuck on a step? <CopyButton text="pnpm copeybara help" label="Copy: pnpm copeybara help" /> or read the <Lnk href="#cli">CLI reference</Lnk>.</p>
      </div>
    </section>
  );
}
