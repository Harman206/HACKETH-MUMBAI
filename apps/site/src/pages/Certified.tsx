import { useEffect, useState } from 'preact/hooks';
import { createQuorum } from '@copeybara/quorum';
import { CopyButton } from '../sections/Ui';
import networks from '../../../../config/networks.json';
import { CERTIFIED, RULE, checkCertified, findCertified, type Verdict } from '../certified';
import type { CertifiedEntry } from '@copeybara/protocol-cli/onchain';

const addr = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

/** The certified tick. Only ever drawn next to a verdict this page just computed from ENS. */
export function CertifiedTick({ size = 22, off }: { size?: number; off?: boolean }) {
  return (
    <svg class={`tick ${off ? 'tick-off' : ''}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 1.6l2.5 1.8 3.1-.1 1 2.9 2.5 1.9-.9 3 .9 2.9-2.5 1.9-1 2.9-3.1-.1L12 22.4l-2.5-1.8-3.1.1-1-2.9-2.5-1.9.9-2.9-.9-3 2.5-1.9 1-2.9 3.1.1z" fill="currentColor" />
      {off ? <path d="M8.5 8.5l7 7m0-7l-7 7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none" /> : <path d="M7.4 12.3l3 3 6.2-6.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none" />}
    </svg>
  );
}

const quorum = () => createQuorum({ urls: networks.defaultRpcs['11155111'], expectedChainId: 11155111 });

function useVerdict(e: CertifiedEntry | null): { v: Verdict | null; error: string | null } {
  const [v, setV] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setV(null);
    setError(null);
    if (e) checkCertified(e, quorum()).then(setV, (x: Error) => setError(x.message));
  }, [e?.name]);
  return { v, error };
}

function Status({ e }: { e: CertifiedEntry }) {
  const { v, error } = useVerdict(e);
  if (error) return <span class="cert-state warn">Couldn’t reach the RPCs</span>;
  if (!v) return <span class="cert-state muted">Checking ENS…</span>;
  return v.certified ? (
    <span class="cert-state ok"><CertifiedTick size={18} /> Certified</span>
  ) : (
    <span class="cert-state bad"><CertifiedTick size={18} off /> Suspended</span>
  );
}

const kitHref = (name: string) => `copeybara-kit.html?ens=${encodeURIComponent(name)}`;

/** How a user follows a listed protocol: the extension picks it from its own bundled list (this site cannot reach the extension). */
function FollowHelp({ e }: { e: CertifiedEntry }) {
  return (
    <ol class="follow-steps">
      <li><a href="#/extension">Install the Copeybara extension</a> (Chrome, unpacked).</li>
      <li>In setup, on the <b>Protocols</b> step, press <b>Follow {e.protocol}</b> under “Copeybara certified”.</li>
      <li>Already set up? Dashboard → Setup → Protocols. Or type <span class="mono">{e.name}</span> <CopyButton text={e.name} label="Copy name" /></li>
    </ol>
  );
}

/** One listed protocol: live tick, ENS name, and the two ways to use it. */
function ProtocolTile({ e }: { e: CertifiedEntry }) {
  const [follow, setFollow] = useState(false);
  return (
    <article class="cert-card" data-certified={e.name}>
      <div class="cert-card-top">
        <div>
          <h3><a href={`#/certified/${e.name}`}>{e.protocol}</a></h3>
          <p class="mono">{e.name}</p>
        </div>
        <Status e={e} />
      </div>
      <p class="cert-meta">Listed since {e.since}{e.note && <> · <span class="muted">{e.note}</span></>}</p>
      <div class="cert-actions">
        <button type="button" class="btn" aria-expanded={follow} onClick={() => setFollow(!follow)}>Follow in Copeybara</button>
        <a class="btn ghost" href={kitHref(e.name)} target="_blank" rel="noopener">Open exit kit <span aria-hidden="true">↗</span></a>
        <a class="text-link" href={`#/certified/${e.name}`}>Live checks <span aria-hidden="true">→</span></a>
      </div>
      {follow && <FollowHelp e={e} />}
    </article>
  );
}

const MEANS = [
  { title: 'Checked before listing', body: 'The team ran copeybara certify and sent us the report. It includes a fork drill: a real position exited with their website and main RPC switched off.' },
  { title: 'Re-checked every time you look', body: 'This page reads the protocol’s ENS name through three independent RPCs and re-runs the rules below. If the team loosens its keys or stops publishing, the tick goes away on its own.' },
  { title: 'Not an audit', body: 'It says nothing about contract bugs, solvency or paused contracts. It cannot see who holds the Safe keys. A badge on a protocol’s own site proves nothing; only this page’s live check counts.' },
];

function Directory() {
  return (
    <>
      <section class="section page-hero">
        <div class="wrap cert-hero-layout">
          <div>
            <p class="eyebrow"><CertifiedTick size={18} /> Copeybara certified</p>
            <h1 class="page-title">A tick you can check yourself.</h1>
            <p class="lede">
              Certified means a protocol’s users can still get out when its website is gone: the exit kit, the exit contracts and the keys that
              can change them are all published on ENS, and locked down. We check before listing. This page checks again, live, every time.
            </p>
          </div>
          <img class="page-copey" src="copey/verified.webp" alt="" width={200} height={200} />
        </div>
      </section>
      <section class="section tight">
        <div class="wrap">
          <h2 class="h2-sm means-head">What certified means</h2>
          <div class="cap-grid means">
            {MEANS.map((m, i) => (
              <article key={m.title} class="cap">
                <p class="cap-pkg mono">{i + 1}</p>
                <h3>{m.title}</h3>
                <p>{m.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="directory" class="section evidence">
        <div class="wrap">
          <header class="section-head">
            <h2 class="h2-sm">Certified protocols</h2>
            <p class="lede">Follow one in the Copeybara extension, or open its exit kit. The kit checks itself against the protocol’s ENS name before it does anything.</p>
          </header>
          <div class="cert-grid">
            {CERTIFIED.map((e) => <ProtocolTile key={e.name} e={e} />)}
          </div>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap section-split">
          <header class="section-head">
            <h2 class="h2-sm">What the tick checks</h2>
            <p class="lede">All on chain, re-checked on every view. Nothing here depends on the protocol’s website or on us.</p>
          </header>
          <ol class="protocol-steps">
            {Object.values(RULE).map((r) => <li key={r}><p>{r}</p></li>)}
            <li><p>Before listing: <code>copeybara certify</code> passes, including a fork drill that exits a real position with the website and the primary RPC switched off.</p></li>
          </ol>
        </div>
      </section>
      <section class="section cert-band">
        <div class="wrap cert-band-layout">
          <CertifiedTick size={64} />
          <div>
            <h2 class="h2-sm">Run a protocol?</h2>
            <p class="lede">Set up with the Copeybara SDK, pass <code>copeybara certify</code>, send us the report. A guided setup, about an hour.</p>
          </div>
          <a class="btn" href="#/developers/onboarding">Add your protocol <span aria-hidden="true">→</span></a>
        </div>
      </section>
    </>
  );
}

function Detail({ name }: { name: string }) {
  const e = findCertified(name);
  const { v, error } = useVerdict(e);
  if (!e) {
    return (
      <section class="section page-hero">
        <div class="wrap">
          <p class="eyebrow bad"><CertifiedTick off /> Not certified</p>
          <h1 class="page-title">{name}</h1>
          <p class="lede">
            This name is not in the Copeybara certified registry. If a website shows a Copeybara certified badge for it, the badge is not ours.
          </p>
          <p><a class="text-link" href="#/certified">See the certified protocols <span aria-hidden="true">→</span></a></p>
        </div>
      </section>
    );
  }
  return (
    <section class="section page-hero">
      <div class="wrap">
        <p><a class="text-link" href="#/certified"><span aria-hidden="true">←</span> All certified protocols</a></p>
        <div class={`cert-hero ${v ? (v.certified ? 'is-ok' : 'is-bad') : ''}`} aria-live="polite">
          <CertifiedTick size={56} off={!!v && !v.certified} />
          <div>
            <h1 class="page-title">{e.protocol}</h1>
            <p class="mono">{e.name}</p>
            <p class="cert-verdict">
              {error ? 'Couldn’t reach enough RPC providers to check. Reload to try again.' : !v ? 'Reading ENS through three Sepolia providers…' : v.certified ? `Copeybara certified · re-checked live at Sepolia block ${v.block}` : `Certification suspended · checked at Sepolia block ${v.block}`}
            </p>
          </div>
        </div>
        <div class="cert-actions detail">
          <a class="btn ghost" href={kitHref(e.name)} target="_blank" rel="noopener">Open exit kit <span aria-hidden="true">↗</span></a>
        </div>
        <div class="card follow-card">
          <h3>Follow {e.protocol} in Copeybara</h3>
          <FollowHelp e={e} />
        </div>
        {e.note && <p class="card notice cert-note">{e.note}</p>}
        {v && (
          <table class="cert-table checks">
            <tbody>
              {v.checks.map((c) => (
                <tr key={c.name}>
                  <td class={c.level === 'fail' ? 'bad' : c.level === 'warn' ? 'warn' : 'ok'}>{c.level === 'fail' ? '✗' : c.level === 'warn' ? '!' : '✓'}</td>
                  <td>{RULE[c.name] ?? c.name}</td>
                  <td class="mono">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <dl class="cert-addrs">
          <div><dt>Release Safe</dt><dd><a class="mono" href={addr(e.safe)}>{e.safe}</a></dd></div>
          <div><dt>Resolver</dt><dd><a class="mono" href={addr(e.resolver)}>{e.resolver}</a></dd></div>
          <div><dt>Website key</dt><dd><a class="mono" href={addr(e.websiteKey)}>{e.websiteKey}</a></dd></div>
          <div><dt>Watcher</dt><dd><a class="mono" href={addr(e.watcher)}>{e.watcher}</a></dd></div>
        </dl>
        <p class="muted">Check it without this website: the same reads run from a terminal with <code>copeybara verify</code>, and <code>scripts/verify-kit.sh copeybara-kit.html {e.name}</code> checks a saved kit against this name.</p>
      </div>
    </section>
  );
}

export function CertifiedPage({ name }: { name: string | null }) {
  return name ? <Detail name={name} /> : <Directory />;
}
