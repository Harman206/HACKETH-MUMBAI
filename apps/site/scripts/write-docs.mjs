// Machine-readable docs for coding agents: dist/llms.txt (index, llmstxt.org format), dist/llms-full.txt (every page)
// and dist/docs/<page>.md. Source: docs/sdk/*.md in the order of src/docs-nav.json. Links become absolute URLs.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const { url } = JSON.parse(readFileSync(here('../site.json'), 'utf8'));
const nav = JSON.parse(readFileSync(here('../src/docs-nav.json'), 'utf8'));
const src = here('../../../docs/sdk/');
const dist = here('../dist/');

const pages = nav.groups.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.title })));
const listed = new Set(pages.map((p) => p.slug));
const onDisk = readdirSync(src).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
const missing = onDisk.filter((s) => !listed.has(s));
if (missing.length) throw new Error(`docs/sdk pages missing from src/docs-nav.json: ${missing.join(', ')}`);

const absolute = (md) => md.replace(/\]\((?:\.\/)?([a-z0-9-]+)\.md(#[a-z0-9-]+)?\)/g, (_, s, a = '') => `](${url}/docs/${s}.md${a})`);

mkdirSync(join(dist, 'docs'), { recursive: true });
const full = [];
for (const p of pages) {
  const md = absolute(readFileSync(join(src, `${p.slug}.md`), 'utf8'));
  p.title = /^# (.+)$/m.exec(md)?.[1] ?? p.slug;
  writeFileSync(join(dist, 'docs', `${p.slug}.md`), md);
  full.push(`<!-- ${url}/docs/${p.slug}.md -->\n\n${md.trim()}\n`);
}

const index = [
  '# Copeybara',
  '',
  "> Copeybara lets DeFi users withdraw straight from a protocol's contracts when its website, DNS or RPC is down or hijacked. Protocols publish a verifiable exit kit and their exit contracts in their ENS name; the Copeybara SDK builds those records as Safe proposals and never signs.",
  '',
  'Rules for agents: never handle private keys or seed phrases, never sign or send transactions (the SDK only writes Safe batch files for humans to sign), and never make an exit need an approval, permit, transfer, ETH value or signature.',
  '',
  ...nav.groups.flatMap((g) => [`## ${g.title}`, '', ...pages.filter((p) => p.group === g.title).map((p) => `- [${p.title}](${url}/docs/${p.slug}.md): ${p.summary}`), '']),
  '## Optional',
  '',
  `- [All pages in one file](${url}/llms-full.txt): every page above, concatenated`,
  '',
].join('\n');

writeFileSync(join(dist, 'llms.txt'), index);
writeFileSync(join(dist, 'llms-full.txt'), `# Copeybara documentation\n\nSource: ${url}/llms.txt\n\n${full.join('\n---\n\n')}`);
process.stdout.write(`docs: ${pages.length} pages → dist/docs/*.md, llms.txt, llms-full.txt\n`);
