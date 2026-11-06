// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { scriptHash } from '@copeybara/sitecheck';

(globalThis as { __copeybaraTest?: boolean }).__copeybaraTest = true;
// jsdom's postMessage leaves event.source null; browsers set it to the posting window (which the code checks).
window.postMessage = ((data: unknown) => {
  setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data, source: window })), 0);
}) as typeof window.postMessage;
const { installShim, TAG_REQ, TAG_RES } = await import('../src/shim/index');
const { startContent } = await import('../src/content/index');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
type W = Window & typeof globalThis;

/** Plays the content script: answers shim requests with a fixed decision. */
function answerWith(decision: 'allow' | 'block', seen: unknown[] = []) {
  const h = (e: MessageEvent) => {
    if (e.data?.tag !== TAG_REQ) return;
    seen.push(e.data);
    window.postMessage({ tag: TAG_RES, id: e.data.id, decision, reasons: ['because'] }, '*');
  };
  window.addEventListener('message', h);
  return () => window.removeEventListener('message', h);
}

function fakeProvider() {
  const calls: string[] = [];
  return {
    calls,
    request: vi.fn(async function (this: unknown, { method }: { method: string; params?: unknown }) {
      calls.push(method);
      if (method === 'eth_chainId') return '0xaa36a7';
      return `result:${method}`;
    }),
    sendAsync(p: { method: string }, cb: (e: unknown, r?: unknown) => void) {
      calls.push(`async:${p.method}`);
      cb(null, { result: 'ok' });
    },
  };
}

describe('MAIN-world shim', () => {
  let p: ReturnType<typeof fakeProvider>;
  beforeAll(() => {
    (window as unknown as { ethereum: unknown }).ethereum = fakeProvider();
    installShim(window as W);
  });
  beforeEach(() => {
    p = fakeProvider();
    (window as unknown as { ethereum: unknown }).ethereum = p; // assigned after install: still wrapped (setter trap)
  });

  test('unwatched methods pass straight through, same value, nothing sent to the extension', async () => {
    const seen: unknown[] = [];
    const off = answerWith('block', seen);
    expect(await (window as any).ethereum.request({ method: 'eth_accounts' })).toBe('result:eth_accounts');
    expect(seen).toHaveLength(0);
    off();
  });
  test('watched + allowed → the wallet gets the original request (with chain id sent along)', async () => {
    const seen: { chainId: number; method: string }[] = [];
    const off = answerWith('allow', seen);
    expect(await (window as any).ethereum.request({ method: 'eth_sendTransaction', params: [{ to: '0x1' }] })).toBe('result:eth_sendTransaction');
    expect(seen[0]).toMatchObject({ method: 'eth_sendTransaction', chainId: 11155111 });
    off();
  });
  test('watched + blocked → EIP-1193 user-rejected error (4001); the wallet never sees it', async () => {
    const off = answerWith('block');
    await expect((window as any).ethereum.request({ method: 'eth_sign', params: [] })).rejects.toMatchObject({ code: 4001 });
    expect(p.calls).not.toContain('eth_sign');
    off();
  });
  test('legacy sendAsync is covered too', async () => {
    const off = answerWith('block');
    const err = await new Promise((r) => (window as any).ethereum.sendAsync({ method: 'eth_sendTransaction', params: [] }, (e: unknown) => r(e)));
    expect(err).toMatchObject({ code: 4001 });
    expect(p.calls).not.toContain('async:eth_sendTransaction');
    off();
  });
  test('EIP-6963 providers announced later are wrapped', async () => {
    const q = fakeProvider();
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: {}, provider: q } }));
    const off = answerWith('block');
    await expect(q.request({ method: 'personal_sign', params: [] })).rejects.toMatchObject({ code: 4001 });
    off();
  });
  test('bigint params do not break the hand-off', async () => {
    const seen: { params: unknown }[] = [];
    const off = answerWith('allow', seen);
    await (window as any).ethereum.request({ method: 'eth_sendTransaction', params: [{ value: 5n }] });
    expect(seen[0]!.params).toEqual([{ value: '0x5' }]);
    off();
  });
});

describe('content script', () => {
  test('hashes every script of a protocol page (incl. inline code and handlers) and relays requests', async () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const sent: any[] = [];
    const runtime = {
      sendMessage: async (m: any) => {
        sent.push(m);
        if (m.t === 'hello') return { site: { kind: 'protocol', protocol: 'x.eth', verdict: 'checking' } };
        if (m.t === 'request') return { decision: 'block', reasons: ['nope'] };
        return { site: {} };
      },
    };
    globalThis.fetch = vi.fn(async (u: string) => ({ ok: true, text: async () => (String(u).endsWith('/app.js') ? 'APP' : 'OTHER') })) as any;
    const s1 = document.createElement('script');
    s1.src = '/app.js';
    document.head.appendChild(s1); // present before the content script starts
    const c1 = startContent(window as W, runtime);
    await tick(5);
    const s2 = document.createElement('script');
    s2.textContent = 'window.evil=1';
    document.body.appendChild(s2);
    const img = document.createElement('img');
    img.setAttribute('onerror', 'steal()');
    document.body.appendChild(img);
    const json = document.createElement('script');
    json.type = 'application/json';
    json.textContent = '{}';
    document.body.appendChild(json);
    window.dispatchEvent(new Event('load'));
    await tick(400);
    const items = sent.filter((m) => m.t === 'scripts').flatMap((m) => m.items);
    expect(items).toEqual(
      expect.arrayContaining([
        { kind: 'src', label: 'http://localhost:3000/app.js', hash: await scriptHash('APP') },
        { kind: 'inline', label: 'inline script #1', hash: await scriptHash('window.evil=1') },
        { kind: 'handler', label: 'onerror on <img> #1', hash: await scriptHash('steal()') },
      ]),
    );
    expect(items).toHaveLength(3);
    expect(sent.filter((m) => m.t === 'scripts').at(-1).done).toBe(true);

    // a page posting a fake answer is noise; a well-formed request is relayed and answered
    window.postMessage({ tag: TAG_RES, id: 'forged', decision: 'allow' }, '*');
    const answers: any[] = [];
    window.addEventListener('message', (e) => e.data?.tag === TAG_RES && answers.push(e.data));
    window.postMessage({ tag: TAG_REQ, id: 'r1', method: 'eth_sign', params: [], chainId: 1 }, '*');
    await tick(20);
    expect(sent.filter((m) => m.t === 'noise')).toHaveLength(1);
    expect(sent.find((m) => m.t === 'request')).toMatchObject({ id: 'r1', method: 'eth_sign', chainId: 1 });
    expect(answers.find((a) => a.id === 'r1')).toMatchObject({ decision: 'block', reasons: ['nope'] });
    c1.stop();
  });

  test('on a site that is not a followed protocol, nothing is hashed or fetched', async () => {
    const sent: any[] = [];
    globalThis.fetch = vi.fn() as any;
    startContent(window as W, { sendMessage: async (m: any) => (sent.push(m), m.t === 'hello' ? { site: { kind: 'none' } } : {}) });
    await tick(5);
    const s = document.createElement('script');
    s.src = '/x.js';
    document.body.appendChild(s);
    await tick(300);
    expect(sent.filter((m) => m.t === 'scripts')).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
