import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envPort, serve } from './http';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const files: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript'],
};

export function startSite(port = envPort('SITE_PORT', 8081)) {
  return serve(port, (req, res) => {
    const f = files[(req.url ?? '/').split('?')[0]!];
    if (!f) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': f[1] }).end(readFileSync(join(DIR, f[0])));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) startSite().then(() => console.log('site up'));
