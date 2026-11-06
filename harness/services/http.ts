import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>;

/** Local origins only: the kit, the website, DemoSwap and the control page all run on localhost. */
export const isLocalOrigin = (o: string | undefined) => !o || /^http:\/\/((localhost|127\.0\.0\.1)|[a-z0-9-]+\.localhost)(:\d+)?$/.test(o);

/**
 * Tiny HTTP server. CORS is limited to local origins (echoed, never '*'); any state-changing request from
 * another website is refused, so a malicious page in the operator's browser cannot drive the demo.
 */
export function serve(port: number, handler: Handler, host = process.env.BIND_HOST ?? '127.0.0.1'): Promise<Server> {
  const s = createServer((req, res) => {
    const origin = req.headers.origin;
    const local = isLocalOrigin(origin);
    if (origin && local) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return void res.writeHead(local ? 204 : 403).end();
    if (!local && req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden origin');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      Promise.resolve(handler(req, res, body)).catch((e) => {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(String(e));
      });
    });
  });
  return new Promise((r) => s.listen(port, host, () => r(s)));
}

export const json = (res: ServerResponse, v: unknown, status = 200) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export const envPort = (name: string, dflt: number) => Number(process.env[name] ?? dflt);
