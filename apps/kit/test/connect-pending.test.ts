// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest';
import { connect, ConnectCancelled, isRequestPending, type Eip1193 } from '../src/wallet';
import { createFlow, type FlowDeps } from '../src/flow';
import { DEFAULT_SETTINGS } from '../src/settings';
import { COPY } from '../src/copy';

const ACC = '0x1111111111111111111111111111111111111111';
const PENDING = Object.assign(new Error("Request of type 'wallet_requestPermissions' already pending for origin http://localhost:8000. Please wait."), { code: -32002 });

/** A MetaMask-like provider whose connect popup is already open: eth_accounts is empty until the user approves it. */
function pendingWallet(approveAfterPolls: number) {
  let polls = 0;
  const p: Eip1193 & { request: ReturnType<typeof vi.fn> } = {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') throw PENDING;
      if (method === 'eth_accounts') return ++polls > approveAfterPolls ? [ACC] : [];
      if (method === 'eth_chainId') return '0xaa36a7';
      throw new Error(`unexpected ${method}`);
    }),
  } as never;
  return { p, polls: () => polls };
}

describe('connect when the wallet already has a request open (EIP-1193 -32002)', () => {
  test('recognises -32002 by code and by MetaMask’s message', () => {
    expect(isRequestPending(PENDING)).toBe(true);
    expect(isRequestPending({ message: 'Request of type wallet_requestPermissions already pending' })).toBe(true);
    expect(isRequestPending({ code: 4001, message: 'User rejected the request.' })).toBe(false);
  });

  test('does not fail: tells the UI once, polls eth_accounts, continues when an account appears', async () => {
    const { p, polls } = pendingWallet(2);
    const onPending = vi.fn();
    await expect(connect(p, { onPending, pollMs: 1 })).resolves.toEqual({ account: ACC, chainId: 11155111 });
    expect(onPending).toHaveBeenCalledTimes(1);
    expect(polls()).toBe(3);
    const methods = p.request.mock.calls.map((c) => (c[0] as { method: string }).method);
    expect(methods.filter((m) => m === 'eth_requestAccounts')).toHaveLength(1); // never re-requests (that would -32002 again)
    expect(methods.some((m) => /sign/i.test(m))).toBe(false);
  });

  test('polls every second by default', async () => {
    vi.useFakeTimers();
    try {
      const { p, polls } = pendingWallet(1);
      const done = connect(p);
      await vi.advanceTimersByTimeAsync(999);
      expect(polls()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(polls()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(done).resolves.toMatchObject({ account: ACC });
    } finally {
      vi.useRealTimers();
    }
  });

  test('Cancel stops waiting', async () => {
    const { p } = pendingWallet(Infinity);
    const ac = new AbortController();
    const done = connect(p, { pollMs: 5, signal: ac.signal, onPending: () => setTimeout(() => ac.abort(), 12) });
    await expect(done).rejects.toBeInstanceOf(ConnectCancelled);
  });

  test('gives up after the timeout with the original error (humanized as "approve it in your wallet")', async () => {
    const { p } = pendingWallet(Infinity);
    await expect(connect(p, { pollMs: 2, timeoutMs: 15 })).rejects.toBe(PENDING);
  });

  test('other wallet errors still fail straight away', async () => {
    const rejected = Object.assign(new Error('User rejected the request.'), { code: 4001 });
    const p: Eip1193 = { request: async () => { throw rejected; } };
    const onPending = vi.fn();
    await expect(connect(p, { onPending, pollMs: 1 })).rejects.toBe(rejected);
    expect(onPending).not.toHaveBeenCalled();
  });
});

describe('flow: pending connect shows the notice, Cancel returns to the form', () => {
  const base = (connectImpl: FlowDeps['wallet']['connect']): FlowDeps => ({
    quorumFor: () => ({ pinBlock: async () => 10n, status: () => [] }) as never,
    ens: { chainId: 11155111, universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' },
    adapters: [],
    readRecords: async () =>
      ({ name: 'demoswap-blackout.eth', url: null, release: { sha256: 'ab'.repeat(32), version: 3 }, manifest: { v: 1, chains: { '11155111': {} } }, site: null, extension: null, status: { state: 'ok' }, blocklist: [], problems: [], block: 9n, resolver: '0x2222222222222222222222222222222222222222' }) as never,
    wallet: { connect: connectImpl, ensureChain: async () => {}, sender: () => ({ sendTransaction: async () => '0xaa' }) },
    now: () => 1_000,
  });
  const settings = { ...DEFAULT_SETTINGS, ensName: 'demoswap-blackout.eth' };

  test('a pending request → loading with pending: true and the MetaMask notice, then positions once approved', async () => {
    const { p } = pendingWallet(1);
    const f = createFlow(base((opts) => connect(p, { ...opts, pollMs: 1 })));
    const seen: unknown[] = [];
    f.state.subscribe((s) => seen.push(s));
    await f.start(settings);
    expect(seen).toContainEqual({ step: 'loading', what: COPY.connectPending, stage: 2, pending: true });
    expect(COPY.connectPending).toMatch(/MetaMask is already asking you to connect\. Click the MetaMask icon in your browser toolbar and approve it\./);
    expect(f.state.get().step).toBe('positions');
  });

  test('Cancel while waiting → back to the form, no error', async () => {
    const { p } = pendingWallet(Infinity);
    const f = createFlow(base((opts) => connect(p, { ...opts, pollMs: 2 })));
    const run = f.start(settings);
    await vi.waitFor(() => expect(f.state.get()).toMatchObject({ step: 'loading', pending: true }));
    f.cancel();
    await run;
    expect(f.state.get()).toEqual({ step: 'setup' });
  });
});
