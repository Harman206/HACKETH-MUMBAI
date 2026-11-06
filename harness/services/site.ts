import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envPort, serve } from './http';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const files: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript'],
};

/** The demo bar's control-server URL lives in a <meta> (markup, not code: the script fingerprint does not change). */
export const withControl = (html: string, controlUrl?: string) =>
  controlUrl ? html.replace('<meta name="copeybara-demo-control" content="http://localhost:8090">', `<meta name="copeybara-demo-control" content="${controlUrl}">`) : html;

export function startSite(port = envPort('SITE_PORT', 8081), controlUrl?: string) {
  return serve(port, (req, res) => {
    const f = files[(req.url ?? '/').split('?')[0]!];
    if (!f) return void res.writeHead(404).end();
    const body = readFileSync(join(DIR, f[0]));
    res.writeHead(200, { 'content-type': f[1] }).end(f[0] === 'index.html' ? withControl(body.toString('utf8'), controlUrl) : body);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) startSite().then(() => console.log('site up'));
