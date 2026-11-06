import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './ui.css';
import type { PublicState } from '../shared/types';
import { getState, openPage, send, short } from './api';
import { Chip, GuardChip, ProtocolCard, StatusMark, TopBar } from './components';
import { Icon, type IconName } from './icons';

const STEPS = ['Welcome', 'Wallet', 'Protocols', 'Connections', 'Done'] as const;
const SUGGESTED = 'demoswap-blackout.eth';

declare const chrome: { tabs: { create(p: { url: string }): Promise<unknown> } };

const HELP: Record<(typeof STEPS)[number], string> = {
  Welcome: 'What Copeybara does for you',
  Wallet: 'The address to watch. No keys, no signing.',
  Protocols: 'The protocols whose ENS records you trust',
  Connections: 'Where Copeybara reads the blockchain from',
  Done: 'You are set',
};

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
      <p class="muted small" style="margin:0 0 4px">{HELP[STEPS[n]!]}</p>
    </>
  );
}

function Feature({ icon, title, children }: { icon: IconName; title: string; children: string }) {
  return (
    <li>
      <span class="feature-icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <p><b>{title}</b> {children}</p>
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
        <div class="card step-card">
          <h1>Your way out, even when the website is gone.</h1>
          <ul class="feature">
            <Feature icon="shield-check" title="Checks every protocol site you open">
              against the fingerprint its team published on ENS. A hijacked site is stopped before it can ask you for anything.
            </Feature>
            <Feature icon="eye" title="Reads every wallet request">
              before your wallet does, and stops the drainer patterns: unlimited approvals, permits and transfers to strangers.
            </Feature>
            <Feature icon="log-out" title="Gets you out">
              when a site is down or hijacked: one click opens the verified exit kit, which talks to the protocol’s contracts directly.
            </Feature>
          </ul>
          <p class="foot-note"><Icon name="lock" size={14} />Copeybara never holds keys and never signs. It sends nothing anywhere except blockchain reads to the RPCs you choose.</p>
          <div class="actions">
            <span />
            <button onClick={() => setN(1)}>Start<Icon name="arrow-right" size={16} /></button>
          </div>
        </div>
      )}

      {n === 1 && (
        <div class="card step-card">
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
          <div class="card step-card">
            <h2>Follow the protocols you use</h2>
            <p class="muted small">Enter the protocol’s ENS name (from its docs). Copeybara reads its records: the exit contracts, the exit kit fingerprint and the site fingerprint.</p>
            <div class="row" style="margin-top:14px">
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
        <div class="card step-card">
          <h2>Connections</h2>
          <p class="muted small">Every ENS read goes to several independent RPC providers at the same block; at least 2 must answer and agree, or Copeybara says it cannot verify. Add your own node if you have one.</p>
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
            <h3><Icon name="external" size={15} />Exit kit location</h3>
            <p class="muted small">Before opening it, Copeybara checks the downloaded kit against each protocol’s release record. Any copy works if its fingerprint matches.</p>
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
        <div class="card step-card done-hero">
          <StatusMark tone="ok" size={34} />
          <h1>You’re protected.</h1>
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
          <button id="finish" onClick={async () => { await send({ t: 'settings', patch: { setupDone: true } }); await openPage('dashboard'); window.close(); }}>
            <Icon name="grid" size={16} />Open my dashboard
          </button>
        </div>
      )}
    </div>
  );
}

if (document.body.classList.contains('page-setup')) render(<Setup />, document.getElementById('app')!);
