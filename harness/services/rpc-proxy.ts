import { envPort, serve } from './http';

/** The protocol's "primary RPC": a plain forwarder. Stopping it must not stop an exit. */
export function startRpcProxy(opts: { port?: number; upstream: string }) {
  return serve(opts.port ?? envPort('RPC_PROXY_PORT', 8645), async (_req, res, body) => {
    const r = await fetch(opts.upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(await r.text());
  });
}
