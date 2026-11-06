import { useEffect, useState } from 'preact/hooks';
import type { ExitProgress } from '@copeybara/exec';
import { COPY, FAUCET_URL, WALLET_LINKS } from '../copy';
import { CHAIN_NAMES, EXPLORERS } from '../config';
import type { Humanized } from '../errors';

const focus = (id: string) => {
  const el = document.getElementById(id) as HTMLInputElement | null;
  el?.scrollIntoView({ block: 'center' });
  el?.focus();
};

const kitFileName = () => (typeof location !== 'undefined' ? decodeURIComponent(location.pathname.split('/').pop() || 'copeybara-kit.html') : 'copeybara-kit.html');

/** The one fix that goes with a humanized error. `onRetry` is offered where retrying makes sense. */
export function FixHelp({ h, chainId, onRetry }: { h: Humanized; chainId: number; onRetry?: () => void }) {
  switch (h.fix) {
    case 'faucet':
      return (
        <a class="btn" href={FAUCET_URL} target="_blank" rel="noreferrer noopener" data-fix="faucet">
          {COPY.faucet}
        </a>
      );
    case 'retry':
      return onRetry ? <button onClick={onRetry} data-fix="retry">{COPY.tryAgain}</button> : null;
    case 'switch-chain':
      return onRetry ? (
        <button onClick={onRetry} data-fix="switch-chain">
          {COPY.switchAndRetry(CHAIN_NAMES[chainId] ?? `chain ${chainId}`)}
        </button>
      ) : null;
    case 'add-rpc':
      return (
        <span class="row" style="justify-content:flex-start">
          {onRetry && <button onClick={onRetry} data-fix="retry">{COPY.tryAgain}</button>}
          {/* Always offered: the RPC box (#rpcs) may mount after this card in the same render. */}
          <button class="secondary" onClick={() => focus('rpcs')} data-fix="add-rpc">
            {COPY.addRpc}
          </button>
        </span>
      );
    case 'check-name':
      return (
        <button class="secondary" onClick={() => focus('ens')} data-fix="check-name">
          {COPY.editName}
        </button>
      );
    case 'install-wallet':
      return (
        <span class="row" style="justify-content:flex-start" data-fix="install-wallet">
          {WALLET_LINKS.map((w) => (
            <a class="btn secondary" href={w.href} target="_blank" rel="noreferrer noopener">
              Get {w.name}
            </a>
          ))}
        </span>
      );
    case 'serve-localhost':
      return <pre data-fix="serve-localhost">{COPY.serveCmd(kitFileName())}</pre>;
    default:
      return null;
  }
}

/** Re-render every second while `active`, for elapsed-time counters. */
function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

const ORDER = ['checking', 'simulating', 'wallet', 'confirming', 'balances'] as const;

/** The live line under a position while its exit runs. */
export function ExitStatusLine({ p, chainId }: { p?: ExitProgress; chainId: number }) {
  useTick(true);
  const stage = p?.stage ?? 'checking';
  const secs = p ? Math.max(0, Math.floor((Date.now() - p.at) / 1000)) : 0;
  const n = ORDER.indexOf(stage) + 1;
  return (
    <div class="live" role="status" aria-live="polite" data-stage={stage}>
      <span class="spinner" aria-hidden="true" />
      <div>
        <div>
          <span class="muted">
            {n}/{ORDER.length}
          </span>{' '}
          {COPY.progress[stage]}
          {(stage === 'confirming' || stage === 'wallet') && secs > 0 && <span class="muted"> {secs} s</span>}
          {p && p.calls > 1 && <span class="muted"> (transaction {p.call} of {p.calls})</span>}
        </div>
        {p?.txHash && (
          <div class="mono">
            <a href={`${EXPLORERS[chainId] ?? '#'}${p.txHash}`} target="_blank" rel="noreferrer noopener">
              {p.txHash}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
