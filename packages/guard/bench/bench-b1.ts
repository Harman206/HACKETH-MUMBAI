/**
 * B1: run Copeybara's real classifyRequest over the collected request sets and write docs/benchmarks/b1-drainer-requests.md.
 *   ../../node_modules/.bin/tsx bench/bench-b1.ts
 * Scenarios (what the extension knows):
 *   S0  fresh install, built-in well-known table OFF, follows nothing
 *   S1  fresh install (shipped default): built-in well-known table, follows nothing
 *   S2  S1 + follows the published mainnet manifest (config/manifest.json: Aave v3, Curve 3pool, Uniswap v3/v4 exit targets)
 *   S3  S2 with only the old Uniswap-only table (what the first run called S2), to show what the table extension buys
 * Alarm thresholds: "red" = dangerous; "any" = dangerous or risky (the extension stops and explains both).
 * The first run (before the gap fixes) is kept in data/b1-results-before.json and shown as a before → after table.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { KNOWN_CONTRACTS, parseManifest, type KnownTable } from '@copeybara/core';
import { classifyRequest, type ClassifyCtx, type RequestVerdict } from '../src/index';
import { DATA, readJson, REPO, sha256File, writeJson } from './lib';

const manifest = parseManifest(readFileSync(join(REPO, 'config', 'manifest.json'), 'utf8'));
const UNISWAP_ONLY: KnownTable = { v: 1, protocols: { Uniswap: KNOWN_CONTRACTS.protocols.Uniswap! } };
const SCEN: Record<string, (account: string) => ClassifyCtx> = {
  S0: (a) => ({ account: a as any, chainId: 1, manifests: [], known: { v: 1, protocols: {} } }),
  S1: (a) => ({ account: a as any, chainId: 1, manifests: [] }),
  S2: (a) => ({ account: a as any, chainId: 1, manifests: [{ name: 'copeybara mainnet manifest', manifest }] }),
  S3: (a) => ({ account: a as any, chainId: 1, manifests: [{ name: 'copeybara mainnet manifest', manifest }], known: UNISWAP_ONLY }),
};
const red = (v: RequestVerdict) => v === 'dangerous';
const any = (v: RequestVerdict) => v === 'dangerous' || v === 'risky';

interface Row { label?: string; set: string; id: string; category: string; provenance: string; malicious: boolean; tx: string; counterparty: string; verdicts: Record<string, RequestVerdict>; reason: string }

function run(set: string, reqs: any[], malicious: (r: any) => boolean): Row[] {
  return reqs.map((r) => {
    const verdicts: Record<string, RequestVerdict> = {};
    let reason = '';
    for (const [s, ctx] of Object.entries(SCEN)) {
      const c = classifyRequest(r.request, ctx(r.account));
      verdicts[s] = c.verdict;
      if (s === 'S1') reason = c.reasons[0] ?? '';
    }
    return { label: r.label, set, id: r.id, category: r.category, provenance: r.provenance, malicious: malicious(r), tx: r.tx, counterparty: r.counterparty, verdicts, reason };
  });
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '–');
function table(rows: Row[], groupBy: (r: Row) => string, s: string, pos: boolean) {
  const g = new Map<string, Row[]>();
  for (const r of rows) g.set(groupBy(r), [...(g.get(groupBy(r)) ?? []), r]);
  const lines = [`| ${pos ? 'category (malicious)' : 'category (benign)'} | n | dangerous | risky | unknown | known/exit/pass | ${pos ? 'detected (red)' : 'FP (red)'} | ${pos ? 'detected (any)' : 'FP (any)'} |`, '|---|---:|---:|---:|---:|---:|---:|---:|'];
  const tot = { n: 0, d: 0, r: 0, u: 0, o: 0 };
  for (const [k, rs] of [...g.entries()].sort()) {
    const c = (f: (v: RequestVerdict) => boolean) => rs.filter((x) => f(x.verdicts[s]!)).length;
    const d = c((v) => v === 'dangerous'), ri = c((v) => v === 'risky'), u = c((v) => v === 'unknown'), o = rs.length - d - ri - u;
    tot.n += rs.length; tot.d += d; tot.r += ri; tot.u += u; tot.o += o;
    lines.push(`| ${k} | ${rs.length} | ${d} | ${ri} | ${u} | ${o} | ${pct(d, rs.length)} | ${pct(d + ri, rs.length)} |`);
  }
  lines.push(`| **total** | **${tot.n}** | ${tot.d} | ${tot.r} | ${tot.u} | ${tot.o} | **${pct(tot.d, tot.n)}** | **${pct(tot.d + tot.r, tot.n)}** |`);
  return lines.join('\n');
}
function confusion(rows: Row[], s: string, f: (v: RequestVerdict) => boolean) {
  const tp = rows.filter((r) => r.malicious && f(r.verdicts[s]!)).length;
  const fn = rows.filter((r) => r.malicious && !f(r.verdicts[s]!)).length;
  const fp = rows.filter((r) => !r.malicious && f(r.verdicts[s]!)).length;
  const tn = rows.filter((r) => !r.malicious && !f(r.verdicts[s]!)).length;
  return { tp, fn, fp, tn, tpr: tp / (tp + fn), fpr: fp / (fp + tn), precision: tp / (tp + fp) };
}

const drain = readJson('b1-drainer-requests.json');
const benign = readJson('b1-benign-requests.json');
const ptx = readJson('b1-ptxphish-requests.json');
// The listed address acting on its own funds (from == to == listed) is the drainer's activity, not a victim request.
const listedOf = (r: any) => /ScamSniffer-listed (0x[0-9a-f]{40})/.exec(r.note ?? '')?.[1];
const selfRows = drain.requests.filter((r: any) => r.account.toLowerCase() === listedOf(r));
const drainReqs = drain.requests.filter((r: any) => r.account.toLowerCase() !== listedOf(r));
const rowsA = [...run('scamsniffer-drainers', drainReqs, (r) => !/revoke|\(false\)/.test(r.category)), ...run('recent-benign', benign.requests, () => false)];
const rowsB = run('ptxphish', ptx.requests, (r) => r.malicious);
const rev = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
const meta = { gitHead: rev, classifySha256: sha256File(join(REPO, 'packages/guard/src/classify.ts')), decodeSha256: sha256File(join(REPO, 'packages/guard/src/decode.ts')), knownContractsSha256: sha256File(join(REPO, 'config/known-contracts.json')), ranAt: new Date().toISOString() };
const results: any = { meta, A: {}, B: {} };
for (const s of Object.keys(SCEN)) {
  results.A[s] = { red: confusion(rowsA, s, red), any: confusion(rowsA, s, any) };
  results.B[s] = { red: confusion(rowsB, s, red), any: confusion(rowsB, s, any) };
}
writeJson('b1-results.json', { ...results, rows: [...rowsA, ...rowsB] });

const fmtC = (c: any) => `TP ${c.tp} · FN ${c.fn} · FP ${c.fp} · TN ${c.tn} → TPR ${pct(c.tp, c.tp + c.fn)}, FPR ${pct(c.fp, c.fp + c.tn)}, precision ${pct(c.tp, c.tp + c.fp)}`;
const misses = (rows: Row[], s: string) =>
  rows.filter((r) => r.malicious && !any(r.verdicts[s]!)).map((r) => `| ${r.label ?? r.set} | ${r.category} | ${r.verdicts[s]} | [${r.tx.slice(0, 12)}…](https://etherscan.io/tx/${r.tx}) | ${r.reason.replace(/\|/g, '/')} |`);
const fps = (rows: Row[], s: string) => {
  const g = new Map<string, number>();
  for (const r of rows.filter((x) => !x.malicious && any(x.verdicts[s]!))) g.set(`${r.category} → ${r.verdicts[s]} — ${r.reason.replace(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/g, '0x…').replace(/sending [\d,]+ units/, 'sending N units').replace(/sends \d+ NFTs/, 'sends N NFTs').replace(/\|/g, '/')}`, (g.get(`${r.category} → ${r.verdicts[s]} — ${r.reason.replace(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/g, '0x…').replace(/sending [\d,]+ units/, 'sending N units').replace(/sends \d+ NFTs/, 'sends N NFTs').replace(/\|/g, '/')}`) ?? 0) + 1);
  return [...g.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${n}× ${k}`);
};
const prov = (rows: Row[]) => {
  const g: Record<string, number> = {};
  for (const r of rows) g[r.provenance] = (g[r.provenance] ?? 0) + 1;
  return Object.entries(g).map(([k, v]) => `${k}: ${v}`).join(', ');
};

/** Before (first run, data/b1-results-before.json) → after (this run), for the shipped default S1. */
function beforeAfter(): string {
  const f = join(DATA, 'b1-results-before.json');
  if (!existsSync(f)) return '';
  const b = JSON.parse(readFileSync(f, 'utf8'));
  const cell = (c: any, pos: boolean) => (pos ? `${c.tp}/${c.tp + c.fn} (${pct(c.tp, c.tp + c.fn)})` : `${c.fp}/${c.fp + c.tn} (${pct(c.fp, c.fp + c.tn)})`);
  const row = (name: string, set: 'A' | 'B', s: string) =>
    `| ${name} | ${cell(b[set][s].red, true)} → **${cell(results[set][s].red, true)}** | ${cell(b[set][s].any, true)} → **${cell(results[set][s].any, true)}** | ${cell(b[set][s].red, false)} → **${cell(results[set][s].red, false)}** | ${cell(b[set][s].any, false)} → **${cell(results[set][s].any, false)}** |`;
  return [
    `### Before → after the gap fixes (first run: git ${b.meta.gitHead}, ${b.meta.ranAt.slice(0, 10)})`,
    '',
    '| set, scenario | drainers caught: red | drainers caught: any | benign alarmed: red | benign alarmed: any |',
    '|---|---|---|---|---|',
    row('Set A, S1 (shipped default)', 'A', 'S1'),
    row('Set A, S2 (following the manifest)', 'A', 'S2'),
    row('Set B (PTXPhish), S1', 'B', 'S1'),
    row('Set B (PTXPhish), S2', 'B', 'S2'),
  ].join('\n');
}

const md = `# B1 — Drainer-request detection (classifyRequest on real mainnet requests)

Generated by \`packages/guard/bench/bench-b1.ts\` at ${meta.ranAt} against git ${meta.gitHead}
(classify.ts sha256 \`${meta.classifySha256.slice(0, 16)}…\`, decode.ts \`${meta.decodeSha256.slice(0, 16)}…\`, known-contracts.json \`${meta.knownContractsSha256.slice(0, 16)}…\`).
Everything below is computed by the product's own \`classifyRequest\`; nothing about the classifier is mocked.

Scenarios: **S0** follows nothing, built-in well-known table off · **S1** shipped default (built-in well-known table: Uniswap, 1inch, 0x,
CoW Protocol, Aave, Lido, OpenSea/Seaport, Safe MultiSend; follows nothing) · **S2** S1 + follows the published mainnet manifest
(\`config/manifest.json\`) · **S3** S2 with the old Uniswap-only table, to show what the table extension buys.
"red" = \`dangerous\`; "any" = \`dangerous\` or \`risky\` (both stop the request in the extension with an explanation).

${beforeAfter()}

## Set A — ScamSniffer-listed drainer spenders vs. recent benign dapp traffic

**Positives:** a seeded random sample of ${drain.stats.addresses} addresses from ScamSniffer's public drainer/scam address list
(${drain.source.listSize} addresses, \`blacklist/address.json\` @ \`${String(drain.source.commit).slice(0, 10)}\`, last changed ${drain.source.committed}; i.e. the 2023–early-2024 Inferno/Angel/Pink era).
For each address we searched all of mainnet history (Routescan API) for Approval / ApprovalForAll / Permit2 \`Permit\` events naming it as spender,
ERC-20 transfers into it and ETH-carrying txs into it (≤2 per address and source), then rebuilt the request the victim was shown.
Revocations found this way (\`approve(drainer, 0)\`, \`setApprovalForAll(drainer, false)\`) are victims cleaning up, so they are counted as **benign** rows of Set A.
${drain.stats.withAnyHit} of ${drain.stats.addresses} sampled addresses had at least one usable request; ${drain.requests.length} requests collected, ${selfRows.length} dropped as the listed address's own activity (it sent the tx), ${drainReqs.length} kept (${prov(rowsA.filter((r) => r.malicious))}).
Skipped (drainer-sent txs such as the drain itself, not a victim request): ${JSON.stringify(drain.skippedBySourceAndSelector ?? {})}.

**Negatives:** ${benign.requests.length} real requests from blocks ${benign.source.fromBlock}–${benign.source.head} (≈2.8 days): approvals by the token owner to
Permit2, 1inch v6, 0x AllowanceHolder, CoW relayer, Aave v3 Pool, Uniswap v3 NPM / SwapRouter02, Lido withdrawal queue; ApprovalForAll to the OpenSea conduit;
Permit2 signatures for the Universal Router (rebuilt from \`execute()\` and checked by signature recovery); plain user calls to the Universal Router, 1inch, Aave, v3 NPM, Seaport 1.6 and Lido (${prov(rowsA.filter((r) => !r.malicious))}).

| scenario | red (dangerous) | any (dangerous or risky) |
|---|---|---|
${Object.keys(SCEN).map((s) => `| ${s} | ${fmtC(results.A[s].red)} | ${fmtC(results.A[s].any)} |`).join('\n')}

### Per category, scenario S1 (shipped default)

${table(rowsA.filter((r) => r.malicious), (r) => r.category, 'S1', true)}

${table(rowsA.filter((r) => !r.malicious), (r) => `${r.category} — ${r.id.split(':')[1]?.replace(/^benign$/, '') ?? ''}`.replace(/ — $/, ''), 'S1', false)}

### Benign, scenario S2 (following the published manifest)

${table(rowsA.filter((r) => !r.malicious), (r) => `${r.category} — ${r.id.split(':')[1] ?? ''}`, 'S2', false)}

### Benign, scenario S3 (old Uniswap-only table, for comparison)

${table(rowsA.filter((r) => !r.malicious), (r) => `${r.category} — ${r.id.split(':')[1] ?? ''}`, 'S3', false)}

### Missed drainer requests (S1, not even risky)

| set | category | verdict | tx | reason shown |
|---|---|---|---|---|
${misses(rowsA, 'S1').join('\n') || '| – | none | | | |'}

### Why benign requests alarm (S1)

${fps(rowsA, 'S1').join('\n')}

## Set B — PTXPhish (NDSS 2025) labeled transactions

Seeded sample of ≤${ptx.source.perColumn} tx hashes per column of \`PTXPHISH.xlsx\` (column sizes: ${JSON.stringify(ptx.source.columnSizes)}).
${rowsB.length} requests classified (${prov(rowsB)}). Not classifiable as a user request (skipped, with reason): ${JSON.stringify(ptx.skipped)}.

| scenario | red (dangerous) | any (dangerous or risky) |
|---|---|---|
${Object.keys(SCEN).map((s) => `| ${s} | ${fmtC(results.B[s].red)} | ${fmtC(results.B[s].any)} |`).join('\n')}

### Per PTXPhish label × request category, scenario S1

${table(rowsB.filter((r) => r.malicious), (r) => `${(r as any).label ?? ''} / ${r.category}`, 'S1', true)}

${table(rowsB.filter((r) => !r.malicious), (r) => r.category, 'S1', false)}

### Missed PTXPhish phishing requests (S1, not even risky)

${(() => {
  const g = new Map<string, Row[]>();
  for (const r of rowsB.filter((x) => x.malicious && !any(x.verdicts.S1!))) {
    const k = `${r.label} · ${r.category} · ${r.verdicts.S1} · "${r.reason.replace(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}/g, '0x…').replace(/sending [\d,]+ units/, 'sending N units').replace(/sends \d+ NFTs/, 'sends N NFTs')}"`;
    g.set(k, [...(g.get(k) ?? []), r]);
  }
  return [...g.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => `- ${rs.length}× ${k} — e.g. ${rs.slice(0, 3).map((r) => `[${r.tx.slice(0, 10)}](https://etherscan.io/tx/${r.tx})`).join(', ')}`).join('\n') || '- none';
})()}

### Why benign PTXPhish requests alarm (S1)

${fps(rowsB, 'S1').slice(0, 25).join('\n')}
`;
writeFileSync(join(REPO, 'docs', 'benchmarks', 'b1-drainer-requests.md'), md);
console.log(JSON.stringify({ A: results.A, B: results.B }, null, 1));
