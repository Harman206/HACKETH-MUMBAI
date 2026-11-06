import { useState } from 'preact/hooks';
import { readBlackoutRecords } from '@blackout/ens';
import type { Quorum } from '@blackout/quorum';
import type { Settings } from '../settings';
import { checkPastedText, siteHashCheck, type CheckResult, type SiteCheck } from '../check';
import { ENS_CONFIG } from '../config';

/** Paste what a live site asks you to sign; the Exit Guard explains whether it is a safe exit. */
export function CheckScreen(props: { settings: Settings; quorumFor(chainId: number): Quorum }) {
  const { settings } = props;
  const [pasted, setPasted] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState('');
  const [site, setSite] = useState<SiteCheck | null>(null);

  async function runSite() {
    try {
      const rec = await readBlackoutRecords(settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG);
      setSite(await siteHashCheck(bundle, rec.site));
    } catch (e) {
      setSite({ verdict: 'unset', sha256: (e as Error).message });
    }
  }

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const rec = await readBlackoutRecords(settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG);
      setResult(checkPastedText({ text: pasted, to, account, chainId: settings.targetChainId, manifest: rec.manifest }));
    } catch (e) {
      setResult({ verdict: 'blocked', sentences: [`Could not check: ${(e as Error).message}`] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card">
      <h2>Check a transaction</h2>
      <p class="muted">
        Paste what a website asks your wallet to sign. The Exit Guard compares it with {settings.ensName || 'the protocol'}’s published exits.
      </p>
      <label for="pasted">Transaction (wallet JSON or calldata)</label>
      <textarea id="pasted" value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} placeholder='{"to":"0x…","data":"0x…","value":"0x0"}' />
      <label for="to">
        To <span class="hint">(only if you pasted bare calldata)</span>
      </label>
      <input id="to" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} placeholder="0x…" />
      <label for="acct">
        Your address <span class="hint">(required: where the funds must go)</span>
      </label>
      <input id="acct" value={account} onInput={(e) => setAccount((e.target as HTMLInputElement).value)} placeholder="0x…" />
      <div style="margin-top:16px">
        <button disabled={busy || !settings.ensName} onClick={run}>
          {busy ? 'Checking…' : 'Check'}
        </button>
        {!settings.ensName && <span class="muted" style="margin-left:8px">Enter the ENS name on the Exit tab first.</span>}
      </div>
      <h2 style="margin-top:24px">Is this the official site?</h2>
      <p class="muted">Paste the site's main script (view-source → main bundle). Its fingerprint is compared with the protocol's <code>org.blackout.site</code> record.</p>
      <textarea id="bundle" value={bundle} onInput={(e) => setBundle((e.target as HTMLTextAreaElement).value)} />
      <div style="margin-top:8px">
        <button class="secondary" disabled={!bundle || !settings.ensName} onClick={runSite}>Compare with ENS</button>
      </div>
      {site && (
        <p data-site={site.verdict} class={site.verdict === 'match' ? 'ok' : 'bad'} style="margin-top:8px">
          {site.verdict === 'match' ? 'Matches the published site bundle.' : site.verdict === 'mismatch' ? 'Does NOT match the published site bundle. The site may be hijacked: use this kit to exit.' : 'The protocol has not published a site fingerprint.'}{' '}
          <span class="mono">{site.sha256}</span>
        </p>
      )}
      {result && (
        <div class={`card ${result.verdict === 'blocked' ? 'error' : ''}`} role="status" data-verdict={result.verdict}>
          <b class={result.verdict === 'blocked' ? 'bad' : 'ok'}>{result.verdict === 'blocked' ? 'Do not sign this.' : 'Safe exit.'}</b>
          <ul class="reasons">
            {result.sentences.map((s) => (
              <li>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
