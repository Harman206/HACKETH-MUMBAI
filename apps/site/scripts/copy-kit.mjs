// Ship the exact verified kit and extension zips next to the website (the ENS fingerprint, not this host, is what users trust).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const kit = new URL('../../kit/dist/', import.meta.url);
for (const f of ['copeybara-kit.html', 'copeybara-kit.html.sha256']) {
  if (!existsSync(new URL(f, kit))) throw new Error(`build the kit first: ${f} missing`);
  copyFileSync(new URL(f, kit), new URL(`../dist/${f}`, import.meta.url));
}
console.log('kit copied into site/dist');

// The browser extension (built by `node apps/extension/scripts/build.mjs`). Each zip must match its own .sha256 file.
const ext = new URL('../../extension/dist/', import.meta.url);
for (const browser of ['chrome', 'firefox']) {
  const zip = `copeybara-extension-${browser}.zip`;
  for (const f of [zip, `${zip}.sha256`]) {
    if (!existsSync(new URL(f, ext))) throw new Error(`build the extension first (node apps/extension/scripts/build.mjs): ${f} missing`);
  }
  const want = readFileSync(new URL(`${zip}.sha256`, ext), 'utf8').split(' ')[0];
  const got = createHash('sha256').update(readFileSync(new URL(zip, ext))).digest('hex');
  if (want !== got) throw new Error(`${zip} does not match its .sha256 (${got} ≠ ${want}): rebuild the extension`);
  for (const f of [zip, `${zip}.sha256`]) copyFileSync(new URL(f, ext), new URL(`../dist/${f}`, import.meta.url));
}
console.log('extension zips copied into site/dist');

// <copeybara-exit>, served so protocols (and the developer page) load the exact file whose sha256 is published.
const widget = new URL('../../../packages/widget/', import.meta.url);
{
  const want = readFileSync(new URL('copeybara-exit.js.sha256', widget), 'utf8').split(' ')[0];
  const got = createHash('sha256').update(readFileSync(new URL('copeybara-exit.js', widget))).digest('hex');
  if (want !== got) throw new Error(`copeybara-exit.js does not match its .sha256 (${got} ≠ ${want}): run pnpm --filter @copeybara/widget hash`);
  for (const f of ['copeybara-exit.js', 'copeybara-exit.js.sha256']) copyFileSync(new URL(f, widget), new URL(`../dist/${f}`, import.meta.url));
  console.log('widget copied into site/dist');
}

// The last recorded live theater run (written by scripts/rehearse-live.ts), if any.
const run = new URL('../../../demo-runs/latest.json', import.meta.url);
if (existsSync(run)) {
  mkdirSync(new URL('../dist/demo-runs/', import.meta.url), { recursive: true });
  copyFileSync(run, new URL('../dist/demo-runs/latest.json', import.meta.url));
  console.log('demo-runs/latest.json copied');
}
