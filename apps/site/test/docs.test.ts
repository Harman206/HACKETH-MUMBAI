import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_FILES, DOCS, HARD_RULES, agentPrompt, docLink, findDoc, renderDoc } from '../src/docs';

const REPO = join(__dirname, '..', '..', '..');
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('developer docs', () => {
  test('every docs/sdk page is in the nav, once', () => {
    expect(DOCS.map((d) => d.slug).sort()).toEqual([...DOC_FILES].sort());
    expect(new Set(DOCS.map((d) => d.slug)).size).toBe(DOCS.length);
    expect(findDoc(null)?.slug).toBe('overview');
  });

  test.each(DOCS.map((d) => [d.slug, d] as const))('%s: has a title and every .md link is a docs page', (_, d) => {
    expect(d.markdown.startsWith(`# ${d.title}\n`)).toBe(true);
    for (const m of d.markdown.matchAll(/\]\(([^)\s]+\.md(?:#[^)]*)?)\)/g)) {
      if (/^https?:/.test(m[1]!)) continue;
      expect(docLink(m[1]!), `${d.slug} → ${m[1]}`).not.toBeNull();
    }
  });

  test('every copeybara command in the docs exists in the CLI help', () => {
    const main = readFileSync(join(REPO, 'packages', 'protocol-cli', 'src', 'main.ts'), 'utf8');
    const help = /const HELP = `([\s\S]*?)`;/.exec(main)![1]!;
    const commands = new Set([...help.matchAll(/^ {2}([a-z-]+)/gm)].map((m) => m[1]!));
    for (const d of DOCS) {
      for (const m of d.markdown.matchAll(/(?:pnpm |`)copeybara ([a-z][a-z-]+)/g)) {
        expect(commands.has(m[1]!), `${d.slug}: copeybara ${m[1]}`).toBe(true);
      }
    }
  });

  test('every agent prompt carries the hard rules, and agents.md states the same rules', () => {
    const agents = flat(findDoc('agents')!.markdown);
    for (const r of HARD_RULES) expect(agents, r).toContain(r);
    for (const d of DOCS) {
      const p = flat(agentPrompt(d));
      for (const r of HARD_RULES) expect(p, `${d.slug}: ${r}`).toContain(r);
      expect(p).toMatch(/https:\/\/\S+\/(llms-full\.txt|docs\/\S+\.md)/);
    }
  });

  test('pages render with unique heading ids, in-site doc links and copyable code', () => {
    for (const d of DOCS) {
      const r = renderDoc(d);
      const ids = r.toc.map((t) => t.id);
      expect(new Set(ids).size, d.slug).toBe(ids.length);
      for (const id of ids) expect(r.html).toContain(`id="${id}"`);
      expect(r.html).not.toMatch(/href="[a-z0-9-]+\.md/);
      expect((r.html.match(/<pre>/g) ?? []).length).toBe((r.html.match(/data-copy-code/g) ?? []).length);
    }
    expect(renderDoc(findDoc('quickstart')!).html).toContain('href="#/docs/configuration"');
  });

  test('raw HTML in Markdown is shown as text, never inserted', () => {
    const r = renderDoc({ slug: 'x-test', title: 'X', summary: '', task: '', group: '', markdown: '# X\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n' });
    expect(r.html).not.toMatch(/<script|<img/);
    expect(r.html).toContain('&lt;script&gt;');
  });
});
