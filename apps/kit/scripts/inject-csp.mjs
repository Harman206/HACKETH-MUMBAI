// Pins the single inline script by hash in a CSP <meta>, placed as the first element of <head>,
// and renames the output to copeybara-kit.html. Fails if the build has anything but one inline script.
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const src = join(dir, 'index.html');
let html = readFileSync(src, 'utf8');

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error(`expected exactly one <script>, found ${scripts.length}`);
if (/\ssrc=/.test(scripts[0][1])) throw new Error('script must be inline');
if (/<link[^>]*rel=["']?(stylesheet|modulepreload)/.test(html)) throw new Error('external stylesheet/preload left in build');

const hash = createHash('sha256').update(scripts[0][2], 'utf8').digest('base64');
const csp = [
  "default-src 'none'",
  `script-src 'sha256-${hash}'`,
  "style-src 'unsafe-inline'",
  'connect-src https: wss: http://127.0.0.1:* http://localhost:*',
  'img-src data:',
].join('; ');
if (!/<head>/.test(html)) throw new Error('no <head>');
html = html.replace(/<head>\s*/, `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n`);
writeFileSync(src, html);
renameSync(src, join(dir, 'copeybara-kit.html'));
console.log(`CSP pinned script sha256-${hash}`);
