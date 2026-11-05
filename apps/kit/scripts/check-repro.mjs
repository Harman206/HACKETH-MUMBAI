// Builds the kit twice into fresh directories with SOURCE_DATE_EPOCH=0 and compares sha256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hashes = [];
for (let i = 0; i < 2; i++) {
  const out = mkdtempSync(join(tmpdir(), `kit-repro-${i}-`));
  const env = { ...process.env, SOURCE_DATE_EPOCH: '0', TZ: 'UTC', LC_ALL: 'C' };
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { env, stdio: 'pipe' });
  execFileSync('node', ['scripts/inject-csp.mjs', out], { env, stdio: 'pipe' });
  hashes.push(createHash('sha256').update(readFileSync(join(out, 'blackout-kit.html'))).digest('hex'));
}
if (hashes[0] !== hashes[1]) {
  console.log(`NOT REPRODUCIBLE ${hashes[0]} != ${hashes[1]}`);
  process.exit(1);
}
console.log(`REPRODUCIBLE ${hashes[0]}`);
