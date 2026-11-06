// @vitest-environment jsdom
/**
 * B3 gaps G1 (code loaded with import() / modulepreload is never hashed) and G2 (the re-fetch can be cloaked).
 * The content script must also hash JS that only shows up in resource timing or as <link rel=modulepreload>, and
 * read same-origin bytes from the page's own cache entry first.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { scriptHash } from '@copeybara/sitecheck';

(globalThis as { __copeybaraTest?: boolean }).__copeybaraTest = true;
const { startContent } = await import('../src/content/index');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
type W = Window & typeof globalThis;
const ORIGIN = 'http://localhost:3000';

/** Stands in for the browser's PerformanceObserver; `emit` delivers resource-timing entries. */
class FakePO {
  static all: FakePO[] = [];
  static buffered: { name: string; initiatorType: string }[] = [];
  opts: unknown;
  stopped = false;
  constructor(private cb: (l: { getEntries(): unknown[] }) => void) {
    FakePO.all.push(this);
  }
  observe(opts: { buffered?: boolean }) {
    this.opts = opts;
    if (opts.buffered && FakePO.buffered.length) this.cb({ getEntries: () => FakePO.buffered });
  }
  disconnect() {
    this.stopped = true;
  }
  static emit(entries: { name: string; initiatorType: string }[]) {
    for (const p of FakePO.all) if (!p.stopped) p.cb({ getEntries: () => entries });
  }
}

const BODY: Record<string, string> = {
  '/assets/index.js': 'INDEX',
  '/assets/wallet-chunk.js?v=3': 'EVIL CHUNK',
  '/assets/vendor.js': 'VENDOR',
  '/assets/worker.mjs': 'WORKER',
  'https://cdn.example/lib.js': 'CDN',
};
const bodyOf = (u: string) => BODY[u.startsWith(ORIGIN) ? u.slice(ORIGIN.length) : u] ?? 'OTHER';

function protocolRuntime(sent: any[]) {
  return {
    sendMessage: async (m: any) => {
      sent.push(m);
      return m.t === 'hello' ? { site: { kind: 'protocol', protocol: 'x.eth', verdict: 'checking' } } : { site: {} };
    },
  };
}

afterEach(() => {
  FakePO.all = [];
  FakePO.buffered = [];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('G1: dynamically loaded code is hashed too', () => {
  test('import() chunks, workers and modulepreload links are hashed like <script src>; each URL is read once', async () => {
    (window as any).PerformanceObserver = FakePO;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (u: string) => (calls.push(String(u)), { ok: true, status: 200, text: async () => bodyOf(String(u)) })) as any;
    FakePO.buffered = [{ name: `${ORIGIN}/assets/index.js`, initiatorType: 'script' }]; // loaded before the content script ran
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/assets/index.js';
    document.head.appendChild(s);
    const pre = document.createElement('link');
    pre.rel = 'modulepreload';
    pre.href = '/assets/vendor.js';
    document.head.appendChild(pre);
    const sent: any[] = [];
    const c = startContent(window as W, protocolRuntime(sent));
    await tick(5);
    FakePO.emit([
      { name: `${ORIGIN}/assets/wallet-chunk.js?v=3`, initiatorType: 'script' }, // import('/assets/wallet-chunk.js?v=3')
      { name: `${ORIGIN}/assets/worker.mjs`, initiatorType: 'other' }, // new Worker(url, { type: 'module' })
      { name: 'https://cdn.example/lib.js', initiatorType: 'link' },
      { name: `${ORIGIN}/assets/app.css`, initiatorType: 'link' }, // not code
      { name: `${ORIGIN}/api/data.json`, initiatorType: 'fetch' }, // not code
      { name: 'chrome-extension://abc/inject.js', initiatorType: 'script' }, // another extension, not the page
      { name: `${ORIGIN}/assets/index.js`, initiatorType: 'script' }, // already hashed
    ]);
    window.dispatchEvent(new Event('load'));
    await tick(400);
    const items = sent.filter((m) => m.t === 'scripts').flatMap((m) => m.items);
    expect(items).toEqual(
      expect.arrayContaining([
        { kind: 'src', label: `${ORIGIN}/assets/index.js`, hash: await scriptHash('INDEX') },
        { kind: 'src', label: `${ORIGIN}/assets/vendor.js`, hash: await scriptHash('VENDOR') },
        { kind: 'src', label: `${ORIGIN}/assets/wallet-chunk.js?v=3`, hash: await scriptHash('EVIL CHUNK') },
        { kind: 'src', label: `${ORIGIN}/assets/worker.mjs`, hash: await scriptHash('WORKER') },
        { kind: 'src', label: 'https://cdn.example/lib.js', hash: await scriptHash('CDN') },
      ]),
    );
    expect(items).toHaveLength(5);
    const urls = calls.map((u) => u.replace(ORIGIN, ''));
    expect(urls.filter((u) => u === '/assets/index.js')).toHaveLength(1);
    expect(urls.some((u) => /\.css|\.json|chrome-extension/.test(u))).toBe(false);
    expect(FakePO.all[0]!.opts).toMatchObject({ type: 'resource', buffered: true });
    c.stop();
    expect(FakePO.all[0]!.stopped).toBe(true);
  });

  test('on a site that is not a followed protocol, resource timing is not watched', async () => {
    (window as any).PerformanceObserver = FakePO;
    globalThis.fetch = vi.fn() as any;
    startContent(window as W, { sendMessage: async (m: any) => (m.t === 'hello' ? { site: { kind: 'none' } } : {}) });
    await tick(5);
    FakePO.emit([{ name: `${ORIGIN}/assets/wallet-chunk.js`, initiatorType: 'script' }]);
    await tick(300);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(FakePO.all.every((p) => p.stopped)).toBe(true);
  });

  test('without PerformanceObserver (old browser, test env) it still hashes <script> elements', async () => {
    delete (window as any).PerformanceObserver;
    globalThis.fetch = vi.fn(async (u: string) => ({ ok: true, status: 200, text: async () => bodyOf(String(u)) })) as any;
    const s = document.createElement('script');
    s.src = '/assets/index.js';
    document.head.appendChild(s);
    const sent: any[] = [];
    const c = startContent(window as W, protocolRuntime(sent));
    window.dispatchEvent(new Event('load'));
    await tick(400);
    expect(sent.filter((m) => m.t === 'scripts').flatMap((m) => m.items)).toEqual([{ kind: 'src', label: `${ORIGIN}/assets/index.js`, hash: await scriptHash('INDEX') }]);
    c.stop();
  });
});

describe('G2: bytes come from the page\'s own cache entry first', () => {
  test('same-origin scripts: only-if-cached + same-origin first; a cache miss falls back to force-cache', async () => {
    delete (window as any).PerformanceObserver;
    const inits: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (u: string, init: RequestInit) => {
      inits.push({ url: String(u), init });
      if (init.cache === 'only-if-cached') return String(u).endsWith('/cached.js') ? { ok: true, status: 200, text: async () => 'FROM CACHE' } : { ok: false, status: 504, text: async () => '' };
      return { ok: true, status: 200, text: async () => 'REFETCHED' };
    }) as any;
    for (const src of ['/cached.js', '/missed.js', 'https://cdn.example/lib.js']) {
      const s = document.createElement('script');
      s.src = src;
      document.head.appendChild(s);
    }
    const sent: any[] = [];
    const c = startContent(window as W, protocolRuntime(sent));
    window.dispatchEvent(new Event('load'));
    await tick(400);
    c.stop();
    const items = sent.filter((m) => m.t === 'scripts').flatMap((m) => m.items);
    expect(items).toEqual(
      expect.arrayContaining([
        { kind: 'src', label: `${ORIGIN}/cached.js`, hash: await scriptHash('FROM CACHE') },
        { kind: 'src', label: `${ORIGIN}/missed.js`, hash: await scriptHash('REFETCHED') },
        { kind: 'src', label: 'https://cdn.example/lib.js', hash: await scriptHash('REFETCHED') },
      ]),
    );
    const of = (u: string) => inits.filter((x) => x.url === u).map((x) => `${x.init.cache}/${x.init.mode ?? '-'}`);
    expect(of(`${ORIGIN}/cached.js`)).toEqual(['only-if-cached/same-origin']);
    expect(of(`${ORIGIN}/missed.js`)).toEqual(['only-if-cached/same-origin', 'force-cache/-']);
    expect(of('https://cdn.example/lib.js')).toEqual(['force-cache/-']); // only-if-cached needs same-origin mode
  });
});
