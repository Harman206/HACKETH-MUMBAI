import { useState } from 'preact/hooks';
import { DOC_GROUPS, DOCS, SITE_URL, agentPrompt, docRoute, findDoc, renderDoc, type DocPage } from '../docs';

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ label, text, primary }: { label: string; text: () => string; primary?: boolean }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const run = async () => {
    setState((await copy(text())) ? 'ok' : 'fail');
    setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button type="button" class={primary ? 'btn doc-btn' : 'btn ghost doc-btn'} onClick={run} aria-live="polite">
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy blocked: select the text' : label}
    </button>
  );
}

/** Code blocks come from rendered Markdown, so their copy buttons are handled by delegation. */
async function onArticleClick(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
  if (!b) return;
  const code = b.parentElement?.querySelector('code')?.textContent ?? '';
  b.textContent = (await copy(code)) ? 'Copied' : 'Copy blocked';
  setTimeout(() => (b.textContent = 'Copy'), 1800);
}

function Sidebar({ current }: { current: string }) {
  return (
    <nav class="doc-side" aria-label="Documentation">
      {DOC_GROUPS.map((g) => (
        <div key={g.title} class="doc-group">
          <p class="doc-group-title">{g.title}</p>
          <ul>
            {g.pages.map((p) => (
              <li key={p.slug}>
                <a href={docRoute(p.slug)} {...(p.slug === current ? { 'aria-current': 'page' as const } : {})}>{p.title}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Pager({ d }: { d: DocPage }) {
  const i = DOCS.indexOf(d);
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    <nav class="doc-pager" aria-label="Previous and next page">
      {prev ? <a href={docRoute(prev.slug)}><span>Previous</span>{prev.title}</a> : <span />}
      {next ? <a class="next" href={docRoute(next.slug)}><span>Next</span>{next.title}</a> : <span />}
    </nav>
  );
}

export function DocsPage({ slug }: { slug: string | null }) {
  const d = findDoc(slug);
  if (!d) {
    return (
      <section class="section page-hero">
        <div class="wrap">
          <h1 class="page-title">No such page</h1>
          <p class="lede">There is no docs page called "{slug}". <a href={docRoute('overview')}>Start at the overview</a>.</p>
        </div>
      </section>
    );
  }
  const r = renderDoc(d);
  return (
    <section class="section docs">
      <div class="wrap docs-layout">
        <Sidebar current={d.slug} />
        <article class="doc" data-doc={d.slug}>
          <p class="eyebrow">Docs · {d.group}</p>
          <div class="doc-toolbar" role="group" aria-label="Use this page with an AI agent">
            <CopyButton label="Copy agent prompt" text={() => agentPrompt(d)} primary />
            <CopyButton label="Copy page as Markdown" text={() => d.markdown} />
            <a class="text-link" href={`docs/${d.slug}.md`}>View as Markdown</a>
            <a class="text-link" href="llms.txt" title={`${SITE_URL}/llms.txt`}>llms.txt</a>
          </div>
          <div class="doc-body" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: r.html }} />
          <Pager d={d} />
        </article>
        {r.toc.length > 1 && (
          <aside class="doc-toc" aria-label="On this page">
            <p class="doc-group-title">On this page</p>
            <ul>
              {r.toc.map((t) => (
                <li key={t.id} class={t.depth === 3 ? 'sub' : undefined}><a href={docRoute(d.slug, t.id)}>{t.text}</a></li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </section>
  );
}
