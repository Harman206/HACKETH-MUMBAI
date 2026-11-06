import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState } from '../shared/types';
import { getState, openPage, send, short } from './api';
import { CertifiedPicker, Chip, GuardChip, ProtocolCard, TopBar } from './components';
import { CardFan, EnsGraph, Hero, RpcQuorum, ShieldBurst } from './art';
import { Copey, Icon, type IconName } from './icons';

const STEPS = ['Welcome', 'Wallet', 'Protocols', 'Connections', 'Done'] as const;
const SUGGESTED = 'demoswap-blackout.eth';

declare const chrome: { tabs: { create(p: { url: string }): Promise<unknown> } };

function Steps({ n }: { n: number }) {
  return (
    <>
      <ol class="rail" aria-hidden="true">
        {STEPS.map((name, i) => (
          <li class={i < n ? 'done' : i === n ? 'on' : ''}>
            <span class="node">{i < n ? <Icon name="check" size={15} /> : i + 1}</span>
            <span class="rail-name">{name}</span>
          </li>
        ))}
      </ol>
      <p class="label step-meta" data-step={STEPS[n]}>Step {n + 1} of {STEPS.length}: {STEPS[n]}</p>
    </>
  );
}

function Feature({ icon, title, children }: { icon: IconName; title: string; children: string }) {
  return (
    <li>
      <span class="feature-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <b>{title}</b>
      <p>{children}</p>
    </li>
  );
}

function Err({ err }: { err: string | null }) {
  return err ? <p class="err"><Icon name="x-octagon" size={15} />{err}</p> : null;
}

function Setup() {
  const [n, setN] = useState(0);
  const [st, setSt] = useState<PublicState | null>(null);
  const [addr, setAddr] = useState('');
  const [name, setName] = useState(SUGGESTED);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rpc, setRpc] = useState('');
  const [tests, setTests] = useState<Record<string, { ok: boolean; text: string }>>({});

  const refresh = async () => setSt(await getState());
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 1500); // the kit hands the address over in another tab
    return () => clearInterval(t);
  }, []);
  if (!st) return <div class="wrap setup muted" style="padding-top:24px">Loading…</div>;

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
    <div class="wrap setup">
      <TopBar caption="Setup">
        <GuardChip st={st} />
      </TopBar>
      <Steps n={n} />

      {n === 0 && (
        <div class="card step-card stage-card" key="s0">
          <Hero
            class="hero-welcome"
            eyebrow="Copeybara · DeFi safety net"
            title={<>Your way out, <em>even when the website is gone.</em></>}
            art={<div class="fan-stage"><CardFan /><Copey mood="protected" size={118} class="hero-copey" /></div>}
          />
          <ul class="feature-grid">
            <Feature icon="shield-check" title="Verifies every site">Matched against the fingerprint its team put on ENS.</Feature>
            <Feature icon="eye" title="Reads every request">Stops drainer approvals, permits and transfers.</Feature>
            <Feature icon="log-out" title="Gets you out">One click to the verified exit kit, straight to the contracts.</Feature>
          </ul>
          <div class="actions">
            <p class="foot-note" style="margin:0"><Icon name="lock" size={14} />No keys. No signing. Only blockchain reads.</p>
            <button onClick={() => setN(1)}>Start<Icon name="arrow-right" size={16} /></button>
          </div>
        </div>
      )}

      {n === 1 && (
        <div class="card step-card" key="s1">
          <h2>Which wallet should Copeybara watch?</h2>
          <p class="muted small">Copeybara only reads your address to find your positions. Signing stays in your wallet.</p>
          {st.settings.account && (
            <div class="alert ok small with-icon" data-account={st.settings.account}>
              <Icon name="shield-check" size={18} />
              <div>Watching <span class="mono">{st.settings.account}</span></div>
            </div>
          )}
          {st.pendingAddress && (
            <div class="alert warn small with-icon" data-pending={st.pendingAddress.address}>
              <Icon name="help-circle" size={18} />
              <div class="grow">
                <p>The exit kit at {st.pendingAddress.origin} sent this address. Is it the one in your wallet?</p>
                <p class="mono">{st.pendingAddress.address}</p>
                <div class="row" style="margin-top:10px">
                  <button disabled={busy} onClick={() => act(() => send({ t: 'acceptAddress' }))}>Yes, use it</button>
                  <button class="secondary" disabled={busy} onClick={() => act(() => send({ t: 'rejectAddress' }))}>No</button>
                </div>
              </div>
            </div>
          )}
          <div class="option">
            <h3><span class="option-tag">A</span>Connect your wallet</h3>
            <p class="small muted">Opens the Copeybara exit kit in a tab, where your wallet works. Connect there, then press “Use this wallet in Copeybara”.</p>
            <button class="secondary" style="margin-top:8px" onClick={() => chrome.tabs.create({ url: `${st.settings.kitUrl}#connect=copeybara` })}>
              <Icon name="wallet" size={16} />Open the kit to connect
            </button>
          </div>
          <div class="option">
            <h3><span class="option-tag">B</span>Paste your address</h3>
            <div class="row" style="margin-top:8px">
              <input id="address" placeholder="0x…" value={addr} onInput={(e) => setAddr((e.target as HTMLInputElement).value.trim())} style="flex:1;min-width:220px" />
              <button disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(addr)} onClick={() => act(() => send({ t: 'settings', patch: { account: addr as `0x${string}` } }))}>Use this address</button>
            </div>
          </div>
          <Err err={err} />
          <div class="actions">
            <button class="secondary" onClick={() => setN(2)}>Skip for now</button>
            <button onClick={() => setN(2)} disabled={!st.settings.account}>Next<Icon name="arrow-right" size={16} /></button>
          </div>
        </div>
      )}

      {n === 2 && (
        <>
          <div class="card step-card stage-card" key="s2">
            <Hero
              eyebrow="Step 3 · Protocols"
              title={<>Follow the <em>protocols</em> you use.</>}
              sub="Its ENS name holds the exit contracts and fingerprints. Only its 2-of-3 Safe can change them."
              art={<EnsGraph />}
            />
            <CertifiedPicker st={st} busy={busy} onFollow={(x) => act(() => send({ t: 'follow', name: x }))} />
            <h3 class="manual-head">Or type any ENS name</h3>
            <p class="small muted" style="margin-top:0">Copy it from the protocol’s docs, never from a link someone sent you.</p>
            <div class="row" style="margin-top:8px">
              <input id="ens" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="protocol.eth" style="flex:1;min-width:220px" />
              <button id="follow" disabled={busy || !name.trim()} onClick={() => act(() => send({ t: 'follow', name }))}>{busy ? 'Reading ENS…' : 'Follow'}</button>
            </div>
            <Err err={err} />
          </div>
          {st.protocols.map((p) => <ProtocolCard p={p} />)}
          <div class="actions" style="border:0;padding-top:4px">
            <button class="secondary" onClick={() => setN(1)}><Icon name="arrow-left" size={16} />Back</button>
            <button onClick={() => setN(3)} disabled={st.protocols.length === 0 || !st.protocols.some((p) => p.snapshot)}>Next<Icon name="arrow-right" size={16} /></button>
          </div>
        </>
      )}

      {n === 3 && (
        <div class="card step-card stage-card" key="s3">
          <Hero
            eyebrow="Step 4 · Connections"
            title={<>Three paths. <em>One answer.</em></>}
            sub="Every read goes to independent RPCs at one block. Two must agree, or Copeybara says it cannot verify."
            art={<RpcQuorum />}
          />
          <ul class="clean small rpc-list">
            {rpcs.map((u) => (
              <li>
                <span class="mono"><Icon name="server" size={15} />{u}</span>
                {!u.startsWith('(default)') && (
                  <span class="row">
                    <span data-rpc-test={u} class={`test-result ${tests[u]?.ok ? 'ok' : 'bad'}`}>
                      {tests[u] && (
                        <>
                          <Icon name={tests[u]!.ok ? 'check' : 'x'} size={14} />
                          <span class="sr-only">{tests[u]!.ok ? '✓' : '✗'} </span>
                          {tests[u]!.text}
                        </>
                      )}
                    </span>
                    <button class="secondary small" onClick={async () => {
                      const r = await send<{ ok: boolean; chainId?: number; ms?: number; error?: string }>({ t: 'testRpc', url: u });
                      setTests({ ...tests, [u]: r.ok ? { ok: true, text: `Sepolia, ${r.ms} ms` } : { ok: false, text: r.error ?? `chain ${r.chainId}` } });
                    }}>Test</button>
                    <button class="secondary small" onClick={() => act(() => send({ t: 'settings', patch: { userRpcs: st.settings.userRpcs.filter((x) => x !== u) } }))}>Remove</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div class="row" style="margin-top:12px">
            <input id="rpc" placeholder="https://your-sepolia-node.example" value={rpc} onInput={(e) => setRpc((e.target as HTMLInputElement).value.trim())} style="flex:1;min-width:220px" />
            <button class="secondary" disabled={!/^https?:\/\//.test(rpc)} onClick={() => act(async () => { await send({ t: 'settings', patch: { userRpcs: [...st.settings.userRpcs, rpc] } }); setRpc(''); })}>Add RPC</button>
          </div>
          <label class="check small">
            <input type="checkbox" checked={st.settings.useDefaultRpcs} onChange={(e) => act(() => send({ t: 'settings', patch: { useDefaultRpcs: (e.target as HTMLInputElement).checked } }))} />
            Use the 3 default public RPCs
          </label>
          <div class="option">
            <h3><Icon name="external" size={15} />Exit kit</h3>
            <p class="muted small">Checked against each protocol’s release fingerprint before it opens.</p>
            <p class="mono">{st.settings.kitUrl}</p>
          </div>
          <Err err={err} />
          <div class="actions">
            <button class="secondary" onClick={() => setN(2)}><Icon name="arrow-left" size={16} />Back</button>
            <button onClick={() => setN(4)}>Next<Icon name="arrow-right" size={16} /></button>
          </div>
        </div>
      )}

      {n === 4 && (
        <div class="card step-card stage-card" key="s4">
          <Hero
            class="hero-done"
            eyebrow="Setup complete"
            title={<>You’re <em>protected.</em></>}
            sub="Copeybara now checks every protocol site and wallet request in this browser."
            art={<ShieldBurst><Copey mood="protected" size={150} class="hero-copey" /></ShieldBurst>}
          />
          <dl class="kv summary">
            <dt>Following</dt>
            <dd><b>{st.protocols.map((p) => p.name).join(', ') || 'no protocols yet'}</b></dd>
            <dt>Watching</dt>
            <dd><b class="num">{st.settings.account ? short(st.settings.account) : 'no wallet yet'}</b></dd>
            <dt>Badge on a protocol’s site</dt>
            <dd class="row" style="justify-content:flex-end;gap:6px">
              <Chip tone="ok" icon="check">verified</Chip>
              <Chip tone="bad" icon="x-octagon">stopped</Chip>
            </dd>
          </dl>
          <div class="actions">
            <span />
            <button id="finish" onClick={async () => { await send({ t: 'settings', patch: { setupDone: true } }); await openPage('dashboard'); window.close(); }}>
              <Icon name="grid" size={16} />Open my dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

if (document.body.classList.contains('page-setup')) render(<Setup />, document.getElementById('app')!);
