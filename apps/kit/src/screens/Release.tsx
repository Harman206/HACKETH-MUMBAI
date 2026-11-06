import { useState } from 'preact/hooks';
import { readCopeybaraRecords, type CopeybaraRecords } from '@copeybara/ens';
import type { Quorum } from '@copeybara/quorum';
import type { Settings } from '../settings';
import { CHAIN_NAMES, ENS_CONFIG } from '../config';
import { IconFingerprint } from './Icons';

/** Read-only view of the ENS records. No wallet needed. */
export function ReleaseScreen(props: { settings: Settings; update(p: Partial<Settings>): void; quorumFor(chainId: number): Quorum }) {
  const [rec, setRec] = useState<CopeybaraRecords | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setErr('');
    try {
      setRec(await readCopeybaraRecords(props.settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG));
    } catch (e) {
      setRec(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="card">
      <div class="card-head">
        <span class="badge-icon"><IconFingerprint /></span>
        <div>
          <div class="label">No wallet needed</div>
          <h2>Release and published exits</h2>
        </div>
      </div>
      <div class="field">
        <label for="ens-r">ENS name</label>
        <input id="ens-r" placeholder="protocol.eth" value={props.settings.ensName} onInput={(e) => props.update({ ensName: (e.target as HTMLInputElement).value })} />
      </div>
      <div class="actions">
        <button class="primary" disabled={busy || !props.settings.ensName} onClick={load}>{busy ? 'Reading…' : 'Read records'}</button>
      </div>
      {err && <p class="bad" role="alert">{err}</p>}
      {rec && (
        <div data-release={rec.release.version} class="release">
          <p>
            <span class="chip">Release v{rec.release.version}</span> <span class="muted num">· block {rec.block.toString()}</span>
          </p>
          <div class="label">Kit fingerprint (sha256)</div>
          <pre>{rec.release.sha256}</pre>
          {rec.url && <p class="muted small">Website (writable by the website key, not used by the kit): <span class="mono">{rec.url}</span></p>}
          {rec.site && <p class="muted small">Official site scripts ({rec.site.length}, sha256): <span class="mono">{rec.site.join(' ')}</span></p>}
          {Object.entries(rec.manifest.chains).map(([cid, protos]) => (
            <div class="chain-block">
              <div class="label">{CHAIN_NAMES[Number(cid)] ?? `Chain ${cid}`}</div>
              <ul class="contracts">
                {Object.entries(protos).flatMap(([p, roles]) =>
                  Object.entries(roles ?? {}).map(([role, t]) => (
                    <li>
                      <span>
                        <b>{p}</b> <span class="muted">{role}</span>
                      </span>
                      <span class="mono">{t.address}</span>
                      <span class="chip">{t.selectors.length ? `${t.selectors.length} exit functions` : 'read only'}</span>
                    </li>
                  )),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
