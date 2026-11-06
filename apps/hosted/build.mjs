// Hosted page = static instructions + the exact kit build + its sha256. No scripts on the index.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'kit', 'dist');
const OUT = join(HERE, 'dist');
mkdirSync(OUT, { recursive: true });
const sha = readFileSync(join(KIT, 'blackout-kit.html.sha256'), 'utf8').split(' ')[0];
const size = readFileSync(join(KIT, 'blackout-kit.html')).length;
copyFileSync(join(KIT, 'blackout-kit.html'), join(OUT, 'blackout-kit.html'));
copyFileSync(join(KIT, 'blackout-kit.html.sha256'), join(OUT, 'blackout-kit.html.sha256'));
writeFileSync(join(OUT, 'index.html'), readFileSync(join(HERE, 'index.template.html'), 'utf8').replace('__SHA__', sha).replace('__SIZE__', String(size)));
console.log(`hosted page built: ${OUT} (kit ${sha})`);
