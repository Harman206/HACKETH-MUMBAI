import { useEffect, useState } from 'preact/hooks';
import { createQuorum } from '@blackout/quorum';
import { readBlackoutRecords } from '@blackout/ens';
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
      readRecords: () => readBlackoutRecords(ENS_NAME, q, { universalResolver: networks.ens.universalResolver as `0x${string}` }),
      fetchRun: async () => {
        const r = await fetch('demo-runs/latest.json');
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as DemoRun;
      },
    }).then((x) => {
      setP(x);
      if (x.release) onLive(`Live on Sepolia · ${ENS_NAME} · release v${x.release.version}`);
    });
  }, []);

  return (
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <article class="card" aria-live="polite">
        <h3>Read live from ENS, right now</h3>
        {!p && <p>Asking 3 independent Sepolia providers…</p>}
        {p?.error && <p class="bad">Could not read: {p.error}</p>}
        {p?.release && (
          <>
            <p><b>{ENS_NAME}</b> · release <b>v{p.release.version}</b> · block {p.block}</p>
            <p style="margin-top:8px">Official kit fingerprint (sha256):</p>
            <p class="mono">{p.release.sha256}</p>
            <p style="margin-top:8px">Published exit contracts:</p>
            <ul>{p.exits.map((e) => <li>{e}</li>)}</ul>
            <p class="muted" style="font-size:14px">Owned by the 2-of-3 <a href={addr(SAFE)}>release Safe</a> via its <a href={addr(RESOLVER)}>Permissioned Resolver</a>.</p>
          </>
        )}
      </article>
      <article class="card">
        <h3>A stolen website key tried to take over, on chain</h3>
        <table class="perm">
          <tbody>
            {(p?.permissions ?? []).map((x) => (
              <tr>
                <td>{x.check}</td>
                <td class={x.pass ? 'ok' : 'bad'}>{x.pass ? (x.expected === 'revert' ? 'reverted ✓' : 'allowed ✓') : 'FAILED'}</td>
                <td>{x.tx && <a href={tx(x.tx)}>tx</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article class="card">
        <h3>Last live attack replication</h3>
        {!p?.lastRun ? (
          <p>No live run recorded yet. Run the booth demo to record one.</p>
        ) : (
          <>
            <p class="muted" style="margin:0">{p.lastRun.network === 'local-fork' ? 'LOCAL FORK' : 'Sepolia'} · {new Date(p.lastRun.at).toUTCString()}</p>
            <p style="margin-top:8px">Without BLACKOUT, the hijacked site drained <b class="bad">{p.lastRun.drained}</b> (<a href={tx(p.lastRun.drainTx)}>drain tx</a>).</p>
            <p style="margin-top:8px">With BLACKOUT, with the website and RPC down, the kit recovered <b class="ok">{p.lastRun.recovered}</b> (<a href={tx(p.lastRun.rescueTx)}>exit tx</a>).</p>
          </>
        )}
      </article>
    </div>
  );
}
