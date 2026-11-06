import { useEffect, useState } from 'preact/hooks';
import { createQuorum } from '@copeybara/quorum';
import { readCopeybaraRecords } from '@copeybara/ens';
import networks from '../../../../config/networks.json';
import { ENS_NAME, RESOLVER, SAFE } from '../content';
import { readLiveProof, type DemoRun, type LiveProof as Proof } from '../live';

const tx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
const addr = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

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
      <article class="card" aria-live="polite">
        <h3>Current ENS release</h3>
        {!p && <p>Checking the release with three Sepolia providers…</p>}
        {p?.error && <><p class="bad">We couldn’t verify the current release on ENS. Reload to try again. You can still review the recorded transactions below.</p><details><summary>Provider details</summary><p>{p.error}</p></details></>}
        {p?.release && (
          <>
            <p><b>{ENS_NAME}</b> · release <b>v{p.release.version}</b> · block {p.block}</p>
            <p style="margin-top:8px">Published SHA-256 fingerprint</p>
            <p class="mono">{p.release.sha256}</p>
            <p style="margin-top:8px">Published exit contracts:</p>
            <ul>{p.exits.map((e) => <li>{e}</li>)}</ul>
            <p class="muted" style="font-size:14px">Owned by the 2-of-3 <a href={addr(SAFE)}>release Safe</a> via its <a href={addr(RESOLVER)}>Permissioned Resolver</a>. In this demo all three Safe keys are held by one maintainer.</p>
          </>
        )}
      </article>
      <article class="card">
        <h3>What a stolen website key can change</h3>
        <table class="perm" aria-label="Website key transaction results">
          <tbody>
            {(p?.permissions ?? []).map((x) => (
              <tr key={x.check}>
                <td>{x.check}</td>
                <td class={x.pass ? 'ok' : 'bad'}>{x.pass ? (x.expected === 'revert' ? 'reverted ✓' : 'allowed ✓') : 'FAILED'}</td>
                <td>{x.tx && <a href={tx(x.tx)}>tx</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article class="card recorded-run">
        <h3>Last recorded attack and recovery</h3>
        {!p ? (
          <p>Loading the recorded run…</p>
        ) : !p.lastRun ? (
          <p>There’s no recorded run available. The booth demo can record a new one.</p>
        ) : (
          <>
            <p class="muted" style="margin:0">{p.lastRun.network === 'local-fork' ? 'LOCAL FORK' : 'Sepolia'} · {new Date(p.lastRun.at).toUTCString()}</p>
            <p style="margin-top:8px">The hijacked site drained <b class="bad">{p.lastRun.drained}</b> (<a href={tx(p.lastRun.drainTx)}>drain tx</a>).</p>
            <p style="margin-top:8px">The saved kit recovered <b class="ok">{p.lastRun.recovered}</b> while the site and its RPC were down (<a href={tx(p.lastRun.rescueTx)}>exit transaction</a>).</p>
          </>
        )}
      </article>
    </div>
  );
}
