import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeOpts {
  chainId?: number;
  block?: number;
  /** eth_call result, or a function of (params) */
  callResult?: string | ((params: unknown[]) => string);
  callError?: { code: number; message: string; data?: string };
  delayMs?: number;
  status?: number;
  receipt?: unknown;
  balance?: string;
}

export interface Fake {
  url: string;
  calls: { method: string; params: unknown[] }[];
  set(o: Partial<FakeOpts>): void;
  close(): Promise<void>;
}

export async function fakeRpc(initial: FakeOpts = {}): Promise<Fake> {
  let o: FakeOpts = { chainId: 11155111, block: 100, callResult: '0x01', ...initial };
  const calls: Fake['calls'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const { id, method, params } = JSON.parse(body);
      calls.push({ method, params });
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (o.status && o.status !== 200) {
        res.writeHead(o.status).end('nope');
        return;
      }
      const reply = (payload: object) => {
        if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, ...payload }));
      };
      switch (method) {
        case 'eth_chainId':
          return reply({ result: `0x${o.chainId!.toString(16)}` });
        case 'eth_blockNumber':
          return reply({ result: `0x${o.block!.toString(16)}` });
        case 'eth_call':
          if (o.callError) return reply({ error: o.callError });
          return reply({ result: typeof o.callResult === 'function' ? o.callResult(params) : o.callResult });
        case 'eth_getBalance':
          return reply({ result: o.balance ?? '0x0' });
        case 'eth_getTransactionReceipt':
          return reply({ result: o.receipt ?? null });
        default:
          return reply({ error: { code: -32601, message: 'method not found' } });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    set: (n) => (o = { ...o, ...n }),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
