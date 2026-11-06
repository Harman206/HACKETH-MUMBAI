import { useState } from 'preact/hooks';
import { readBlackoutRecords, type BlackoutRecords } from '@blackout/ens';
import type { Quorum } from '@blackout/quorum';
import type { Settings } from '../settings';
import { CHAIN_NAMES, ENS_CONFIG } from '../config';

/** Read-only view of the ENS records. No wallet needed. */
export function ReleaseScreen(props: { settings: Settings; update(p: Partial<Settings>): void; quorumFor(chainId: number): Quorum }) {
  const [rec, setRec] = useState<BlackoutRecords | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setErr('');
    try {
      setRec(await readBlackoutRecords(props.settings.ensName, props.quorumFor(ENS_CONFIG.chainId), ENS_CONFIG));
    } catch (e) {
      setRec(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="card">
      <h2>Release and published exits</h2>
      <label for="ens-r">ENS name</label>
      <input id="ens-r" placeholder="protocol.eth" value={props.settings.ensName} onInput={(e) => props.update({ ensName: (e.target as HTMLInputElement).value })} />
      <div style="margin-top:12px">
        <button disabled={busy || !props.settings.ensName} onClick={load}>{busy ? 'Reading…' : 'Read records'}</button>
      </div>
      {err && <p class="bad" role="alert" style="margin-top:12px">{err}</p>}
      {rec && (
        <div data-release={rec.release.version} style="margin-top:12px">
          <p>
            <b>Release v{rec.release.version}</b> · block {rec.block.toString()}
          </p>
          <p class="muted">Kit fingerprint (sha256):</p>
          <pre>{rec.release.sha256}</pre>
          {rec.url && <p class="muted">Website (writable by the website key, not used by the kit): <span class="mono">{rec.url}</span></p>}
          {rec.site && <p class="muted">Official site bundle sha256: <span class="mono">{rec.site}</span></p>}
          {Object.entries(rec.manifest.chains).map(([cid, protos]) => (
            <div>
              <h3 style="font-size:15px;margin:12px 0 4px">{CHAIN_NAMES[Number(cid)] ?? `Chain ${cid}`}</h3>
              <ul class="reasons">
                {Object.entries(protos).flatMap(([p, roles]) =>
                  Object.entries(roles ?? {}).map(([role, t]) => (
                    <li>
                      {p} {role}: <span class="mono">{t.address}</span> {t.selectors.length ? `(${t.selectors.length} exit functions)` : '(read only)'}
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
