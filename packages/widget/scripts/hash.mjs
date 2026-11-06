// Writes copeybara-exit.js.sha256 (sha256sum format). The protocol's site fingerprint (org.copeybara.site) covers the
// widget like any other script the site serves; this sidecar is for people checking the file on its own.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const f = new URL('../copeybara-exit.js', import.meta.url);
const sha = createHash('sha256').update(readFileSync(f)).digest('hex');
writeFileSync(new URL('../copeybara-exit.js.sha256', import.meta.url), `${sha}  copeybara-exit.js\n`);
console.log(sha);
