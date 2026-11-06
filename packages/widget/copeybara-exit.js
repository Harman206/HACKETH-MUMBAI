/*! <copeybara-exit> v1 · MIT · https://github.com/Harman206/HACKETH-MUMBAI
 * Tells users where the verified exit kit is and how to check it. It never fetches anything, never touches a
 * wallet, never reads balances or builds transactions, and never stores anything (no cookies, no storage).
 *
 * <copeybara-exit ens="yourprotocol.eth" kit="/copeybara-kit.html" sha256="<kit sha256>"
 *   extension="/copeybara-extension-chrome.zip" extension-sha256="<zip sha256>" certified></copeybara-exit>
 */
(() => {
  const TAG = 'copeybara-exit';
  if (typeof customElements === 'undefined' || customElements.get(TAG)) return;
  const CHECK = 'https://blackout-red.vercel.app/#/certified/';
  const HEX = /^[0-9a-f]{64}$/;
  const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/;
  const CSS = `
:host{display:block;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#14161a}
.c{border:1px solid #d9dce1;border-radius:12px;padding:16px 18px;background:#fff;max-width:640px}
h2{font-size:16px;margin:0 0 4px}
p{margin:6px 0}
.w{background:#fff7e6;border:1px solid #f5d48a;border-radius:8px;padding:8px 10px;font-weight:600}
.r{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
a.b{display:inline-block;padding:8px 12px;border-radius:8px;background:#14161a;color:#fff;text-decoration:none;font-weight:600}
a.b.s{background:#eef0f3;color:#14161a}
code,pre{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
.h{word-break:break-all;background:#f4f5f7;border-radius:6px;padding:6px 8px;margin:4px 0}
pre{background:#f4f5f7;border-radius:6px;padding:8px 10px;overflow:auto;margin:6px 0}
dt{font-weight:600;margin-top:8px}
dd{margin:0}
.t{display:inline-flex;align-items:center;gap:6px;color:#0b6b3a;font-weight:600;text-decoration:none}
.t svg{width:16px;height:16px}
.x{color:#8a1c1c}
@media (prefers-color-scheme:dark){:host{color:#e8eaed}.c{background:#15171b;border-color:#2c3038}.h,pre{background:#20232a}a.b{background:#e8eaed;color:#14161a}a.b.s{background:#2c3038;color:#e8eaed}.w{background:#3a2e12;border-color:#6b5520}.t{color:#5fd39a}}`;

  /** Text node helper: attribute values are only ever inserted as text, never as HTML. */
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) e.setAttribute(k, v);
    for (const k of kids) e.append(k);
    return e;
  };
  const safeHref = (v, fallback) => {
    if (!v) return fallback;
    try {
      const u = new URL(v, location.href);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : fallback;
    } catch {
      return fallback;
    }
  };
  const tick = () => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M12 1l2.6 2.2 3.4-.4.9 3.3 3 1.7-1.2 3.2 1.2 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.3 13 2.1 9.8l3-1.7.9-3.3 3.4.4zm-1.4 14.6l6.2-6.2-1.4-1.4-4.8 4.8-2.4-2.4-1.4 1.4z');
    s.append(p);
    return s;
  };

  class CopeybaraExit extends HTMLElement {
    static get observedAttributes() {
      return ['ens', 'kit', 'sha256', 'extension', 'extension-sha256', 'certified'];
    }
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    connectedCallback() {
      this.render();
    }
    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }
    render() {
      const root = this.shadowRoot;
      root.replaceChildren();
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
      } catch {
        root.append(el('style', {}, CSS));
      }
      const ens = (this.getAttribute('ens') || '').trim().toLowerCase();
      const sha = (this.getAttribute('sha256') || '').trim().toLowerCase();
      const extSha = (this.getAttribute('extension-sha256') || '').trim().toLowerCase();
      const kit = safeHref(this.getAttribute('kit'), new URL('copeybara-kit.html', location.href).href);
      const ext = this.getAttribute('extension') ? safeHref(this.getAttribute('extension'), null) : null;
      const file = decodeURIComponent(new URL(kit).pathname.split('/').pop() || 'copeybara-kit.html');
      const c = el('section', { class: 'c', part: 'card', 'aria-label': 'Emergency exit' });
      root.append(c);
      if (!NAME.test(ens)) {
        c.append(el('p', { class: 'x' }, 'copeybara-exit: set ens="yourprotocol.eth".'));
        return;
      }
      c.append(el('h2', {}, 'Emergency exit'));
      c.append(el('p', {}, `If this website is ever down or hijacked, the Copeybara exit kit lets you withdraw straight from ${ens}’s contracts. Save it now.`));
      c.append(el('p', { class: 'w', role: 'note' }, `Verify this file against ${ens} before you use it. This website cannot vouch for itself.`));
      const r = el('div', { class: 'r' }, el('a', { class: 'b', href: kit, download: file }, 'Download the exit kit'));
      if (ext) r.append(el('a', { class: 'b s', href: ext, download: '' }, 'Get the browser extension'));
      c.append(r);
      const dl = el('dl', {});
      dl.append(el('dt', {}, 'Official ENS name'), el('dd', {}, el('code', {}, ens)));
      if (HEX.test(sha)) dl.append(el('dt', {}, 'Kit sha256 (as this site states it)'), el('dd', {}, el('div', { class: 'h' }, sha)));
      if (ext && HEX.test(extSha)) dl.append(el('dt', {}, 'Extension sha256 (as this site states it)'), el('dd', {}, el('div', { class: 'h' }, extSha)));
      dl.append(
        el('dt', {}, 'Check your copy'),
        el('dd', {}, el('pre', {}, `sha256sum ${file}\nshasum -a 256 ${file}\nscripts/verify-kit.sh ${file} ${ens}`)),
      );
      dl.append(el('dd', {}, `Compare the result with org.copeybara.release on ${ens}, read from ENS yourself (the verify script reads it through three RPC providers). Get the ENS name from a source other than this page.`));
      c.append(dl);
      if (this.hasAttribute('certified')) {
        c.append(
          el('p', {}, el('a', { class: 't', href: CHECK + encodeURIComponent(ens), target: '_blank', rel: 'noopener noreferrer' }, tick(), 'Copeybara certified — check it live ↗')),
          el('p', {}, 'The tick is only real on the Copeybara site, which re-checks this name on ENS every time. A badge on this page proves nothing.'),
        );
      }
    }
  }
  customElements.define(TAG, CopeybaraExit);
})();
