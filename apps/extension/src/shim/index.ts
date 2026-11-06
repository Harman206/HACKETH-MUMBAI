/**
 * MAIN-world shim (runs inside the page, at document_start). It wraps every wallet provider the page can reach
 * (window.ethereum and EIP-6963 announcements) so fund-moving requests are first sent to the extension's worker.
 * It decides nothing and holds no secrets: a hostile page can remove it, which is why the authoritative blocks
 * (warning-page redirects) live in the worker, not here. Unwatched methods pass straight through, unchanged.
 */
export const WATCHED = new Set([
  'eth_sendTransaction',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_sign',
  'wallet_sendCalls',
  // connect requests: the worker lets them through at once, except on a site imitating a followed protocol, where the
  // user is warned before the wallet's own connect popup appears
  'eth_requestAccounts',
  'wallet_requestPermissions',
]);

import { TAG_REQ, TAG_RES } from '../shared/tags';
export { TAG_REQ, TAG_RES };
const ANSWER_TIMEOUT_MS = 200_000;

type Req = { method: string; params?: unknown };
type Provider = {
  request?: (a: Req) => Promise<unknown>;
  send?: (...a: unknown[]) => unknown;
  sendAsync?: (p: { method: string; params?: unknown; id?: unknown; jsonrpc?: string }, cb: (e: unknown, r?: unknown) => void) => void;
};

export function installShim(win: Window & typeof globalThis) {
  const marker = '__copeybaraShim';
  if ((win as unknown as Record<string, unknown>)[marker]) return;
  Object.defineProperty(win, marker, { value: true });

  const wrapped = new WeakSet<object>();
  const pending = new Map<string, (d: { decision: string; reasons?: string[] }) => void>();
  let seq = 0;

  win.addEventListener('message', (e) => {
    if (e.source !== win) return;
    const d = e.data as { tag?: string; id?: string; decision?: string; reasons?: string[] } | null;
    if (!d || d.tag !== TAG_RES || typeof d.id !== 'string') return;
    const p = pending.get(d.id);
    if (p) {
      pending.delete(d.id);
      p({ decision: d.decision === 'allow' ? 'allow' : 'block', reasons: Array.isArray(d.reasons) ? d.reasons : [] });
    }
  });

  const ask = (method: string, params: unknown, chainId: number | null) =>
    new Promise<{ decision: string; reasons?: string[] }>((resolve) => {
      const id = `r${++seq}${Math.random().toString(36).slice(2, 8)}`;
      pending.set(id, resolve);
      let safeParams: unknown;
      try {
        safeParams = JSON.parse(JSON.stringify(params ?? [], (_k, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v)));
      } catch {
        safeParams = [];
      }
      win.postMessage({ tag: TAG_REQ, id, method, params: safeParams, chainId }, '*');
      setTimeout(() => {
        if (pending.delete(id)) resolve({ decision: 'block', reasons: ['Copeybara did not answer in time.'] });
      }, ANSWER_TIMEOUT_MS);
    });

  const blocked = (reasons: string[] | undefined) =>
    Object.assign(new Error(`Copeybara blocked this request. ${reasons?.[0] ?? ''}`.trim()), { code: 4001 });

  async function check(provider: Provider, origRequest: ((a: Req) => Promise<unknown>) | undefined, method: string, params: unknown) {
    let chainId: number | null = null;
    try {
      if (origRequest) chainId = parseInt(String(await origRequest.call(provider, { method: 'eth_chainId' })), 16) || null;
    } catch {
      chainId = null;
    }
    const d = await ask(method, params, chainId);
    if (d.decision !== 'allow') throw blocked(d.reasons);
  }

  function wrap(provider: unknown) {
    if (!provider || typeof provider !== 'object' || wrapped.has(provider)) return;
    const p = provider as Provider;
    wrapped.add(p);
    const origRequest = typeof p.request === 'function' ? p.request : undefined;
    const define = (name: string, value: unknown) => {
      try {
        Object.defineProperty(p, name, { value, configurable: true, writable: true });
      } catch {
        try {
          (p as Record<string, unknown>)[name] = value;
        } catch {
          /* frozen provider: nothing we can do in-page; the worker's blocks still apply */
        }
      }
    };
    if (origRequest) {
      define('request', async function (this: unknown, args: Req) {
        if (args && typeof args === 'object' && WATCHED.has(args.method)) await check(p, origRequest, args.method, args.params);
        return origRequest.call(this ?? p, args);
      });
    }
    const origSendAsync = typeof p.sendAsync === 'function' ? p.sendAsync : undefined;
    if (origSendAsync) {
      define('sendAsync', function (this: unknown, payload: { method: string; params?: unknown }, cb: (e: unknown, r?: unknown) => void) {
        if (payload && WATCHED.has(payload.method)) {
          check(p, origRequest, payload.method, payload.params).then(
            () => origSendAsync.call(this ?? p, payload, cb),
            (e) => cb(e),
          );
          return;
        }
        return origSendAsync.call(this ?? p, payload, cb);
      });
    }
    const origSend = typeof p.send === 'function' ? p.send : undefined;
    if (origSend) {
      define('send', function (this: unknown, ...a: unknown[]) {
        const method = typeof a[0] === 'string' ? a[0] : (a[0] as { method?: string } | undefined)?.method;
        if (method && WATCHED.has(method)) {
          const params = typeof a[0] === 'string' ? a[1] : (a[0] as { params?: unknown }).params;
          const cb = typeof a[1] === 'function' ? (a[1] as (e: unknown, r?: unknown) => void) : undefined;
          const go = check(p, origRequest, method, params).then(() => origSend.apply(this ?? p, a));
          if (cb) {
            go.catch((e) => cb(e));
            return undefined;
          }
          return go;
        }
        return origSend.apply(this ?? p, a);
      });
    }
  }

  // EIP-6963: wrap every announced provider; ask again now in case some announced before we were installed.
  win.addEventListener('eip6963:announceProvider', (e) => wrap((e as CustomEvent).detail?.provider));
  // window.ethereum: wrap what is there, and whatever is assigned later.
  let current: unknown = (win as unknown as { ethereum?: unknown }).ethereum;
  wrap(current);
  try {
    Object.defineProperty(win, 'ethereum', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (v) => {
        current = v;
        wrap(v);
      },
    });
  } catch {
    /* a wallet defined it non-configurable: poll below still wraps the object */
  }
  let n = 0;
  const poll = setInterval(() => {
    wrap((win as unknown as { ethereum?: unknown }).ethereum);
    if (++n > 50) clearInterval(poll);
  }, 100);
  win.dispatchEvent(new Event('eip6963:requestProvider'));
}

if (typeof window !== 'undefined' && !(globalThis as { __copeybaraTest?: boolean }).__copeybaraTest) installShim(window);
