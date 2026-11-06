import { useEffect, useState } from 'preact/hooks';
import { createQuorum } from '@copeybara/quorum';
import { readCopeybaraRecords } from '@copeybara/ens';
import networks from '../../../../config/networks.json';
import { ENS_NAME, RESOLVER, SAFE, type PermissionCheck } from '../content';
import { readLiveProof, type DemoRun, type LiveProof as Proof } from '../live';

const tx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const addr = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

function PermissionTable({ rows, label }: { rows: PermissionCheck[]; label: string }) {
  return (
    <table class="perm" aria-label={label}>
      <tbody>
        {rows.map((x) => (
          <tr key={x.check}>
            <td>{x.check}</td>
            <td class={x.pass ? 'ok' : 'bad'}>{x.pass ? (x.expected === 'revert' ? 'reverted ✓' : 'allowed ✓') : 'FAILED'}</td>
            <td>{x.tx && <a href={tx(x.tx)}>tx</a>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Public mode: live on-chain proof anyone can check, no booth needed. */
export function LiveProof({ onLive }: { onLive(s: string): void }) {
  const [p, setP] = useState<Proof | null>(null);
  useEffect(() => {
    const q = createQuorum({ urls: networks.defaultRpcs['11155111'], expectedChainId: 11155111 });
    readLiveProof({
      readRecords: () => readCopeybaraRecords(ENS_NAME, q, { universalResolver: networks.ens.universalResolver as `0x${string}` }),
      fetchRun: async () => {
        const r = await fetch('demo-runs/latest.json');
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as DemoRun;
      },
    }).then((x) => {
      setP(x);
      if (x.release) onLive(`Sepolia testnet · release v${x.release.version}`);
    });
  }, []);

  return (
    <div class="proof-layout">
      <article class="card proof-card" aria-live="polite">
        <p class="kicker">Checked just now, on Sepolia</p>
        {!p && <p class="proof-big"><i class="spin" />Asking three providers…</p>}
        {p?.error && <><p class="bad">We couldn’t verify the current release on ENS. Reload to try again. You can still review the recorded rescue.</p><details><summary>Provider details</summary><p>{p.error}</p></details></>}
        {p?.release && (
          <>
            <p class="proof-big"><span class="proof-ok">✓</span> Release v{p.release.version} is official</p>
            <p>Published on <b>{ENS_NAME}</b> at block {p.block}. At least two of three independent providers agree.</p>
            <p class="checksum">Fingerprint</p>
            <p class="mono">{p.release.sha256}</p>
          </>
        )}
      </article>
      <article class="card proof-card recorded-run">
        <p class="kicker">Last recorded rescue</p>
        {!p ? (
          <p>Loading the recorded run…</p>
        ) : !p.lastRun ? (
          <p>There’s no recorded run available. The booth demo can record a new one.</p>
        ) : (
          <>
            <dl class="rescue">
              <div><dt>Website hijacked and drained</dt><dd class="bad">{p.lastRun.drained}</dd><a href={tx(p.lastRun.drainTx)}>drain tx ↗</a></div>
              <div><dt>Recovered with the site down</dt><dd class="ok">{p.lastRun.recovered}</dd><a href={tx(p.lastRun.rescueTx)}>exit tx ↗</a></div>
            </dl>
            <p class="muted small">{p.lastRun.network === 'local-fork' ? 'Local fork' : 'Sepolia'} · {new Date(p.lastRun.at).toUTCString()}. The kit can’t undo an approval you already signed; it saves what is still yours, and refuses to send that approval in the first place.</p>
          </>
        )}
      </article>
      <details class="card proof-more">
        <summary>For the technically curious: what a stolen key can change</summary>
        {p?.release && (
          <>
            <p>Published exit contracts (the mainnet entries are tested on mainnet forks, not used in this demo):</p>
            <ul>{p.exits.map((e) => <li>{e}</li>)}</ul>
            <p class="muted small">Owned by the 2-of-3 <a href={addr(SAFE)}>release Safe</a> via its <a href={addr(RESOLVER)}>Permissioned Resolver</a>. In this demo all three Safe keys are held by one maintainer.</p>
          </>
        )}
        <h3>A stolen website key</h3>
        <PermissionTable rows={p?.permissions ?? []} label="Website key transaction results" />
        <h3>A stolen watcher key</h3>
        <p class="muted small">The watcher may only write the status and blocklist records, which warn about or block websites, never an exit.</p>
        <PermissionTable rows={p?.watcherPermissions ?? []} label="Watcher key transaction results" />
      </details>
    </div>
  );
}
