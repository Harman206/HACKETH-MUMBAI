import { request } from 'node:http';
import { envPort, serve } from './http';

export interface RouteState {
  siteUp: boolean;
  hijack: boolean;
}

/** demoswap.localhost → site, or → hijack clone when "DNS" is hijacked, or 502 when the site is down. */
export function startRouter(opts: { port?: number; sitePort: number; hijackPort: number; siteHost?: string; hijackHost?: string; state: () => RouteState }) {
  return serve(
    opts.port ?? envPort('ROUTER_PORT', 8080),
    (req, res, body) => {
      const s = opts.state();
      const target = s.hijack ? opts.hijackPort : s.siteUp ? opts.sitePort : null;
      const host = s.hijack ? (opts.hijackHost ?? '127.0.0.1') : (opts.siteHost ?? '127.0.0.1');
      if (target === null) {
        return void res
          .writeHead(502, { 'content-type': 'text/html' })
          .end('<!doctype html><title>502</title><h1>This site can’t be reached</h1><p>demoswap.localhost refused to connect.</p>');
      }
      const up = request({ host, port: target, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => res.writeHead(502).end('upstream down'));
      up.end(body);
    },
    '0.0.0.0',
  );
}
