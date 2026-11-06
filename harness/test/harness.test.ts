import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeRpc, type Fake } from '../../packages/quorum/test/fake-rpc';
import { startHarness } from '../services/control';

const free = () => new Promise<number>((r) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => r(p)); }); });

let upstream: Fake;
let h: Awaited<ReturnType<typeof startHarness>>;
let kitFile: string;
const ports = { control: 0, router: 0, site: 0, hijack: 0, rpc: 0 };
const get = (port: number, path = '/', host = 'demoswap.localhost') => fetch(`http://127.0.0.1:${port}${path}`, { headers: { host } });
const post = (path: string) => fetch(`http://127.0.0.1:${ports.control}${path}`, { method: 'POST' });

beforeAll(async () => {
  upstream = await fakeRpc({ chainId: 11155111 });
  for (const k of Object.keys(ports) as (keyof typeof ports)[]) ports[k] = await free();
  kitFile = join(mkdtempSync(join(tmpdir(), 'h-')), 'copeybara-kit.html');
  writeFileSync(kitFile, '<!doctype html><html><head><title>Copeybara exit kit</title></head><body>kit</body></html>');
  h = await startHarness({
    primaryRpc: upstream.url, kitFile, ensName: 'x.eth', ensRpcs: ['http://127.0.0.1:1'], chainId: 11155111,
    universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe', token: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', ports, mode: 'process',
    drainer: '0x00000000000000000000000000000000000d7a1e',
    watcherUrl: 'http://127.0.0.1:1/', // never the developer's live watcher on :8095
    theater: {
      network: 'sepolia',
      prepareVictim: async () => ['0x01'],
      readVictim: async () => ({ dusd: '10,000', positions: ['1'] }),
      drains: () => [],
      verifyKits: async () => ({ real: 'MATCH v=3', tampered: 'MISMATCH' }),
    },
  });
});
afterAll(async () => { await h?.stop(); await upstream?.close(); });

describe('fire drill harness', () => {
  test('router serves DemoSwap, which loads several third-party origins', async () => {
    const html = await (await get(ports.router)).text();
    expect(html).toContain('Provide liquidity. Earn fees.');
    const origins = new Set([...html.matchAll(/(?:src|href)="(https:\/\/[^/"]+)/g)].map((m) => m[1]));
    expect(origins.size).toBeGreaterThanOrEqual(4);
  });

  test('primary RPC proxy forwards to the upstream', async () => {
    const r = await fetch(`http://127.0.0.1:${ports.rpc}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    expect((await r.json()).result).toBe('0xaa36a7');
  });

  test('tampered kit differs and fails the independent verifier', () => {
    const real = readFileSync(kitFile);
    const bad = readFileSync(h.tamperedFile);
    expect(bad.equals(real)).toBe(false);
    expect(bad.length).toBe(real.length);
    const hex = createHash('sha256').update(real).digest('hex');
    const r = spawnSync('bash', [join(__dirname, '../../scripts/verify-kit.sh'), h.tamperedFile, 'x.eth'], { env: { ...process.env, COPEYBARA_RELEASE_OVERRIDE: `sha256:${hex};v=1` }, encoding: 'utf8' });
    expect(r.status).toBe(1);
  });

  test('switches: site down → 502, RPC down → refused, hijack → clone with injected approve; failures are timestamped', async () => {
    expect((await (await post('/switch/site-down')).json()).ok).toBe(true);
    expect((await get(ports.router)).status).toBe(502);
    await expect(fetch(`http://127.0.0.1:${ports.site}/`)).rejects.toThrow();

    await post('/switch/rpc-down');
    await expect(fetch(`http://127.0.0.1:${ports.rpc}`, { method: 'POST', body: '{}' })).rejects.toThrow();

    await post('/switch/hijack-on');
    const hijacked = await (await get(ports.router)).text();
    expect(hijacked).toContain('/inject.js');
    expect(hijacked).toContain('0x095ea7b3'); // approve selector in the injected request
    expect(await (await get(ports.router, '/copeybara-kit.html')).text()).toContain('Copeybara exit klt');

    const status = await (await fetch(`http://127.0.0.1:${ports.control}/status`)).json();
    expect(status).toMatchObject({ site: 'down', rpc: 'down', hijack: true });
    const failures = await (await fetch(`http://127.0.0.1:${ports.control}/failures`)).json();
    expect(failures.map((f: { kind: string }) => f.kind)).toEqual(['site-down', 'rpc-down', 'hijack-on']);
    expect(failures.every((f: { at: number }) => f.at > 0)).toBe(true);
  });

  test('reset brings everything back', async () => {
    await post('/switch/reset');
    expect((await get(ports.router)).status).toBe(200);
    expect(await (await get(ports.router)).text()).not.toContain('/inject.js');
    const r = await fetch(`http://127.0.0.1:${ports.rpc}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    expect(r.status).toBe(200);
  });

  test('control page has the three switches', async () => {
    const html = await (await fetch(`http://127.0.0.1:${ports.control}/`)).text();
    for (const s of ['site-down', 'rpc-down', 'hijack-on']) expect(html).toContain(`data-switch="${s}"`);
  });

  test('Demo Portal: GET / is the portal with the 7 scenarios; config links point at this harness', async () => {
    const html = await (await fetch(`http://127.0.0.1:${ports.control}/`)).text();
    expect(html).toContain('Copeybara Demo Portal');
    for (const s of ['verified', 'hijack', 'lookalike', 'approve', 'permit', 'nft', 'down']) expect(html).toContain(`id: '${s}'`);
    expect(html).toContain('data-guide'); // presenter mode
    // no external scripts or images; stylesheets only from Google Fonts (brand fonts)
    expect(html).not.toMatch(/<(?:script|img)[^>]+src="https?:/);
    for (const m of html.matchAll(/<link[^>]+href="(https?:[^"]+)"/g)) expect(m[1]!.startsWith('https://fonts.googleapis.com')).toBe(true);
    for (const mood of ['verified', 'worried', 'protected']) expect(html).toContain(`mood: '${mood}'`);
    const img = await fetch(`http://127.0.0.1:${ports.control}/brand/copey-worried.png`);
    expect([img.status, img.headers.get('content-type')]).toEqual([200, 'image/png']);
    expect((await fetch(`http://127.0.0.1:${ports.control}/brand/..%2Fpackage.json`)).status).toBe(404);
    const cfg = await (await fetch(`http://127.0.0.1:${ports.control}/portal/config`)).json();
    expect(cfg).toMatchObject({
      ensName: 'x.eth',
      links: {
        site: `http://demoswap.localhost:${ports.router}`,
        lookalike: `http://demoswap-rewards.localhost:${ports.hijack}/`,
        approve: `http://demoswap-airdrop.localhost:${ports.control}/drainer`,
        permit: `http://demoswap-airdrop.localhost:${ports.control}/permit`,
        nft: `http://demoswap-airdrop.localhost:${ports.control}/nft`,
        hostedKit: 'https://blackout-red.vercel.app/copeybara-kit.html?ens=x.eth',
      },
    });
    // ENS unreadable (dead RPCs) and no watcher: reported, never a 500
    expect(await (await fetch(`http://127.0.0.1:${ports.control}/portal/ens`)).json()).toMatchObject({ ok: false, name: 'x.eth' });
    expect(await (await fetch(`http://127.0.0.1:${ports.control}/portal/watcher`)).json()).toMatchObject({ running: false });
  });

  const page = async (path: string) => {
    const r = await fetch(`http://127.0.0.1:${ports.control}${path}`, { headers: { host: `demoswap-airdrop.localhost:${ports.control}` } });
    expect(r.status).toBe(200);
    const html = await r.text();
    return { html, req: JSON.parse(html.match(/const REQ = (\{[^\n]+\});/)![1]!) };
  };
  const DRAINER = '00000000000000000000000000000000000d7a1e';

  test('Demo Portal: /drainer asks the wallet for approve(<drainer>, max) on the demo token', async () => {
    const { html, req } = await page('/drainer');
    expect(html).toContain('data-attack-page="approve"');
    expect(html).toContain('eth_sendTransaction');
    expect(req.tx.to).toBe('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');
    expect(req.tx.data.slice(0, 10)).toBe('0x095ea7b3');
    expect(req.tx.data.toLowerCase()).toContain(DRAINER);
    expect(req.tx.data.endsWith('f'.repeat(64))).toBe(true);
  });

  test('Demo Portal: /permit asks for a Permit2 PermitSingle signature with the drainer as spender', async () => {
    const { html, req } = await page('/permit');
    expect(html).toContain('eth_signTypedData_v4');
    expect(req.typedData).toMatchObject({ primaryType: 'PermitSingle', domain: { name: 'Permit2', chainId: 11155111, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' } });
    expect(req.typedData.message.spender.toLowerCase()).toContain(DRAINER);
    expect(req.typedData.message.details.token).toBe('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');
    expect(BigInt(req.typedData.message.details.amount)).toBe((1n << 160n) - 1n);
  });

  test('Demo Portal: /nft asks setApprovalForAll(<drainer>, true) on the LP position NFTs', async () => {
    const { req } = await page('/nft');
    expect(req.tx.to).toBe('0x1238536071E1c677A632429e3655c799b22cDA52');
    expect(req.tx.data.slice(0, 10)).toBe('0xa22cb465');
    expect(req.tx.data.toLowerCase()).toContain(DRAINER);
    expect(req.tx.data.endsWith('1')).toBe(true);
  });

  test('B3: the hijack asks approve(<drainer>, max) on the demo token, with the rewards lure', async () => {
    await post('/switch/hijack-on');
    const html = await (await get(ports.router)).text();
    expect(html).toContain('Approve to view your rewards');
    const req = await (await get(ports.router, '/hijack-request.json')).json();
    expect(req.to).toBe('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');
    expect(req.data.toLowerCase()).toContain('00000000000000000000000000000000000d7a1e');
    expect(req.data.slice(0, 10)).toBe('0x095ea7b3');
    await post('/switch/reset');
  });

  test('DemoSwap carries the Copeybara demo bar, pointed at this control server, identical on the hijacked clone', async () => {
    const real = await (await get(ports.router)).text();
    expect(real).toContain('id="demobar"');
    for (const m of ['normal', 'hijack', 'lookalike', 'approve', 'permit', 'nft', 'down']) expect(real).toContain(`data-mode="${m}"`);
    expect(real).toContain(`<meta name="copeybara-demo-control" content="http://localhost:${ports.control}">`);
    const clone = await (await get(ports.hijack, '/', 'demoswap-rewards.localhost')).text();
    expect(clone).toContain(`<meta name="copeybara-demo-control" content="http://localhost:${ports.control}">`);
    // same markup except the attacker's additions (lure banner + 2 scripts)
    const strip = (h: string) => h.replace(/<div class="lure">.*?<\/div>/, '<!--LURE-->').replace(/\n  <script>window.__HIJACK_REQUEST__.*\n  <script src="\/inject.js"><\/script>/, '');
    expect(strip(clone)).toBe(real);
    // the bar may drive the demo from DemoSwap's own origins (local-origin CORS)
    const r = await fetch(`http://127.0.0.1:${ports.control}/status`, { headers: { origin: `http://demoswap.localhost:${ports.router}` } });
    expect(r.headers.get('access-control-allow-origin')).toBe(`http://demoswap.localhost:${ports.router}`);
  });

  test('B3: the real DemoSwap never asks for an approval', async () => {
    const html = await (await get(ports.router)).text();
    expect(html).not.toContain('inject.js');
    expect(html).not.toContain('Approve to view your rewards');
    expect(html).toContain('Your liquidity');
  });

  test('B4: theater endpoints — state, prepare (400 on bad victim), verify, hijack request', async () => {
    const st = await (await fetch(`http://127.0.0.1:${ports.control}/theater/state`)).json();
    expect(st).toMatchObject({ network: 'sepolia', chapter: 1, victim: null, ensName: 'x.eth', links: { kit: 'http://localhost:8000', control: `http://localhost:${ports.control}` } });
    expect((await fetch(`http://127.0.0.1:${ports.control}/theater/prepare`, { method: 'POST', body: '{"victim":"nope"}' })).status).toBe(400);
    const ok = await (await fetch(`http://127.0.0.1:${ports.control}/theater/prepare`, { method: 'POST', body: JSON.stringify({ victim: '0x1111111111111111111111111111111111111111' }) })).json();
    expect(ok).toEqual({ txs: ['0x01'] });
    expect(await (await fetch(`http://127.0.0.1:${ports.control}/theater/verify`, { method: 'POST' })).json()).toEqual({ real: 'MATCH v=3', tampered: 'MISMATCH' });
    const after = await (await fetch(`http://127.0.0.1:${ports.control}/theater/state`)).json();
    expect(after).toMatchObject({ victim: '0x1111111111111111111111111111111111111111', victimDusd: '10,000', verify: { real: 'MATCH v=3' } });
    expect((await (await fetch(`http://127.0.0.1:${ports.control}/theater/hijack-request`)).json()).data.slice(0, 10)).toBe('0x095ea7b3');
  });

  test('review #1: control actions refuse requests from other websites (Origin allow-list, no wildcard CORS)', async () => {
    const evil = await fetch(`http://127.0.0.1:${ports.control}/switch/site-down`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const prep = await fetch(`http://127.0.0.1:${ports.control}/theater/prepare`, { method: 'POST', headers: { origin: 'http://attacker.localhost.evil.com' }, body: '{"victim":"0x2222222222222222222222222222222222222222"}' });
    expect(prep.status).toBe(403);
    const status = await (await fetch(`http://127.0.0.1:${ports.control}/status`)).json();
    expect(status.site).toBe('up');
    const ok = await fetch(`http://127.0.0.1:${ports.control}/switch/reset`, { method: 'POST', headers: { origin: 'http://localhost:4173' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
  });
});
