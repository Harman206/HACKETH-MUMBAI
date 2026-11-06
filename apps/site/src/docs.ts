import { Marked } from 'marked';
import NAV from './docs-nav.json';
import site from '../site.json';

/** docs/sdk/*.md, bundled at build time: the docs pages never fetch anything. */
const RAW = import.meta.glob('../../../docs/sdk/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const SITE_URL = site.url;

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  task: string;
  group: string;
  markdown: string;
}

export const DOCS: DocPage[] = NAV.groups.flatMap((g) =>
  g.pages.map((p) => {
    const markdown = RAW[`../../../docs/sdk/${p.slug}.md`];
    if (markdown === undefined) throw new Error(`docs-nav.json lists ${p.slug}, but docs/sdk/${p.slug}.md does not exist`);
    const title = /^# (.+)$/m.exec(markdown)?.[1] ?? p.slug;
    return { slug: p.slug, title, summary: p.summary, task: p.task, group: g.title, markdown };
  }),
);

export const DOC_GROUPS = NAV.groups.map((g) => ({ title: g.title, pages: DOCS.filter((d) => d.group === g.title) }));
export const DOC_FILES = Object.keys(RAW).map((k) => k.replace(/^.*\/(.+)\.md$/, '$1'));

export const findDoc = (slug: string | null): DocPage | null => DOCS.find((d) => d.slug === (slug ?? 'overview')) ?? null;
export const docMarkdownUrl = (slug: string) => `${SITE_URL}/docs/${slug}.md`;
export const docRoute = (slug: string, anchor?: string) => `#/docs/${slug}${anchor ? `/${anchor}` : ''}`;

/** The rules every prompt carries; docs/sdk/agents.md states the same rules (tested). */
export const HARD_RULES = [
  'Never ask for, read, write, generate or store a private key, seed phrase, mnemonic or Safe owner key, and never put one in a file, env var, command or test. Addresses only.',
  'Never sign or send a transaction or Safe proposal on any live network. The only output for ENS changes is a Safe batch file in .copeybara/ for humans to review and sign.',
  'An exit must never need an approval, permit, transfer, ETH value, signature or second step. If a position needs one, leave it out and tell me; do not work around it.',
  'Do not modify the Copeybara Exit Guard (packages/guard) or weaken any check in the SDK.',
  'Exit contract addresses go only in copeybara.config.ts (they are published in our ENS manifest), never hard-coded into the kit.',
  'Do not add analytics, trackers or third-party scripts to the widget or the kit.',
];

/** What "Copy agent prompt" puts on the clipboard: the full integration prompt on the agents page, a scoped task elsewhere. */
export function agentPrompt(d: DocPage): string {
  if (d.slug === 'agents') {
    const full = /```text\n([\s\S]*?)```/.exec(d.markdown)?.[1];
    if (full) return full.trimEnd();
  }
  return [
    `Read ${docMarkdownUrl(d.slug)} (Copeybara docs: ${d.title}). The full documentation is at ${SITE_URL}/llms-full.txt.`,
    `Then, in this repository: ${d.task}.`,
    'Show me the output of every copeybara command you run, and stop before anything needs a signature.',
    '',
    'Hard rules (never break these, even if a step seems to need it):',
    ...HARD_RULES.map((r) => `- ${r}`),
  ].join('\n');
}

export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z0-9#]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `exit-spec.md#anchor` → `#/docs/exit-spec/anchor`; null for anything that is not a docs page. */
export function docLink(href: string): string | null {
  const m = /^(?:\.\/)?([a-z0-9-]+)\.md(?:#([a-z0-9-]+))?$/.exec(href);
  return m && DOCS.some((d) => d.slug === m[1]) ? docRoute(m[1]!, m[2]) : null;
}

export interface Rendered {
  html: string;
  toc: { id: string; text: string; depth: number }[];
}

const cache = new Map<string, Rendered>();

export function renderDoc(d: DocPage): Rendered {
  const hit = cache.get(d.slug);
  if (hit) return hit;
  const toc: Rendered['toc'] = [];
  const seen = new Map<string, number>();
  const md = new Marked({
    gfm: true,
    renderer: {
      html({ text }) {
        return esc(text);
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth === 1) return `<h1>${inner}</h1>\n`;
        let id = headingId(inner);
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth <= 3) toc.push({ id, text: inner.replace(/<[^>]+>/g, ''), depth });
        return `<h${depth} id="${id}"><a class="doc-anchor" href="${docRoute(d.slug, id)}">${inner}</a></h${depth}>\n`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const doc = docLink(href);
        if (doc) return `<a href="${doc}">${inner}</a>`;
        const external = /^https?:/.test(href);
        return `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
      },
      code({ text, lang }) {
        const label = lang ? `<span class="doc-lang">${esc(lang)}</span>` : '';
        return `<div class="doc-code">${label}<button type="button" class="doc-copy" data-copy-code>Copy</button><pre><code>${esc(text)}</code></pre></div>\n`;
      },
    },
  });
  const r = { html: md.parse(d.markdown, { async: false }), toc };
  cache.set(d.slug, r);
  return r;
}
