import { expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..');
const docs = ['README.md', 'FEEDBACK.md', 'docs/crops.md', 'docs/ai-use.md'];

test.each(docs)('%s: every relative link points at a file that exists', (doc) => {
  const md = readFileSync(join(REPO, doc), 'utf8');
  const base = join(REPO, doc, '..');
  const links = [...md.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map((m) => m[1]!).filter((l) => !/^https?:/.test(l));
  for (const l of links) expect(existsSync(join(base, l)), `${doc} → ${l}`).toBe(true);
});

test('every tx hash in README appears in deployments, fixtures or replay reports', () => {
  const md = readFileSync(join(REPO, 'README.md'), 'utf8');
  const hashes = [...md.matchAll(/0x[0-9a-fA-F]{64}/g)].map((m) => m[0].toLowerCase());
  const sources = [
    ...['contracts/deployments', 'replay/fixtures', 'docs/replay'].flatMap((d) =>
      existsSync(join(REPO, d)) ? readdirSync(join(REPO, d)).map((f) => readFileSync(join(REPO, d, f), 'utf8')) : [],
    ),
  ].join('\n').toLowerCase();
  for (const h of hashes) expect(sources.includes(h), h).toBe(true);
});
