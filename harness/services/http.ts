import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>;

/** Tiny HTTP server with permissive CORS (the kit runs on another localhost origin). */
export function serve(port: number, handler: Handler, host = process.env.BIND_HOST ?? '127.0.0.1'): Promise<Server> {
  const s = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
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
