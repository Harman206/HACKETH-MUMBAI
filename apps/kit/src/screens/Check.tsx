import { useState } from 'preact/hooks';
import { readCopeybaraRecords } from '@copeybara/ens';
import type { Quorum } from '@copeybara/quorum';
import type { Settings } from '../settings';
import { checkPastedText, prefillFromUrl, siteHashCheck, type CheckResult, type SiteCheck } from '../check';
import { ENS_CONFIG } from '../config';
import { IconCheckCircle, IconFingerprint, IconInfo, IconSearch, IconStop } from './Icons';

/** Paste what a live site asks you to sign; the Exit Guard explains whether it is a safe exit. */
export function CheckScreen(props: { settings: Settings; quorumFor(chainId: number): Quorum }) {
  const { settings } = props;
  const [pasted, setPasted] = useState(() => (typeof location !== 'undefined' ? (prefillFromUrl(location.href) ?? '') : ''));
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState('');
  const [site, setSite] = useState<SiteCheck | null>(null);

  async function runSite() {
    try {
      const rec = await readCopeybaraRecords(settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG);
      setSite(await siteHashCheck(bundle, rec.site));
    } catch (e) {
      setSite({ verdict: 'unset', sha256: (e as Error).message });
    }
  }

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const rec = await readCopeybaraRecords(settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG);
      setResult(checkPastedText({ text: pasted, to, account, chainId: settings.targetChainId, manifest: rec.manifest }));
    } catch (e) {
      setResult({ verdict: 'not-exit', sentences: [`Could not check: ${(e as Error).message}`] });
    } finally {
      setBusy(false);
    }
  }

  const VerdictIcon = result ? { dangerous: IconStop, 'not-exit': IconInfo, 'safe-exit': IconCheckCircle }[result.verdict] : null;
  return (
    <>
      <div class="card">
        <div class="card-head">
          <span class="badge-icon"><IconSearch /></span>
          <div>
            <div class="label">Before you sign</div>
            <h2>Check a transaction</h2>
          </div>
        </div>
        <p class="muted">
          Paste what a website asks your wallet to sign. The Exit Guard compares it with {settings.ensName || 'the protocol'}’s published exits.
        </p>
        <div class="field">
          <label for="pasted">Transaction <span class="hint">Wallet JSON or calldata</span></label>
          <textarea id="pasted" spellcheck={false} class="tall" value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} placeholder='{"to":"0x…","data":"0x…","value":"0x0"}' />
        </div>
        <div class="grid2">
          <div class="field">
            <label for="to">
              To <span class="hint">Only if you pasted bare calldata</span>
            </label>
            <input id="to" spellcheck={false} class="mono-input" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} placeholder="0x…" />
          </div>
          <div class="field">
            <label for="acct">
              Your address <span class="hint">Required: where the funds must go</span>
            </label>
            <input id="acct" spellcheck={false} class="mono-input" value={account} onInput={(e) => setAccount((e.target as HTMLInputElement).value)} placeholder="0x…" />
          </div>
        </div>
        <div class="actions">
          <button class="primary lg" disabled={busy || !settings.ensName} onClick={run}>
            {busy ? 'Checking…' : 'Check'}
          </button>
          {!settings.ensName && <span class="muted small">Enter the ENS name on the Exit tab first.</span>}
        </div>
        {result && VerdictIcon && (
          <div class={`verdict verdict-${result.verdict}`} role="status" data-verdict={result.verdict}>
            <div class="verdict-title">
              <VerdictIcon size={22} />
              <span>{result.verdict === 'dangerous' ? 'Do not sign this.' : result.verdict === 'not-exit' ? 'Not an exit.' : 'Safe exit.'}</span>
            </div>
            <ul class="reasons">
              {result.sentences.map((s) => (
                <li>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div class="card">
        <div class="card-head">
          <span class="badge-icon"><IconFingerprint /></span>
          <div>
            <div class="label">Site fingerprint</div>
            <h2>Is this the official site?</h2>
          </div>
        </div>
        <p class="muted">Paste the site's main script (view-source → main bundle). Its fingerprint is compared with the protocol's <code>org.copeybara.site</code> record.</p>
        <textarea id="bundle" spellcheck={false} aria-label="Site script" value={bundle} onInput={(e) => setBundle((e.target as HTMLTextAreaElement).value)} />
        <div class="actions">
          <button class="secondary" disabled={!bundle || !settings.ensName} onClick={runSite}>Compare with ENS</button>
        </div>
        {site && (
          <p data-site={site.verdict} class={`notice ${site.verdict === 'match' ? 'ok-notice' : 'bad-notice'}`}>
            {site.verdict === 'match' ? <IconCheckCircle /> : <IconStop />}
            <span>
              {site.verdict === 'match' ? 'Matches the published site bundle.' : site.verdict === 'mismatch' ? 'Does NOT match the published site bundle. The site may be hijacked: use this kit to exit.' : 'The protocol has not published a site fingerprint.'}{' '}
              <span class="mono">{site.sha256}</span>
            </span>
          </p>
        )}
      </div>
    </>
  );
}
