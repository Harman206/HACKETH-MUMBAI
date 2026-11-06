/**
 * Content script (isolated world, document_start, every frame). Two jobs:
 *  1. Observe every piece of code the page runs (script elements, inline code, event handlers, javascript: URLs)
 *     from the first byte, hash it, and send the hashes to the worker. The page cannot see or alter this code.
 *  2. Relay wallet requests from the MAIN-world shim to the worker and the worker's decision back.
 * Page messages are untrusted input: malformed ones are reported as page noise, never acted on.
 * It never reads extension storage and computes no verdicts.
 */
import { isExecutableScriptType, scriptHash, type CodeItem } from '@copeybara/sitecheck';
import { KIT_TAG, TAG_REQ, TAG_RES } from '../shared/tags';

type Runtime = { sendMessage(m: unknown): Promise<unknown> };
type SiteReply = { site?: { kind: string; verdict?: string; protocol?: string }; resend?: boolean } | undefined;


export function startContent(win: Window & typeof globalThis, runtime: Runtime) {
  const doc = win.document;
  const items = new Map<string, CodeItem>();
  const seen = new WeakSet<Element>();
  const queue: Promise<CodeItem | null>[] = [];
  let collecting: boolean | null = null; // null until the worker says whether this origin is a followed protocol
  let inline = 0;
  let handlers = 0;
  let unsent: CodeItem[] = [];
  let loaded = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const buffer: Element[] = [];

  const send = (m: unknown) => runtime.sendMessage(m).catch(() => undefined) as Promise<SiteReply>;

  async function hashScript(el: HTMLScriptElement): Promise<CodeItem | null> {
    if (!isExecutableScriptType(el.getAttribute('type'))) return null;
    const src = el.getAttribute('src');
    if (src !== null) {
      const url = new URL(src, doc.baseURI).href;
      try {
        // Same page, same cache partition: the bytes the page itself got (cache-first).
        const r = await fetch(url, { cache: 'force-cache' }); // default credentials: CDNs answer ACAO * (no cookies allowed)
        return { kind: 'src', label: url, hash: r.ok ? await scriptHash(await r.text()) : null };
      } catch {
        return { kind: 'src', label: url, hash: null };
      }
    }
    return { kind: 'inline', label: `inline script #${++inline}`, hash: await scriptHash(el.textContent ?? '') };
  }

  async function hashHandlers(el: Element): Promise<CodeItem[]> {
    const out: CodeItem[] = [];
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      const code = n.startsWith('on') ? a.value : /^(href|src|action|formaction)$/.test(n) && /^\s*javascript:/i.test(a.value) ? a.value.trim() : null;
      if (code !== null) out.push({ kind: 'handler', label: `${n} on <${el.tagName.toLowerCase()}> #${++handlers}`, hash: await scriptHash(code) });
    }
    return out;
  }

  function consider(el: Element) {
    if (collecting === false) return;
    if (collecting === null) {
      buffer.push(el);
      return;
    }
    if (el.tagName === 'SCRIPT' && !seen.has(el)) {
      seen.add(el);
      queue.push(hashScript(el as HTMLScriptElement).then((i) => (i && add(i), i)));
    }
    if (el.attributes.length) queue.push(hashHandlers(el).then((is) => (is.forEach(add), null)));
  }

  function add(i: CodeItem) {
    const k = `${i.kind}|${i.label}|${i.hash}`;
    if (items.has(k)) return;
    items.set(k, i);
    unsent.push(i);
    schedule();
  }

  function schedule() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 150);
  }

  async function flush() {
    flushTimer = null;
    await Promise.all(queue.splice(0));
    const batch = unsent.splice(0, 400);
    const r = await send({ t: 'scripts', items: batch, done: loaded });
    if (r?.resend) {
      await send({ t: 'hello' });
      await send({ t: 'scripts', items: [...items.values()].slice(0, 400), done: loaded });
    }
    if (unsent.length) schedule();
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target instanceof Element) consider(m.target);
      for (const n of Array.from(m.addedNodes)) {
        if (!(n instanceof Element)) continue;
        consider(n);
        n.querySelectorAll('*').forEach(consider);
      }
    }
  });
  observer.observe(doc, { childList: true, subtree: true, attributes: true });

  send({ t: 'hello' }).then((r) => {
    collecting = r?.site?.kind === 'protocol';
    if (collecting) {
      doc.querySelectorAll('*').forEach(consider);
      buffer.splice(0).forEach(consider);
      schedule();
    } else {
      buffer.length = 0;
      observer.disconnect();
    }
  });
  win.addEventListener('load', () => {
    loaded = true;
    setTimeout(schedule, 50);
  });

  // ---- bridge: shim ⇄ worker ----
  let noise = 0;
  const answered = new Set<string>();
  win.addEventListener('message', (e) => {
    if (e.source !== win) return;
    const d = e.data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object') return;
    if (d.tag === TAG_REQ) {
      if (typeof d.id !== 'string' || typeof d.method !== 'string') {
        if (noise++ < 20) void send({ t: 'noise' });
        return;
      }
      const id = d.id;
      void send({ t: 'request', id, method: d.method, params: d.params, chainId: d.chainId ?? null }).then((r) => {
        const res = (r ?? {}) as { decision?: string; reasons?: string[] };
        answered.add(id);
        win.postMessage({ tag: TAG_RES, id, decision: res.decision === 'allow' ? 'allow' : 'block', reasons: res.reasons ?? ['Copeybara is not responding.'] }, '*');
      });
    } else if (d.tag === KIT_TAG) {
      if (typeof d.address === 'string') void send({ t: 'kit-address', address: d.address });
    } else if (d.tag === TAG_RES) {
      if (typeof d.id === 'string' && answered.delete(d.id)) return; // our own answer
      // Only the content script answers; a page posting answers itself is noise (its own shim may obey it,
      // which only lets a page bypass checks on itself — the worker's blocks are unaffected).
      if (noise++ < 20) void send({ t: 'noise' });
    }
  });
  return { stop: () => observer.disconnect() };
}

declare const chrome: { runtime: Runtime } | undefined;
if (typeof chrome !== 'undefined' && chrome?.runtime && !(globalThis as { __copeybaraTest?: boolean }).__copeybaraTest) {
  startContent(window, chrome.runtime);
}
