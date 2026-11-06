import { useEffect, useMemo, useState } from 'preact/hooks';
import { ADAPTERS } from '@blackout/adapters';
import { createQuorum, type Quorum } from '@blackout/quorum';
import { reportToHtml, reportToJson, type ExitResult } from '@blackout/exec';
import type { Position } from '@blackout/core';
import { createFlow, type FlowState } from './flow';
import { loadSettings, rpcUrlsFor, saveSettings, type Settings } from './settings';
import { connect, discoverWallets, ensureChain, senderFrom, type Eip1193 } from './wallet';
import { CHAIN_NAMES, DEFAULT_RPCS, ENS_CONFIG, EXPLORERS } from './config';
import { COPY } from './copy';
import { CheckScreen } from './screens/Check';
import { ReleaseScreen } from './screens/Release';
import './styles.css';

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useFlowState(flow: ReturnType<typeof createFlow>): FlowState {
  const [s, setS] = useState(flow.state.get());
  useEffect(() => flow.state.subscribe(setS), [flow]);
  return s;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<'exit' | 'check' | 'release'>('exit');
  const [provider, setProvider] = useState<Eip1193 | null>(null);

  const flow = useMemo(() => {
    const cache = new Map<string, Quorum>();
    return createFlow({
      quorumFor: (chainId) => {
        const urls = rpcUrlsFor(loadSettings(), chainId, DEFAULT_RPCS);
        const key = `${chainId}|${urls.join(',')}`;
        if (!cache.has(key)) cache.set(key, createQuorum({ urls, expectedChainId: chainId }));
        return cache.get(key)!;
      },
      ens: ENS_CONFIG,
      adapters: ADAPTERS,
      wallet: {
        connect: async () => {
          let p = provider;
          if (!p) {
            const ws = await discoverWallets();
            if (!ws[0]) throw new Error('No browser wallet found. Open this file on http://localhost with MetaMask or Rabby installed.');
            p = ws[0].provider;
            setProvider(p);
          }
          (window as { __blackoutProvider?: Eip1193 }).__blackoutProvider = p;
          return connect(p);
        },
        ensureChain: (id) => ensureChain((window as { __blackoutProvider?: Eip1193 }).__blackoutProvider!, id),
        sender: (account) => senderFrom((window as { __blackoutProvider?: Eip1193 }).__blackoutProvider!, account),
      },
      now: () => Date.now(),
      // Fire Drill mode (localhost control page only): pull failure timestamps, push the exit report.
      drillFailures: async () => {
        const u = loadSettings().drillUrl;
        return u ? ((await (await fetch(`${u}/failures`)).json()) as { kind: string; at: number }[]) : [];
      },
      onReport: (r) => {
        const u = loadSettings().drillUrl;
        if (u) void fetch(`${u}/kit-report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: reportToJson(r) }).catch(() => {});
      },
    });
  }, []);
  const state = useFlowState(flow);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <main>
      <h1>{COPY.title}</h1>
      <p class="muted">{COPY.tagline}</p>
      <nav aria-label="Mode">
        <button aria-pressed={tab === 'exit'} onClick={() => setTab('exit')}>Exit my positions</button>
        <button aria-pressed={tab === 'check'} onClick={() => setTab('check')}>Check a transaction</button>
        <button aria-pressed={tab === 'release'} onClick={() => setTab('release')}>Release &amp; exits</button>
      </nav>
      {tab === 'release' ? (
        <ReleaseScreen settings={settings} update={update} quorumFor={(id) => createQuorum({ urls: rpcUrlsFor(settings, id, DEFAULT_RPCS), expectedChainId: id })} />
      ) : tab === 'check' ? (
        <CheckScreen settings={settings} quorumFor={(id) => createQuorum({ urls: rpcUrlsFor(settings, id, DEFAULT_RPCS), expectedChainId: id })} />
      ) : (
        <ExitTab state={state} settings={settings} update={update} flow={flow} />
      )}
      <p class="muted" style="font-size:13px;margin-top:32px">{COPY.trusted} No BLACKOUT server, no analytics.</p>
    </main>
  );
}

function ExitTab(props: { state: FlowState; settings: Settings; update(p: Partial<Settings>): void; flow: ReturnType<typeof createFlow> }) {
  const { state, settings, update, flow } = props;
  if (state.step === 'loading') return <div class="card" role="status">{state.what}</div>;
  if (state.step === 'positions') return <Positions state={state} flow={flow} />;
  return (
    <>
      {state.step === 'error' && (
        <div class="card error" role="alert">
          <b class="bad">Stopped.</b> {state.message}
        </div>
      )}
      <Setup settings={settings} update={update} onStart={() => flow.start(settings)} />
    </>
  );
}

function Setup(props: { settings: Settings; update(p: Partial<Settings>): void; onStart(): void }) {
  const { settings, update } = props;
  const cid = String(settings.targetChainId);
  return (
    <div class="card">
      <h2>1. Which protocol?</h2>
      <label for="ens">
        ENS name <span class="hint">({COPY.nameHint})</span>
      </label>
      <input id="ens" placeholder="protocol.eth" value={settings.ensName} onInput={(e) => update({ ensName: (e.target as HTMLInputElement).value })} />
      <label for="chain">Network your position is on</label>
      <select id="chain" value={cid} onChange={(e) => update({ targetChainId: Number((e.target as HTMLSelectElement).value) })}>
        {Object.entries(CHAIN_NAMES).map(([id, n]) => (
          <option value={id}>{n}</option>
        ))}
      </select>
      <label for="rpcs">
        Your own RPC endpoints <span class="hint">(optional, one per line; used first, checked against public providers)</span>
      </label>
      <textarea
        id="rpcs"
        value={(settings.userRpcs[cid] ?? []).join('\n')}
        onInput={(e) => update({ userRpcs: { ...settings.userRpcs, [cid]: (e.target as HTMLTextAreaElement).value.split(/\s+/).filter(Boolean) } })}
      />
      <label style="font-weight:400;display:flex;gap:8px;align-items:center">
        <input type="checkbox" style="width:auto" checked={settings.useDefaultRpcs} onChange={(e) => update({ useDefaultRpcs: (e.target as HTMLInputElement).checked })} />
        Also check answers against public RPC providers (recommended)
      </label>
      <div style="margin-top:16px">
        <button onClick={props.onStart}>Connect wallet and find my positions</button>
      </div>
    </div>
  );
}

function Positions({ state, flow }: { state: Extract<FlowState, { step: 'positions' }>; flow: ReturnType<typeof createFlow> }) {
  const { records } = state;
  const anyResult = Object.keys(state.results).length > 0;
  return (
    <>
      {state.rollbackWarning && <div class="card banner warn" role="alert">{COPY.rollback}</div>}
      <div class="card">
        <h2>{records.name}</h2>
        <p class="muted">
          Release v{records.release.version} · read at block {records.block.toString()} · wallet <span class="mono">{state.account}</span>
        </p>
        <details>
          <summary>{COPY.verifyTitle}</summary>
          <p style="margin-top:8px">{COPY.verifyBody}</p>
          <pre>{`sha256sum blackout-kit.html\n# must equal: ${records.release.sha256}\n\nscripts/verify-kit.sh blackout-kit.html ${records.name}`}</pre>
        </details>
      </div>
      <div class="card">
        <div class="row">
          <h2 style="margin:0">2. Your positions on {CHAIN_NAMES[state.chainId] ?? `chain ${state.chainId}`}</h2>
          {state.positions.some((p) => !p.manual) && (
            <button class="secondary" disabled={!!state.busy} onClick={() => flow.exitAll()}>
              {COPY.exitAll}
            </button>
          )}
        </div>
        {state.positions.length === 0 && <p class="muted" style="margin-top:12px">{COPY.noPositions}</p>}
        {state.positions.map((p) => (
          <PositionRow p={p} result={state.results[p.id]} busy={state.busy} chainId={state.chainId} onExit={() => flow.exit(p.id)} />
        ))}
      </div>
      {anyResult && (
        <div class="card row">
          <button class="secondary" onClick={() => download('blackout-exit-report.json', reportToJson(flow.report()), 'application/json')}>
            {COPY.downloadJson}
          </button>
          <button class="secondary" onClick={() => download('blackout-exit-report.html', reportToHtml(flow.report()), 'text/html')}>
            {COPY.downloadHtml}
          </button>
        </div>
      )}
    </>
  );
}

function PositionRow(props: { p: Position; result?: ExitResult; busy: string | null; chainId: number; onExit(): void }) {
  const { p, result } = props;
  const label = result
    ? { recovered: <b class="ok">{COPY.recovered}</b>, 'not-recovered': <b class="bad">{COPY.notRecovered}</b>, rejected: <b class="bad">{COPY.blocked}</b> }[result.status]
    : null;
  return (
    <div style="border-top:1px solid var(--line);padding:12px 0" data-position={p.id}>
      <div class="row">
        <div>
          <b>{p.label}</b>
          {p.manual && (
            <div class="warn" style="font-size:13px">
              {COPY.manual}: {p.manual}
            </div>
          )}
        </div>
        {!p.manual && result?.status !== 'recovered' && (
          <button disabled={!!props.busy} onClick={props.onExit}>
            {props.busy === p.id ? COPY.exiting : COPY.exit}
          </button>
        )}
      </div>
      {result && (
        <div style="margin-top:6px" data-status={result.status}>
          {label}
          {result.txHashes.map((h) => (
            <div class="mono">
              <a href={`${EXPLORERS[props.chainId] ?? '#'}${h}`} target="_blank" rel="noreferrer noopener">
                {h}
              </a>
            </div>
          ))}
          {result.reasons.length > 0 && (
            <ul class="reasons">
              {result.reasons.map((r) => (
                <li>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
