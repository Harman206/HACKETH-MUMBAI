import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Copy text to the clipboard. Falls back to a hidden textarea where the async API is missing or refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.append(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      class={`copy-btn ${state}`}
      data-copy
      onClick={async () => {
        setState((await copyText(text)) ? 'ok' : 'fail');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1600);
      }}
    >
      <span aria-live="polite">{state === 'ok' ? 'Copied ✓' : state === 'fail' ? 'Select and copy' : label}</span>
    </button>
  );
}

/** A command (or snippet) with a copy button. */
export function Command({ code, note }: { code: string; note?: string }) {
  return (
    <figure class="cmd">
      {note && <figcaption>{note}</figcaption>}
      <div class="cmd-box">
        <pre><code>{code}</code></pre>
        <CopyButton text={code} />
      </div>
    </figure>
  );
}

export function Code({ children, label, copy }: { children: string; label?: string; copy?: boolean }) {
  return (
    <figure class="code">
      {label && <figcaption>{label}</figcaption>}
      <div class="cmd-box">
        <pre><code>{children}</code></pre>
        {copy && <CopyButton text={children} />}
      </div>
    </figure>
  );
}

/** Scroll to a section on the current page without changing the route (a bare "#id" would mean the home page). */
export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

/** A link that works the same for in-page sections (#id), site pages (#/…) and external URLs (new tab). */
export function Lnk({ href, children, class: cls = 'text-link' }: { href: string; children: ComponentChildren; class?: string }) {
  if (href.startsWith('#') && !href.startsWith('#/')) {
    return <a class={cls} href={href} onClick={(e) => { e.preventDefault(); scrollToId(href.slice(1)); }}>{children}</a>;
  }
  if (/^https?:/.test(href)) return <a class={cls} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  return <a class={cls} href={href}>{children}</a>;
}
