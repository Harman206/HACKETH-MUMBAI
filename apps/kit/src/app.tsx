import { useEffect, useMemo, useState } from 'preact/hooks';
import { ADAPTERS } from '@copeybara/adapters';
import { createQuorum, type Quorum } from '@copeybara/quorum';
import { reportToHtml, reportToJson, type ExitResult } from '@copeybara/exec';
import type { Position } from '@copeybara/core';
import { createFlow, stepOf, type FlowState } from './flow';
import { Stepper } from './screens/Stepper';
import { loadSettings, mergeUrlSettings, rpcUrlsFor, saveSettings, settingsFromUrl, type Settings } from './settings';
import { connect, discoverWallets, ensureChain, senderFrom, type Eip1193 } from './wallet';
import { CHAIN_NAMES, DEFAULT_RPCS, ENS_CONFIG, EXPLORERS } from './config';
import { COPY, FAUCET_URL } from './copy';
import { humanize } from './errors';
import { ExitStatusLine, FixHelp } from './screens/Help';
import type { ExitProgress } from '@copeybara/exec';
import { formatAmount, type TokenMeta } from './tokens';
import { CheckScreen } from './screens/Check';
import { ReleaseScreen } from './screens/Release';
import { BrandMark, IconAlert, IconCheckCircle, IconChevron, IconDownload, IconExit, IconExternal, IconFingerprint, IconInfo, IconLayers, IconLock, IconSearch, IconShield, IconStop, IconWallet } from './screens/Icons';
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

const envFor = (chainId: number) => ({ protocol: typeof location !== 'undefined' ? location.protocol : undefined, chainId });

const copeybaraConnect = typeof location !== 'undefined' && /(^|[#&])connect=copeybara(&|$)/.test(location.hash.slice(1));

/**
 * Opened by the Copeybara extension's setup (#connect=copeybara): connect a wallet here, where wallets work, and hand
 * the address (only the address) to the extension. The extension asks the user to confirm it before using it.
 */
function CopeybaraHandoff() {
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<AbortController | null>(null);
  const go = async () => {
    setErr(null);
    const ac = new AbortController();
    try {
      const ws = await discoverWallets();
      if (!ws[0]) throw new Error('No browser wallet found. Install MetaMask or Rabby, then reload this page.');
      const { account } = await connect(ws[0].provider, { signal: ac.signal, onPending: () => setPending(ac) });
      window.postMessage({ tag: 'copeybara:kit-address', address: account }, location.origin === 'null' ? '*' : location.origin);
      setSent(account);
    } catch (e) {
      if (!ac.signal.aborted) setErr((e as Error).message);
    } finally {
      setPending(null);
    }
  };
  return (
    <div class="card handoff" data-copeybara-handoff>
      <div class="card-head">
        <span class="badge-icon"><IconWallet /></span>
        <div>
          <div class="label">Extension setup</div>
          <h2>Connect your wallet to Copeybara</h2>
        </div>
      </div>
      {sent ? (
        <p class="notice ok-notice"><IconCheckCircle /> <span>Sent <span class="mono">{sent}</span> to the Copeybara extension. Go back to its setup tab and confirm it.</span></p>
      ) : pending ? (
        <PendingNotice onCancel={() => pending.abort()} />
      ) : (
        <>
          <p class="muted">Copeybara only receives your address, to find your positions. It never signs.</p>
          <button class="primary lg" onClick={go}><IconWallet /> <span>Use this wallet in Copeybara</span></button>
        </>
      )}
      {err && <p class="bad" role="alert">{humanize(err, envFor(11155111)).text}</p>}
    </div>
  );
}

/** The wallet already has a connect request open (-32002): say where it is, keep waiting, offer Cancel. */
function PendingNotice({ onCancel }: { onCancel(): void }) {
  return (
    <div class="notice pending" role="status" aria-live="polite" data-connect-pending>
      <span class="spinner" aria-hidden="true" />
      <div class="notice-body">
        <b>{COPY.connectPending}</b>
        <span class="muted">{COPY.connectPendingWait}</span>
      </div>
      <button class="ghost" onClick={onCancel}>
        {COPY.cancel}
      </button>
    </div>
  );
}

export function App() {
  const [boot] = useState(() => mergeUrlSettings(loadSettings(), typeof location !== 'undefined' ? settingsFromUrl(location.href) : {}));
  const [settings, setSettings] = useState<Settings>(() => {
    saveSettings(boot.persist); // never persist a protocol name that came from a link
    return boot.settings;
  });
  const [ensFromLink, setEnsFromLink] = useState<string | null>(boot.ensFromLink);
  const [tab, setTab] = useState<'exit' | 'check' | 'release'>(() => (typeof location !== 'undefined' && new URL(location.href).searchParams.has('check') ? 'check' : 'exit'));
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
        connect: async (opts) => {
          let p = provider;
          if (!p) {
            const ws = await discoverWallets();
            if (!ws[0]) throw new Error('No browser wallet found. Open this file on http://localhost with MetaMask or Rabby installed.');
            p = ws[0].provider;
            setProvider(p);
          }
          (window as { __copeybaraProvider?: Eip1193 }).__copeybaraProvider = p;
          return connect(p, opts);
        },
        ensureChain: (id) => ensureChain((window as { __copeybaraProvider?: Eip1193 }).__copeybaraProvider!, id),
        sender: (account) => senderFrom((window as { __copeybaraProvider?: Eip1193 }).__copeybaraProvider!, account),
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
    if (patch.ensName !== undefined) setEnsFromLink(null); // the user typed it themselves
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const chainLabel = settings.targetChainId === 11155111 ? 'Sepolia testnet' : (CHAIN_NAMES[settings.targetChainId] ?? `Chain ${settings.targetChainId}`);
  return (
    <>
      <header class="topbar">
        <div class="topbar-in">
          <span class="brand">
            <BrandMark size={30} />
            <span class="wordmark">Copeybara</span>
            <span class="brand-sub">Exit kit</span>
          </span>
          <span class="chip net" title="The network your positions are read from">
            <span class="dot" aria-hidden="true" /> {chainLabel}
          </span>
        </div>
      </header>
      <main>
        <section class="hero">
          <div class="label">Emergency withdrawal</div>
          <h1>{COPY.title}</h1>
          <p class="lede">{COPY.tagline}</p>
        </section>
        {ensFromLink && settings.ensName === ensFromLink && (
          <div class="notice warn-notice" role="alert" data-ens-from-link>
            <IconAlert />
            <span>
              The protocol name <b>{ensFromLink}</b> was filled in from the link you opened. Before you continue, confirm it matches the name in the protocol’s official docs. Links can be faked.
            </span>
          </div>
        )}
        {copeybaraConnect && <CopeybaraHandoff />}
        <nav class="tabs" aria-label="Mode">
          <button aria-pressed={tab === 'exit'} onClick={() => setTab('exit')}>
            <IconExit size={16} /> <span>Exit my positions</span>
          </button>
          <button aria-pressed={tab === 'check'} onClick={() => setTab('check')}>
            <IconSearch size={16} /> <span>Check a transaction</span>
          </button>
          <button aria-pressed={tab === 'release'} onClick={() => setTab('release')}>
            <IconFingerprint size={16} /> <span>Release &amp; exits</span>
          </button>
        </nav>
        {tab === 'release' ? (
          <ReleaseScreen settings={settings} update={update} quorumFor={(id) => createQuorum({ urls: rpcUrlsFor(settings, id, DEFAULT_RPCS), expectedChainId: id })} />
        ) : tab === 'check' ? (
          <CheckScreen settings={settings} quorumFor={(id) => createQuorum({ urls: rpcUrlsFor(settings, id, DEFAULT_RPCS), expectedChainId: id })} />
        ) : (
          <ExitTab state={state} settings={settings} update={update} flow={flow} />
        )}
        <footer class="foot">
          <IconShield size={16} />
          <span>{COPY.trusted} No Copeybara server, no analytics.</span>
        </footer>
      </main>
    </>
  );
}

function ExitTab(props: { state: FlowState; settings: Settings; update(p: Partial<Settings>): void; flow: ReturnType<typeof createFlow> }) {
  const { state, settings, update, flow } = props;
  const stepper = <Stepper current={stepOf(state)} facts={state.step === 'positions' ? state.facts : undefined} />;
  if (state.step === 'loading')
    return (
      <>
        {stepper}
        {state.pending ? (
          <div class="card">
            <PendingNotice onCancel={() => flow.cancel()} />
          </div>
        ) : (
          <div class="card big-status" role="status">
            <span class="spinner" aria-hidden="true" />
            <span class="grow">{state.what}</span>
            {state.stage === 2 && (
              <button class="ghost" onClick={() => flow.cancel()}>
                {COPY.cancel}
              </button>
            )}
          </div>
        )}
      </>
    );
  if (state.step === 'positions')
    return (
      <>
        {stepper}
        <Positions state={state} flow={flow} />
      </>
    );
  return (
    <>
      {stepper}
      {state.step === 'error' && <StoppedCard message={state.message} chainId={settings.targetChainId} onRetry={() => flow.start(settings)} />}
      <Setup settings={settings} update={update} onStart={() => flow.start(settings)} walletHint={state.step !== 'error'} />
    </>
  );
}

function StoppedCard({ message, chainId, onRetry }: { message: string; chainId: number; onRetry(): void }) {
  const h = humanize(message, envFor(chainId));
  return (
    <div class="card alert bad-alert" role="alert" data-error>
      <span class="alert-icon"><IconStop /></span>
      <div class="alert-body">
        <div>
          <b class="bad">Stopped.</b> {h.text}
        </div>
        {h.text !== message && (
          <details class="tech">
            <summary>Technical detail</summary>
            <pre>{message}</pre>
          </details>
        )}
        {h.fix && (
          <div class="actions">
            <FixHelp h={h} chainId={chainId} onRetry={onRetry} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Before connecting: say early if no wallet is visible, and why (file:// pages get no wallet). */
function NoWalletHint({ chainId }: { chainId: number }) {
  const [none, setNone] = useState(false);
  useEffect(() => {
    let live = true;
    void discoverWallets(600).then((ws) => live && setNone(ws.length === 0));
    return () => {
      live = false;
    };
  }, []);
  if (!none) return null;
  const h = humanize('No browser wallet found', envFor(chainId));
  return (
    <div class="card alert warn-alert" role="status" data-no-wallet>
      <span class="alert-icon"><IconWallet /></span>
      <div class="alert-body">
        <div>
          <b>{COPY.noWallet}</b> {h.text}
        </div>
        <div class="actions">
          <FixHelp h={h} chainId={chainId} />
        </div>
      </div>
    </div>
  );
}

function HowItWorks({ network }: { network: string }) {
  return (
    <ol class="how" aria-label="How this works">
      {COPY.how(network).map((h, i) => (
        <li>
          <span class="how-n">{i + 1}</span>
          <span>
            <b>{h.title}</b>
            <span class="muted">{h.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const CHECK_ICONS = [IconFingerprint, IconLayers, IconShield];

function Checks() {
  return (
    <section class="checks" aria-label={COPY.checksTitle}>
      <div class="label">{COPY.checksTitle}</div>
      <ul>
        {COPY.checks.map((c, i) => {
          const I = CHECK_ICONS[i]!;
          return (
            <li>
              <span class="check-icon"><I size={16} /></span>
              <span>
                <b>{c.title}.</b> <span class="muted">{c.body}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Setup(props: { settings: Settings; update(p: Partial<Settings>): void; onStart(): void; walletHint: boolean }) {
  const { settings, update } = props;
  const cid = String(settings.targetChainId);
  const ownRpcs = settings.userRpcs[cid] ?? [];
  return (
    <>
      {props.walletHint && <NoWalletHint chainId={settings.targetChainId} />}
      <section class="how-wrap">
        <div class="label">How this works</div>
        <HowItWorks network={CHAIN_NAMES[settings.targetChainId] ?? `chain ${settings.targetChainId}`} />
        <Checks />
      </section>
      <div class="card form">
        <div class="field">
          <label for="ens">
            Protocol ENS name <span class="hint">{COPY.nameHint}</span>
          </label>
          <div class="input-icon">
            <IconSearch size={18} />
            <input id="ens" class="lg" placeholder="protocol.eth" autoComplete="off" spellcheck={false} value={settings.ensName} onInput={(e) => update({ ensName: (e.target as HTMLInputElement).value })} />
          </div>
        </div>
        <div class="field">
          <label for="chain">Network your position is on</label>
          <select id="chain" value={cid} onChange={(e) => update({ targetChainId: Number((e.target as HTMLSelectElement).value) })}>
            {Object.entries(CHAIN_NAMES).map(([id, n]) => (
              <option value={id}>{n}</option>
            ))}
          </select>
        </div>
        <details class="advanced" open={ownRpcs.length > 0 || !settings.useDefaultRpcs}>
          <summary>
            <IconChevron size={16} cls="chev" /> Advanced: your own RPC endpoints <span class="hint">(optional)</span>
          </summary>
          <div class="field">
            <label for="rpcs">
              Your own RPC endpoints <span class="hint">One per line. Used first, checked against public providers.</span>
            </label>
            <textarea
              id="rpcs"
              spellcheck={false}
              value={ownRpcs.join('\n')}
              onInput={(e) => update({ userRpcs: { ...settings.userRpcs, [cid]: (e.target as HTMLTextAreaElement).value.split(/\s+/).filter(Boolean) } })}
            />
          </div>
          <label class="check">
            <input type="checkbox" checked={settings.useDefaultRpcs} onChange={(e) => update({ useDefaultRpcs: (e.target as HTMLInputElement).checked })} />
            <span>Also check answers against public RPC providers (recommended)</span>
          </label>
        </details>
        <button class="primary xl cta" onClick={props.onStart}>
          <IconWallet size={20} /> <span>Connect wallet and find my positions</span>
        </button>
        <p class="reassure">
          <IconLock size={14} /> Your wallet only shares your address. Nothing moves until you confirm a withdrawal in your wallet.
        </p>
      </div>
    </>
  );
}

const ADAPTER_NAMES: Record<string, string> = { 'uniswap-v3': 'Uniswap v3', 'uniswap-v4': 'Uniswap v4', 'aave-v3': 'Aave v3', 'curve-3pool': 'Curve 3pool' };
const ADAPTER_SHORT: Record<string, string> = { 'uniswap-v3': 'U3', 'uniswap-v4': 'U4', 'aave-v3': 'AV', 'curve-3pool': 'CV' };

function Positions({ state, flow }: { state: Extract<FlowState, { step: 'positions' }>; flow: ReturnType<typeof createFlow> }) {
  const { records } = state;
  const anyResult = Object.keys(state.results).length > 0;
  const exitable = state.positions.filter((p) => !p.manual);
  const recovered = Object.values(state.results).filter((r) => r.status === 'recovered').length;
  return (
    <>
      {state.rollbackWarning && (
        <div class="notice warn-notice" role="alert">
          <IconAlert /> <span>{COPY.rollback}</span>
        </div>
      )}
      {state.fees?.low && (
        <div class="card alert warn-alert" role="status" data-low-fees>
          <span class="alert-icon"><IconAlert /></span>
          <div class="alert-body">
            <div>{COPY.lowFees(formatAmount(state.fees.balance, 18))}</div>
            {state.chainId === 11155111 && (
              <div class="actions">
                <a class="btn" href={FAUCET_URL} target="_blank" rel="noreferrer noopener">
                  {COPY.faucet} <IconExternal size={14} />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
      <div class="card summary">
        <div class="summary-head">
          <div>
            <div class="label">Protocol</div>
            <h2 class="serif">{records.name}</h2>
          </div>
          <span class="chip ok-chip">
            <IconCheckCircle size={14} /> Verified on ENS
          </span>
        </div>
        <dl class="stats">
          <div>
            <dt>Kit release</dt>
            <dd><span class="chip">Release v{records.release.version}</span></dd>
          </div>
          <div>
            <dt>ENS block</dt>
            <dd class="num">{records.block.toString()}</dd>
          </div>
          <div class="wide">
            <dt>Wallet</dt>
            <dd class="mono">{state.account}</dd>
          </div>
        </dl>
        <details class="tech">
          <summary>{COPY.verifyTitle}</summary>
          <p>{COPY.verifyBody}</p>
          <pre>{`sha256sum copeybara-kit.html\n# must equal: ${records.release.sha256}\n\nscripts/verify-kit.sh copeybara-kit.html ${records.name}`}</pre>
        </details>
      </div>
      <div class="card positions">
        <div class="positions-head">
          <div>
            <div class="label">
              Your positions · {CHAIN_NAMES[state.chainId] ?? `chain ${state.chainId}`}
            </div>
            <h2>
              {state.positions.length === 0 ? 'Nothing to withdraw' : `${exitable.length} position${exitable.length === 1 ? '' : 's'} found`}
              {recovered > 0 && <span class="muted num"> · {recovered} recovered</span>}
            </h2>
          </div>
          {state.positions.some((p) => !p.manual) && (
            <button class="primary lg" disabled={!!state.busy} onClick={() => flow.exitAll()}>
              {state.batch ? COPY.exitingBatch(state.batch.done + 1, state.batch.total) : COPY.exitAll}
            </button>
          )}
        </div>
        {exitable.length > 0 && !anyResult && <p class="muted small">{COPY.exitHelp}</p>}
        {state.discoveryErrors.map((e) => (
          <p class="notice warn-notice" role="alert">
            <IconAlert /> <span>{e}</span>
          </p>
        ))}
        {state.notes.map((n) => (
          <p class="notice info-notice" data-note>
            <IconInfo /> <span>{n}</span>
          </p>
        ))}
        {state.positions.length === 0 && <p class="empty muted">{COPY.noPositions}</p>}
        <div class="plist">
          {state.positions.map((p) => (
            <PositionRow
              p={p}
              result={state.results[p.id]}
              busy={state.busy}
              progress={state.progress[p.id]}
              chainId={state.chainId}
              preview={state.previews[p.id] ?? []}
              meta={state.meta}
              onExit={() => flow.exit(p.id)}
            />
          ))}
        </div>
      </div>
      {state.addable.map((a) => (
        <AddById adapter={a} flow={flow} busy={!!state.busy} />
      ))}
      {anyResult && (
        <div class="card reports">
          <div>
            <div class="label">Receipt</div>
            <p class="muted small">Keep a record of what was withdrawn, with transaction links.</p>
          </div>
          <div class="row-btns">
            <button class="secondary" onClick={() => download('copeybara-exit-report.json', reportToJson(flow.report()), 'application/json')}>
              <IconDownload size={16} /> <span>{COPY.downloadJson}</span>
            </button>
            <button class="secondary" onClick={() => download('copeybara-exit-report.html', reportToHtml(flow.report()), 'text/html')}>
              <IconDownload size={16} /> <span>{COPY.downloadHtml}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** For positions discovery cannot list exhaustively (Uniswap v4 NFTs): the user types the ID, the kit checks ownership. */
function AddById({ adapter, flow, busy }: { adapter: import('@copeybara/core').AdapterId; flow: ReturnType<typeof createFlow>; busy: boolean }) {
  const [id, setId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const name = ADAPTER_NAMES[adapter] ?? adapter;
  const add = async () => {
    setWorking(true);
    setErr(null);
    const e = await flow.addById(adapter, id);
    setWorking(false);
    if (e) setErr(e);
    else setId('');
  };
  return (
    <div class="card addid" data-add-by-id={adapter}>
      <label for={`add-${adapter}`}>
        Missing a {name} position? <span class="hint">Enter its ID; the kit checks it belongs to this wallet.</span>
      </label>
      <div class="inline">
        <input id={`add-${adapter}`} inputMode="numeric" placeholder="e.g. 41448" value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} />
        <button class="secondary" disabled={busy || working || !id.trim()} onClick={add}>
          {working ? 'Checking…' : 'Add'}
        </button>
      </div>
      {err && <p class="warn small" role="status">{err}</p>}
    </div>
  );
}

const STATUS_ICON = { recovered: IconCheckCircle, 'not-recovered': IconStop, rejected: IconStop, unsimulated: IconAlert } as const;

function PositionRow(props: {
  p: Position;
  result?: ExitResult;
  busy: string | null;
  progress?: ExitProgress;
  chainId: number;
  preview: { token: `0x${string}`; amount: bigint }[];
  meta: TokenMeta;
  onExit(): void;
}) {
  const { p, result, meta } = props;
  const fmt = (token: `0x${string}`, amount: bigint) =>
    `${formatAmount(amount, meta[token]?.decimals ?? 18)} ${meta[token]?.symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`}`;
  const text = result ? { recovered: COPY.recovered, 'not-recovered': COPY.notRecovered, rejected: COPY.blocked, unsimulated: COPY.unsimulated }[result.status] : '';
  const tone = result ? { recovered: 'ok', 'not-recovered': 'bad', rejected: 'bad', unsimulated: 'warn' }[result.status] : '';
  const StatusIcon = result ? STATUS_ICON[result.status] : null;
  return (
    <div class={`prow${result?.status === 'recovered' ? ' done' : ''}`} data-position={p.id}>
      <div class="prow-main">
        <span class="token-badge" aria-hidden="true">{ADAPTER_SHORT[p.adapter] ?? p.adapter.slice(0, 2).toUpperCase()}</span>
        <div class="prow-text">
          <div class="prow-title">{p.label}</div>
          {props.preview.length > 0 && !result && (
            <div class="prow-preview">
              <span class="muted">You would receive ≈</span> <span class="num">{props.preview.map((x) => fmt(x.token, x.amount)).join(' + ')}</span>
            </div>
          )}
          {p.manual && (
            <div class="warn small">
              {COPY.manual}: {p.manual}
            </div>
          )}
        </div>
        {!p.manual && result?.status !== 'recovered' && (
          <button class="secondary exit-btn" disabled={!!props.busy} onClick={props.onExit}>
            {props.busy === p.id ? COPY.exiting : COPY.exit}
          </button>
        )}
      </div>
      {props.busy === p.id && <ExitStatusLine p={props.progress} chainId={props.chainId} />}
      {result && props.busy !== p.id && (
        <div data-status={result.status} class={`result result-${result.status}`}>
          <span class={`chip ${tone}-chip`}>
            {StatusIcon && <StatusIcon size={14} />} {text}
          </span>
          {result.deltas.length > 0 && result.status === 'recovered' && (
            <div class="ok delta num">{result.deltas.map((d) => `+${fmt(d.token, d.after - d.before)}`).join('   ')} back in your wallet</div>
          )}
          {result.txHashes.map((h) => (
            <div class="mono txlink">
              <a href={`${EXPLORERS[props.chainId] ?? '#'}${h}`} target="_blank" rel="noreferrer noopener">
                {h}
              </a>
            </div>
          ))}
          {result.reasons.length > 0 && (
            <ul class="reasons">
              {result.reasons.map((r) => {
                const h = humanize(r, envFor(props.chainId));
                return (
                  <li>
                    {h.text}
                    {h.fix === 'faucet' && (
                      <div class="actions">
                        <FixHelp h={h} chainId={props.chainId} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
