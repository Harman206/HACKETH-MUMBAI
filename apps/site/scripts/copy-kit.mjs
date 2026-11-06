// Ship the exact verified kit next to the website (the ENS fingerprint, not this host, is what users trust).
import { copyFileSync, existsSync } from 'node:fs';
const kit = new URL('../../kit/dist/', import.meta.url);
for (const f of ['blackout-kit.html', 'blackout-kit.html.sha256']) {
  if (!existsSync(new URL(f, kit))) throw new Error(`build the kit first: ${f} missing`);
  copyFileSync(new URL(f, kit), new URL(`../dist/${f}`, import.meta.url));
}
console.log('kit copied into site/dist');

// The last recorded live theater run (written by scripts/rehearse-live.ts), if any.
import { mkdirSync } from 'node:fs';
const run = new URL('../../../demo-runs/latest.json', import.meta.url);
if (existsSync(run)) {
  mkdirSync(new URL('../dist/demo-runs/', import.meta.url), { recursive: true });
  copyFileSync(run, new URL('../dist/demo-runs/latest.json', import.meta.url));
  console.log('demo-runs/latest.json copied');
}
