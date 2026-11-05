import { useState } from 'preact/hooks';
import type { Address } from '@blackout/core';
import { readBlackoutRecords } from '@blackout/ens';
import type { Quorum } from '@blackout/quorum';
import type { Settings } from '../settings';
import { checkPasted, parsePasted, type CheckResult } from '../check';
import { ENS_CONFIG } from '../config';

/** Paste what a live site asks you to sign; the Exit Guard explains whether it is a safe exit. */
export function CheckScreen(props: { settings: Settings; quorumFor(chainId: number): Quorum }) {
  const { settings } = props;
  const [pasted, setPasted] = useState('');
  const [to, setTo] = useState('');
  const [account, setAccount] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const rec = await readBlackoutRecords(settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG);
      const p = parsePasted(pasted);
      const me = (account || p.from || '0x0000000000000000000000000000000000000001') as Address;
      setResult(
        checkPasted(
          { to: p.to ?? to, data: p.data ?? '', value: p.value, from: p.from, chainId: settings.targetChainId },
          { account: me, chainId: settings.targetChainId, manifest: rec.manifest },
        ),
      );
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
        Your address <span class="hint">(to check where funds would go)</span>
      </label>
      <input id="acct" value={account} onInput={(e) => setAccount((e.target as HTMLInputElement).value)} placeholder="0x…" />
      <div style="margin-top:16px">
        <button disabled={busy || !settings.ensName} onClick={run}>
          {busy ? 'Checking…' : 'Check'}
        </button>
        {!settings.ensName && <span class="muted" style="margin-left:8px">Enter the ENS name on the Exit tab first.</span>}
      </div>
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
