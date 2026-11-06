// Writes copeybara-kit.html.sha256 in `sha256sum` format.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const file = join(dir, 'copeybara-kit.html');
const hex = createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(`${file}.sha256`, `${hex}  copeybara-kit.html\n`);
console.log(`${hex}  copeybara-kit.html (${readFileSync(file).length} bytes)`);
