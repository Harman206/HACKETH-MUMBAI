import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address } from 'viem';
import { envPort, json, serve } from './http';
import { startSite } from './site';
import { startRpcProxy } from './rpc-proxy';
import { startHijack, tamperKit } from './hijack';
import { hijackRequest } from './hijack-request';
import { startRouter, type RouteState } from './router';
import { assemble, checkHijackRequest, checkTamperedKit, drillReportHtml } from './drill-report';
import { createTheater, type TheaterDeps } from './theater';
import type { DrainRecord } from './drainer-bot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface HarnessOpts {
  primaryRpc: string;
  kitFile: string;
  ensName: string;
  ensRpcs: string[];
  universalResolver: Address;
  token: Address;
  chainId: number;
  /** The real demo drainer (sepolia-attack.json); the hijack asks victims to approve it. */
  drainer?: Address;
  ports?: Partial<{ control: number; router: number; site: number; hijack: number; rpc: number }>;
  /** 'process' closes the in-process server; 'docker' runs `docker stop <service>`. */
  mode?: 'process' | 'docker';
  /** Attack Theater chain access (prepare victims, read balances, drains). Omit to disable /theater/*. */
  theater?: {
    network: TheaterDeps['network'];
    prepareVictim: TheaterDeps['prepareVictim'];
    readVictim: TheaterDeps['readVictim'];
    drains: () => DrainRecord[];
    verifyKits?: TheaterDeps['verifyKits'];
    /** token address → symbol, for the scoreboard */
    tokens?: Record<string, string>;
  };
  /** Public URL of the kit server (the launcher serves it). */
  kitUrl?: string;
}

export async function startHarness(o: HarnessOpts) {
  const p = {
    control: o.ports?.control ?? envPort('CONTROL_PORT', 8090),
    router: o.ports?.router ?? envPort('ROUTER_PORT', 8080),
    site: o.ports?.site ?? envPort('SITE_PORT', 8081),
    hijack: o.ports?.hijack ?? envPort('HIJACK_PORT', 8082),
    rpc: o.ports?.rpc ?? envPort('RPC_PROXY_PORT', 8645),
  };
  const mode = o.mode ?? (process.env.HARNESS_MODE as 'docker' | undefined) ?? 'process';
  const route: RouteState = { siteUp: true, hijack: false };
  const failures: { kind: string; at: number }[] = [];
  let kitReport: unknown = null;
  mkdirSync(join(ROOT, '.state'), { recursive: true });
  const tamperedFile = join(ROOT, '.state', 'tampered-kit.html');
  writeFileSync(tamperedFile, tamperKit(readFileSync(o.kitFile)));

  let site: Server | null = null;
  let rpc: Server | null = null;
  const up = async () => {
    site ??= mode === 'process' ? await startSite(p.site) : null;
    rpc ??= mode === 'process' ? await startRpcProxy({ port: p.rpc, upstream: o.primaryRpc }) : null;
  };
  await up();
  const hijack = mode === 'process' ? await startHijack({ port: p.hijack, kitFile: o.kitFile, token: o.token, drainer: o.drainer }) : null;
  // In docker mode site/hijack/rpc-proxy are separate containers reached by service name.
  const router = await startRouter({
    port: p.router, sitePort: p.site, hijackPort: p.hijack, state: () => route,
    ...(mode === 'docker' ? { siteHost: 'site', hijackHost: 'hijack' } : {}),
  });

  const close = (s: Server | null) =>
    new Promise<void>((r) => {
      if (!s) return r();
      s.closeAllConnections();
      s.close(() => r());
    });
  const docker = (...args: string[]) => execFileSync('docker', args, { stdio: 'ignore' });

  const switches: Record<string, () => Promise<void>> = {
    'site-down': async () => {
      route.siteUp = false;
      if (mode === 'docker') docker('stop', 'site');
      else await close(site), (site = null);
      failures.push({ kind: 'site-down', at: Date.now() });
    },
    'rpc-down': async () => {
      if (mode === 'docker') docker('stop', 'rpc-proxy');
      else await close(rpc), (rpc = null);
      failures.push({ kind: 'rpc-down', at: Date.now() });
    },
    'hijack-on': async () => {
      route.hijack = true;
      failures.push({ kind: 'hijack-on', at: Date.now() });
    },
    reset: async () => {
      route.siteUp = true;
      route.hijack = false;
      failures.length = 0;
      kitReport = null;
      if (mode === 'docker') docker('start', 'site', 'rpc-proxy');
      else await up();
    },
  };

  const theater = o.theater
    ? createTheater({
        network: o.theater.network,
        prepareVictim: o.theater.prepareVictim,
        readVictim: o.theater.readVictim,
        drains: o.theater.drains,
        verifyKits:
          o.theater.verifyKits ??
          (async () => ({ real: checkTamperedKit(o.kitFile, o.ensName, o.ensRpcs).output, tampered: checkTamperedKit(tamperedFile, o.ensName, o.ensRpcs).output })),
        switches: () => ({ site: route.siteUp ? 'up' : 'down', rpc: mode === 'docker' || rpc ? 'up' : 'down', hijack: route.hijack }),
        rescue: () => kitReport,
      })
    : null;

  const control = await serve(p.control, async (req, res, body) => {
    // (bound to 0.0.0.0 in docker so the judge's browser can reach it)
    const path = (req.url ?? '/').split('?')[0]!;
    if (req.method === 'GET' && path === '/') return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(ROOT, 'control', 'index.html')));
    if (req.method === 'POST' && path.startsWith('/switch/')) {
      const sw = switches[path.slice('/switch/'.length)];
      if (!sw) return json(res, { error: 'unknown switch' }, 404);
      await sw();
      return json(res, { ok: true });
    }
    if (path === '/status') {
      const reach = async (u: string) => fetch(u, { method: 'POST', body: '{}', signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
      const siteUp = mode === 'docker' ? route.siteUp && (await reach(`http://site:${p.site}/`)) : route.siteUp && !!site;
      const rpcUp = mode === 'docker' ? await reach(`http://rpc-proxy:${p.rpc}/`) : !!rpc;
      return json(res, { site: siteUp ? 'up' : 'down', rpc: rpcUp ? 'up' : 'down', hijack: route.hijack, failures });
    }
    if (path === '/failures') return json(res, failures);
    if (path.startsWith('/theater/')) {
      if (!theater) return json(res, { error: 'theater not configured' }, 404);
      if (path === '/theater/state')
        return json(res, {
          ...(await theater.state()),
          failures,
          ensName: o.ensName,
          tokens: o.theater?.tokens ?? {},
          links: { demoswap: `http://demoswap.localhost:${p.router}`, kit: o.kitUrl ?? 'http://localhost:8000', control: `http://localhost:${p.control}` },
        });
      if (path === '/theater/hijack-request') return json(res, hijackRequest(o.token, o.drainer));
      if (req.method === 'POST' && path === '/theater/verify') return json(res, await theater.verify());
      if (req.method === 'POST' && path === '/theater/prepare') {
        try {
          const { victim } = JSON.parse(body || '{}');
          return json(res, await theater.prepare(victim));
        } catch (e) {
          const err = e as Error & { shortMessage?: string; details?: string };
          const m = err.shortMessage ? `${err.shortMessage}${err.details ? ` (${err.details})` : ''}` : err.message.split('\n')[0]!;
          return json(res, { error: m }, /cap reached/.test(m) ? 429 : /must be an address/.test(m) ? 400 : 500);
        }
      }
      return json(res, { error: 'unknown theater route' }, 404);
    }
    if (req.method === 'POST' && path === '/kit-report') {
      kitReport = JSON.parse(body);
      return json(res, { ok: true });
    }
    if (path === '/drill-report.json' || path === '/drill-report.html') {
      const tamper = checkTamperedKit(tamperedFile, o.ensName, o.ensRpcs);
      const hj = await checkHijackRequest(hijackRequest(o.token, o.drainer) as never, o.ensName, o.ensRpcs, o.universalResolver, o.chainId).catch((e) => ({ rejected: false, sentences: [String(e)] }));
      const r = assemble(failures, kitReport as never, tamper, hj);
      return path.endsWith('.json') ? json(res, r) : void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(drillReportHtml(r));
    }
    res.writeHead(404).end();
  });

  return {
    ports: p,
    tamperedFile,
    stop: async () => {
      await Promise.all([close(site), close(rpc), close(hijack), close(router), close(control)]);
    },
  };
}
