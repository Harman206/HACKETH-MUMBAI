import { useEffect, useState } from 'preact/hooks';
import { createQuorum } from '@copeybara/quorum';
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

function Directory() {
  return (
    <>
      <section class="section page-hero">
        <div class="wrap">
          <p class="eyebrow"><CertifiedTick /> Copeybara certified</p>
          <h1 class="page-title">A tick you can check yourself.</h1>
          <p class="lede">
            Protocols we onboard get the Copeybara certified tick. It is not a logo we hand out: every time this page opens, it reads the protocol’s ENS
            name through three independent RPCs and re-runs the checks below. If a team loosens its keys or stops publishing, the tick goes away on
            its own.
          </p>
        </div>
      </section>
      <section class="section tight">
        <div class="wrap">
          <h2 class="h2-sm">Certified protocols</h2>
          <table class="cert-table">
            <thead><tr><th>Protocol</th><th>ENS name</th><th>Since</th><th>Live status</th></tr></thead>
            <tbody>
              {CERTIFIED.map((e) => (
                <tr key={e.name}>
                  <td><a href={`#/certified/${e.name}`}>{e.protocol}</a>{e.note && <small class="muted"> · testnet demo</small>}</td>
                  <td class="mono">{e.name}</td>
                  <td>{e.since}</td>
                  <td><Status e={e} /></td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <section class="section tight">
        <div class="wrap cols">
          <div class="card">
            <h3>Get certified</h3>
            <ol class="plain-list">
              <li>Set up with the <a href="#/developers">Copeybara SDK</a>: config, one Safe batch, watcher.</li>
              <li>Run <code>copeybara drill</code>, then <code>copeybara certify</code>.</li>
              <li>Send us <code>.copeybara/certification.json</code>. We review it and add your name to <code>config/certified.json</code> in the public repo.</li>
              <li>Add <code>&lt;copeybara-exit ens="you.eth" certified&gt;</code> to your site. It links here; it never draws the tick itself.</li>
            </ol>
          </div>
          <div class="card">
            <h3>What it does not mean</h3>
            <ul class="plain-list">
              <li>It is not a smart-contract audit. It says nothing about exploits, solvency or paused contracts.</li>
              <li>It cannot see who holds the Safe keys. Three keys on one laptop pass the 2-of-3 check.</li>
              <li>A badge on a protocol’s own website proves nothing. Only this page’s live check counts, and you should reach it by typing the address.</li>
            </ul>
          </div>
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
