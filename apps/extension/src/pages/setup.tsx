import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState } from '../shared/types';
import { getState, ICON, openPage, send, short } from './api';
import { ProtocolCard } from './components';

const STEPS = ['Welcome', 'Wallet', 'Protocols', 'Connections', 'Done'] as const;
const SUGGESTED = 'demoswap-blackout.eth';

declare const chrome: { tabs: { create(p: { url: string }): Promise<unknown> } };

function Steps({ n }: { n: number }) {
  return (
    <>
      <div class="steps" aria-hidden="true">{STEPS.map((_, i) => <span class={i <= n ? 'on' : ''} />)}</div>
      <p class="muted small" data-step={STEPS[n]}>Step {n + 1} of {STEPS.length}: {STEPS[n]}</p>
    </>
  );
}

function Setup() {
  const [n, setN] = useState(0);
  const [st, setSt] = useState<PublicState | null>(null);
  const [addr, setAddr] = useState('');
  const [name, setName] = useState(SUGGESTED);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rpc, setRpc] = useState('');
  const [tests, setTests] = useState<Record<string, string>>({});

  const refresh = async () => setSt(await getState());
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 1500); // the kit hands the address over in another tab
    return () => clearInterval(t);
  }, []);
  if (!st) return <div class="wrap muted">Loading…</div>;

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      const r = (await f()) as { error?: string } | undefined;
      if (r && typeof r === 'object' && 'error' in r && r.error) setErr(r.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const rpcs = [...(st.settings.useDefaultRpcs ? ['(default) publicnode', '(default) Tenderly', '(default) ethPandaOps'] : []), ...st.settings.userRpcs];

  return (
    <div class="wrap">
      <div class="brand"><img src={ICON} alt="" />Copeybara setup</div>
      <Steps n={n} />

      {n === 0 && (
        <div class="card">
          <h1>Your way out, even when the website is gone.</h1>
          <ul>
            <li><b>Checks every protocol site you open</b> against the fingerprint its team published on ENS. A hijacked site is stopped before it can ask you for anything.</li>
            <li><b>Reads every wallet request</b> before your wallet does, and stops the drainer patterns: unlimited approvals, permits and transfers to strangers.</li>
            <li><b>Gets you out</b> when a site is down or hijacked: one click opens the verified exit kit, which talks to the protocol’s contracts directly.</li>
          </ul>
          <p class="muted small">Copeybara never holds keys and never signs. It sends nothing anywhere except blockchain reads to the RPCs you choose.</p>
          <button onClick={() => setN(1)}>Start</button>
        </div>
      )}

      {n === 1 && (
        <div class="card">
          <h2>Which wallet should Copeybara watch?</h2>
          <p class="muted small">Copeybara only reads your address to find your positions. Signing stays in your wallet.</p>
          {st.settings.account && (
            <p class="alert ok small" data-account={st.settings.account}>Watching <span class="mono">{st.settings.account}</span></p>
          )}
          {st.pendingAddress && (
            <div class="alert warn small" data-pending={st.pendingAddress.address}>
              <p>The exit kit at {st.pendingAddress.origin} sent this address. Is it the one in your wallet?</p>
              <p class="mono">{st.pendingAddress.address}</p>
              <div class="row">
                <button disabled={busy} onClick={() => act(() => send({ t: 'acceptAddress' }))}>Yes, use it</button>
                <button class="secondary" disabled={busy} onClick={() => act(() => send({ t: 'rejectAddress' }))}>No</button>
              </div>
            </div>
          )}
          <h3>Option A: connect your wallet</h3>
          <p class="small">Opens the Copeybara exit kit in a tab, where your wallet works. Connect there, then press “Use this wallet in Copeybara”.</p>
          <button class="secondary" onClick={() => chrome.tabs.create({ url: `${st.settings.kitUrl}#connect=copeybara` })}>Open the kit to connect</button>
          <h3>Option B: paste your address</h3>
          <div class="row">
            <input id="address" placeholder="0x…" value={addr} onInput={(e) => setAddr((e.target as HTMLInputElement).value.trim())} style="flex:1;min-width:220px" />
            <button disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(addr)} onClick={() => act(() => send({ t: 'settings', patch: { account: addr as `0x${string}` } }))}>Use this address</button>
          </div>
          {err && <p class="small" style="color:var(--bad)">{err}</p>}
          <div class="row" style="margin-top:16px">
            <button onClick={() => setN(2)} disabled={!st.settings.account}>Next</button>
            <button class="secondary" onClick={() => setN(2)}>Skip for now</button>
          </div>
        </div>
      )}

      {n === 2 && (
        <>
          <div class="card">
            <h2>Follow the protocols you use</h2>
            <p class="muted small">Enter the protocol’s ENS name (from its docs). Copeybara reads its records: the exit contracts, the exit kit fingerprint and the site fingerprint.</p>
            <div class="row">
              <input id="ens" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="protocol.eth" style="flex:1;min-width:220px" />
              <button id="follow" disabled={busy || !name.trim()} onClick={() => act(() => send({ t: 'follow', name }))}>{busy ? 'Reading ENS…' : 'Follow'}</button>
            </div>
            {err && <p class="small" style="color:var(--bad)">{err}</p>}
          </div>
          {st.protocols.map((p) => <ProtocolCard p={p} />)}
          <div class="row">
            <button class="secondary" onClick={() => setN(1)}>Back</button>
            <button onClick={() => setN(3)} disabled={st.protocols.length === 0 || !st.protocols.some((p) => p.snapshot)}>Next</button>
          </div>
        </>
      )}

      {n === 3 && (
        <div class="card">
          <h2>Connections</h2>
          <p class="muted small">Every ENS read goes to several independent RPC providers at the same block; at least 2 must answer and agree, or Copeybara says it cannot verify. Add your own node if you have one.</p>
          <ul class="clean small">
            {rpcs.map((u) => (
              <li class="spread">
                <span class="mono">{u}</span>
                {!u.startsWith('(default)') && (
                  <span class="row">
                    <span data-rpc-test={u}>{tests[u] ?? ''}</span>
                    <button class="secondary small" onClick={async () => {
                      const r = await send<{ ok: boolean; chainId?: number; ms?: number; error?: string }>({ t: 'testRpc', url: u });
                      setTests({ ...tests, [u]: r.ok ? `✓ Sepolia, ${r.ms} ms` : `✗ ${r.error ?? `chain ${r.chainId}`}` });
                    }}>Test</button>
                    <button class="secondary small" onClick={() => act(() => send({ t: 'settings', patch: { userRpcs: st.settings.userRpcs.filter((x) => x !== u) } }))}>Remove</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div class="row">
            <input id="rpc" placeholder="https://your-sepolia-node.example" value={rpc} onInput={(e) => setRpc((e.target as HTMLInputElement).value.trim())} style="flex:1;min-width:220px" />
            <button class="secondary" disabled={!/^https?:\/\//.test(rpc)} onClick={() => act(async () => { await send({ t: 'settings', patch: { userRpcs: [...st.settings.userRpcs, rpc] } }); setRpc(''); })}>Add RPC</button>
          </div>
          <label class="check small">
            <input type="checkbox" checked={st.settings.useDefaultRpcs} onChange={(e) => act(() => send({ t: 'settings', patch: { useDefaultRpcs: (e.target as HTMLInputElement).checked } }))} />
            Use the 3 default public RPCs
          </label>
          <h3>Exit kit location</h3>
          <p class="muted small">Before opening it, Copeybara checks the downloaded kit against each protocol’s release record. Any copy works if its fingerprint matches.</p>
          <p class="mono">{st.settings.kitUrl}</p>
          {err && <p class="small" style="color:var(--bad)">{err}</p>}
          <div class="row" style="margin-top:12px">
            <button class="secondary" onClick={() => setN(2)}>Back</button>
            <button onClick={() => setN(4)}>Next</button>
          </div>
        </div>
      )}

      {n === 4 && (
        <div class="card">
          <h1>You’re protected.</h1>
          <ul>
            <li>Following <b>{st.protocols.map((p) => p.name).join(', ') || 'no protocols yet'}</b>.</li>
            <li>Watching <b>{st.settings.account ? short(st.settings.account) : 'no wallet yet'}</b>.</li>
            <li>Look for the Copeybara badge on a protocol’s site: <span class="pill ok">✓</span> verified, <span class="pill bad">!</span> stopped.</li>
          </ul>
          <button id="finish" onClick={async () => { await send({ t: 'settings', patch: { setupDone: true } }); await openPage('dashboard'); window.close(); }}>Open my dashboard</button>
        </div>
      )}
    </div>
  );
}

if (document.body.classList.contains('page-setup')) render(<Setup />, document.getElementById('app')!);
