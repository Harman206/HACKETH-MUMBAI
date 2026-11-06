// Ship the exact verified kit next to the website (the ENS fingerprint, not this host, is what users trust).
import { copyFileSync, existsSync } from 'node:fs';
const kit = new URL('../../kit/dist/', import.meta.url);
for (const f of ['blackout-kit.html', 'blackout-kit.html.sha256']) {
  if (!existsSync(new URL(f, kit))) throw new Error(`build the kit first: ${f} missing`);
  copyFileSync(new URL(f, kit), new URL(`../dist/${f}`, import.meta.url));
}
console.log('kit copied into site/dist');
