/**
 * B3: frontend-hijack incidents through the product's own site-fingerprint code (@copeybara/sitecheck: fetchCodeItems,
 * scriptHash, checkScripts — the watcher's static path; the extension's live path hashes the same <script> elements) and
 * the drainer request through classifyRequest.
 *   ../../node_modules/.bin/tsx bench/bench-b3.ts
 * Evidence used (see docs/benchmarks/b3-frontend-hijacks.md for what is real vs reconstructed):
 *   Ledger Connect Kit: the real 1.1.4–1.1.12 bytes, still served by cdn.jsdelivr.net (1.1.5–1.1.7 are the malicious ones)
 *   Balancer: Wayback captures of app.balancer.fi before (2023-09-08), during (2023-09-20 04:40 UTC) and after (2023-09-23)
 *   Curve: Wayback captures of curve.fi (2022-08-04 / 08-09 / 08-11); none holds the injected code, so the injection is reconstructed
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeFunctionData, maxUint256, parseAbi } from 'viem';
import { checkScripts, fetchCodeItems, scriptHash, type CodeItem, type FetchText } from '../../sitecheck/src/index';
import { classifyRequest } from '../src/index';
import { CACHE, REPO, writeJson } from './lib';

const dir = join(CACHE, 'b3');
mkdirSync(dir, { recursive: true });
async function get(url: string, tries = 4): Promise<{ ok: boolean; status: number; body: string }> {
  const p = join(dir, createHash('sha256').update(url).digest('hex').slice(0, 24));
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(240_000) });
      const v = { ok: r.ok, status: r.status, body: await r.text() };
      if (r.ok || r.status === 404 || r.status === 403) {
        writeFileSync(p, JSON.stringify(v));
        return v;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { ok: false, status: 0, body: '' };
}
/** The watcher's fetch, pointed at the Wayback Machine as of `ts` (raw bytes: the id_ flag). */
const wayback = (ts: string): FetchText => async (url) => {
  const r = await get(`https://web.archive.org/web/${ts}id_/${url}`);
  return { ok: r.ok, status: r.status, text: async () => r.body };
};
const hashes = (items: CodeItem[]) => items.filter((i) => i.hash).map((i) => i.hash!);
const ctx = { account: '0xb30Ca7383DBd1aC31459E8e1De3BCb022A1Db001' as const, chainId: 1, manifests: [] };
const erc20 = parseAbi(['function approve(address,uint256)', 'function setApprovalForAll(address,bool)']);
const out: any[] = [];
const row = (incident: string, state: string, evidence: string, items: CodeItem[], allowed: string[] | null, expect: string) => {
  const r = checkScripts(items, allowed);
  out.push({ incident, state, evidence, scripts: items.length, verdict: r.verdict, unknown: r.unknown.map((u) => u.label), unreadable: r.unreadable.map((u) => u.label), expect });
  console.log(incident, '|', state, '|', r.verdict, r.unknown.map((u) => u.label));
};

async function ledger() {
  const v = (x: string) => `https://cdn.jsdelivr.net/npm/@ledgerhq/connect-kit@${x}/dist/umd/index.js`;
  const ck = async (x: string): Promise<CodeItem> => {
    const r = await get(v(x));
    return { kind: 'src', label: 'https://cdn.jsdelivr.net/npm/@ledgerhq/connect-kit@1', hash: r.ok ? await scriptHash(r.body) : null };
  };
  // The dapp's own entry bundle stays the same across the incident; only the loader's floating "@1" target changes.
  const app: CodeItem = { kind: 'src', label: 'https://dapp.example/assets/index.js', hash: await scriptHash('/* dapp bundle that calls loadConnectKit() */') };
  // connect-kit 1.1.5 / 1.1.6 add a <script src> for the second stage; the extension sees that element too.
  const stage2Url = 'https://cdn.jsdelivr.net/npm/2e6d5f64604be31/2e6d5f64604be31.js';
  const s2 = await get(stage2Url);
  const stage2: CodeItem = { kind: 'src', label: stage2Url, hash: s2.ok ? await scriptHash(s2.body) : null };
  const allowed = [app.hash!, (await ck('1.1.4')).hash!];
  const marker = async (x: string) => {
    const b = (await get(v(x))).body;
    return { bytes: b.length, injectsStage2: b.includes('2e6d5f64604be31'), permitStrings: (b.match(/permit/gi) ?? []).length };
  };
  for (const [x, label, ev] of [
    ['1.1.4', 'before (published set = app + 1.1.4)', 'real bytes'],
    ['1.1.5', 'malicious 1.1.5 (legit code + stage-2 loader)', 'real bytes; stage 2 now 403'],
    ['1.1.6', 'malicious 1.1.6 (loader only)', 'real bytes; stage 2 now 403'],
    ['1.1.7', 'malicious 1.1.7 (inlined drainer)', 'real bytes'],
    ['1.1.8', 'fixed 1.1.8 (legit, not yet re-published)', 'real bytes'],
    ['1.1.9', 'legit 1.1.9 (Jan 2024)', 'real bytes'],
    ['1.1.12', 'legit 1.1.12 (Feb 2024)', 'real bytes'],
  ] as const) {
    const m = await marker(x);
    const items = [app, await ck(x), ...(m.injectsStage2 ? [stage2] : [])];
    row('Ledger Connect Kit (2023-12-14)', `${label} [${m.bytes} B${m.injectsStage2 ? ', injects stage 2' : ''}]`, ev, items, allowed, x === '1.1.4' ? 'match' : 'mismatch');
  }
}

async function balancer() {
  const page = 'https://app.balancer.fi/';
  const before = await fetchCodeItems(page, wayback('20230908044217'));
  const allowed = hashes(before);
  row('Balancer (2023-09-19/20, EuroDNS)', 'before, 2023-09-08 capture (published set)', 'real Wayback capture', before, allowed, 'match');
  row('Balancer (2023-09-19/20, EuroDNS)', 'during, 2023-09-20 04:40 UTC capture: hijacked host behind Cloudflare "Suspected phishing" interstitial', 'real Wayback capture', await fetchCodeItems(page, wayback('20230920044009')), allowed, 'mismatch');
  row('Balancer (2023-09-19/20, EuroDNS)', 'after, 2023-09-23 capture (legit redeploy, new bundle)', 'real Wayback capture', await fetchCodeItems(page, wayback('20230923044542')), allowed, 'mismatch until re-published');
}

async function curve() {
  const page = 'https://curve.fi/';
  const legit = await fetchCodeItems(page, wayback('20220809110612'));
  const allowed = hashes(legit);
  row('Curve (2022-08-09, iwantmyname DNS)', 'before, 2022-08-09 11:06 UTC capture (published set)', 'real Wayback capture', legit, allowed, 'match');
  row('Curve (2022-08-09, iwantmyname DNS)', 'hijack window, 2022-08-09 20:51 UTC capture', 'real Wayback capture (Wayback reached the legit origin: same bytes)', await fetchCodeItems(page, wayback('20220809205113')), allowed, 'match (capture is not the attacker’s copy)');
  // Reconstructed: the cloned site served the same HTML with a modified app bundle that asks for approve(drainer, amount).
  const appJs = (await get('https://web.archive.org/web/20220804122538id_/https://curve.fi/js/app.9b0312df.js')).body;
  const injected = appJs + `\n;(()=>{/* reconstructed injection */const d='0x9Eb5F8e83359Bb5013f3D8eee60bDCe5654e8881';window.__drain=d})();`;
  const tampered = legit.map((i) => (i.label.endsWith('/js/app.9b0312df.js') ? { ...i, hash: null as string | null } : i));
  const tamperedItems = await Promise.all(tampered.map(async (i) => (i.hash === null ? { ...i, hash: await scriptHash(injected) } : i)));
  row('Curve (2022-08-09, iwantmyname DNS)', 'hijacked clone: same HTML and file names, app.9b0312df.js modified', 'RECONSTRUCTED injection on real legit bytes', tamperedItems, allowed, 'mismatch');
  const fx = JSON.parse(readFileSync(join(REPO, 'replay', 'fixtures', 'R1.json'), 'utf8'));
  return classifyRequest({ method: 'eth_sendTransaction', params: [{ from: fx.victim, to: fx.approveTarget, data: fx.approveCalldata, value: '0x0' }] }, { ...ctx, account: fx.victim });
}

/** Evasions of the static (watcher) path, with a local server and the real fetchCodeItems. */
async function evasions() {
  const legitChunk = 'export const connect = () => window.ethereum.request({ method: "eth_requestAccounts" });';
  const evilChunk = 'export const connect = async () => { await window.ethereum.request({ method: "eth_sendTransaction", params: [/* approve(drainer) */] }); };';
  const entry = 'import("/assets/wallet-chunk.js").then((m) => (window.connect = m.connect));';
  const html = '<!doctype html><script type="module" src="/assets/index.js"></script>';
  const srv = createServer((req, res) => {
    const browser = /Mozilla/.test(req.headers['user-agent'] ?? '');
    if (req.url === '/') return res.end(html);
    if (req.url === '/assets/index.js') return res.end(entry);
    if (req.url === '/assets/wallet-chunk.js') return res.end(evilChunk);
    if (req.url === '/cloak/') return res.end('<!doctype html><script src="/cloak/app.js"></script>');
    if (req.url === '/cloak/app.js') return res.end(browser ? legitChunk + '\n/* + drainer */' : legitChunk);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  const nodeFetch: FetchText = async (u) => {
    const r = await fetch(u);
    return { ok: r.ok, status: r.status, text: () => r.text() };
  };
  const allowedE2 = [await scriptHash(entry)];
  row('Evasion E2 (synthetic)', 'lazy chunk loaded with import(): only the chunk is malicious', 'synthetic page, real fetchCodeItems/checkScripts', await fetchCodeItems(`${base}/`, nodeFetch), allowedE2, 'should be mismatch');
  const allowedE1 = [await scriptHash(legitChunk)];
  row('Evasion E1 (synthetic)', 'server cloaks by User-Agent: browsers get the drainer, the watcher gets clean bytes', 'synthetic server, real fetchCodeItems/checkScripts', await fetchCodeItems(`${base}/cloak/`, nodeFetch), allowedE1, 'should be mismatch');
  srv.close();
}

async function main() {
  await ledger();
  await balancer();
  const r1 = await curve();
  await evasions();
  const reqs = [
    { incident: 'Curve 2022', evidence: 'real calldata (replay/fixtures/R1.json, tx 0xec72bb41…)', c: r1 },
    { incident: 'Ledger Connect Kit 2023 (Angel Drainer)', evidence: 'RECONSTRUCTED approve to the customer address ZachXBT attributed (0x6587…5c2d)', c: classifyRequest({ method: 'eth_sendTransaction', params: [{ from: ctx.account, to: '0xdAC17F958D2ee523a2206206994597C13D831ec7', data: encodeFunctionData({ abi: erc20, functionName: 'approve', args: ['0x658729879fca881d9526480b82ae00efc54b5c2d', maxUint256] }) }] }, ctx) },
    { incident: 'Ledger Connect Kit 2023 (Angel Drainer)', evidence: 'RECONSTRUCTED Permit2 PermitBatch to the same address', c: classifyRequest({ method: 'eth_signTypedData_v4', params: [ctx.account, JSON.stringify({ domain: { name: 'Permit2', chainId: 1, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' }, primaryType: 'PermitBatch', types: { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }], PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }] }, message: { details: [{ token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', amount: (2n ** 160n - 1n).toString(), expiration: '1735689600', nonce: '0' }], spender: '0x658729879fca881d9526480b82ae00efc54b5c2d', sigDeadline: '1735689600' } })] }, ctx) },
    { incident: 'Balancer 2023 / Squarespace 2024', evidence: 'no drainer request published in a primary source; see B1 for the kits (Angel/Inferno) these used', c: null },
  ];
  writeJson('b3-results.json', { checks: out, requests: reqs.map((r) => ({ ...r, c: r.c && { verdict: r.c.verdict, reason: r.c.reasons[0] } })) });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
