// sha256 of a site bundle after the same normalisation the kit applies (apps/kit/src/check.ts normaliseBundle).
//   node scripts/site-hash.mjs harness/site/app.js   → prints sha256:<hex>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const normaliseBundle = (t) => t.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n';
const text = readFileSync(process.argv[2], 'utf8');
console.log(`sha256:${createHash('sha256').update(normaliseBundle(text), 'utf8').digest('hex')}`);
