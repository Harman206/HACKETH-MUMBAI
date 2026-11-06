/**
 * B2: look-alike domains. Real phishing domains from MetaMask eth-phishing-detect (src/config.json blacklist) and
 * ScamSniffer scam-database (blacklist/domains.json) that impersonate DeFi frontends, run through the product's own
 * hostMatches / parseBlocklist / formatBlocklist (@copeybara/core) and the extension's DNR rule builder.
 *   ../../node_modules/.bin/tsx bench/bench-b2.ts
 * Lists are downloaded at run time (pinned to the commit shown in the report); only counts and examples are committed.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatBlocklist, hostMatches, parseBlocklist, RecordFormatError } from '@copeybara/core';
import { buildRules } from '../../../apps/extension/src/background/rules';
import { REPO, writeJson } from './lib';

/** brand token → the protocol's real hosts (what it would never want blocked) */
const BRANDS: Record<string, string[]> = {
  uniswap: ['uniswap.org', 'app.uniswap.org'],
  aave: ['aave.com', 'app.aave.com'],
  curve: ['curve.fi', 'curve.finance'],
  compound: ['compound.finance', 'app.compound.finance'],
  lido: ['lido.fi', 'stake.lido.fi'],
  balancer: ['balancer.fi', 'app.balancer.fi'],
  sushi: ['sushi.com'],
  '1inch': ['1inch.io', 'app.1inch.io', '1inch.com'],
  pancakeswap: ['pancakeswap.finance'],
  eigenlayer: ['eigenlayer.xyz', 'app.eigenlayer.xyz'],
  pendle: ['pendle.finance', 'app.pendle.finance'],
  convex: ['convexfinance.com'],
  yearn: ['yearn.fi'],
  dydx: ['dydx.exchange', 'dydx.trade'],
  opensea: ['opensea.io'],
};

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}
/** A host impersonates `brand` when a label/dash-token contains it, or (brands ≥ 6 chars) is one edit away (uniswep, un1swap). */
function impersonates(host: string, brand: string): boolean {
  const toks = host.toLowerCase().split(/[.\-_]/).filter(Boolean);
  if (toks.some((t) => t.includes(brand))) return true;
  return brand.length >= 6 && toks.some((t) => Math.abs(t.length - brand.length) <= 1 && lev(t, brand) === 1);
}

async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function commitOf(repo: string, path: string) {
  const c = ((await json(`https://api.github.com/repos/${repo}/commits?per_page=1&path=${path}`)) as any[])[0];
  return { sha: c?.sha as string, date: c?.commit?.committer?.date as string };
}

async function main() {
  const mmUrl = 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json';
  const ssUrl = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json';
  const [mm, ss, mmC, ssC] = await Promise.all([json(mmUrl), json(ssUrl), commitOf('MetaMask/eth-phishing-detect', 'src/config.json'), commitOf('scamsniffer/scam-database', 'blacklist/domains.json')]);
  const mmList = [...new Set((mm.blacklist as string[]).map((d) => d.toLowerCase()))];
  const ssList = [...new Set((ss as string[]).map((d) => d.toLowerCase()))];
  const mmSet = new Set(mmList);
  const ssSet = new Set(ssList);

  const perBrand: Record<string, any> = {};
  const violations: string[] = [];
  let totalLook = 0;
  let parseRejected: Record<string, number> = {};
  const allLook = new Set<string>();
  for (const [brand, real] of Object.entries(BRANDS)) {
    const isReal = (h: string) => real.some((r) => hostMatches(h, r) || hostMatches(r, h));
    const mmLook = mmList.filter((h) => impersonates(h, brand));
    const ssLook = ssList.filter((h) => impersonates(h, brand));
    // An entry that hostMatches the real site in either direction is either the real site itself or a parent of it.
    const realHits = [...new Set([...mmLook, ...ssLook])].filter(isReal);
    const look = [...new Set([...mmLook, ...ssLook])].filter((h) => !isReal(h));
    look.forEach((h) => allLook.add(h));
    totalLook += look.length;

    // (i) safety: publishing every look-alike never blocks a real host, a real host never "matches" a look-alike,
    // and classic suffix/prefix tricks do not match the real domain.
    for (const L of look) for (const R of real) {
      if (hostMatches(R, L)) violations.push(`real ${R} would be blocked by ${L}`);
      if (hostMatches(L, R)) violations.push(`look-alike ${L} treated as real ${R}`);
    }
    const tricks = real.filter((R) => R.split('.').length === 2).flatMap((R) => [`${R}.evil.com`, `evil-${R}`, `${R}-app.com`, `x${R}`, `${R.replace(/\./g, '-')}.com`]);
    const trickMatches = tricks.filter((t) => real.some((R) => hostMatches(t, R)));

    // (ii) coverage if the protocol published the look-alikes as org.copeybara.blocklist
    let accepted: string[] = [];
    const rejected: string[] = [];
    for (const h of look) {
      try {
        accepted.push(...parseBlocklist(JSON.stringify({ v: 1, domains: [h] })));
      } catch (e) {
        if (!(e instanceof RecordFormatError)) throw e;
        rejected.push(h);
        const why = /[^\x00-\x7f]/.test(h) ? 'non-ASCII (needs punycode)' : /[\/:*]/.test(h) ? 'path/port/wildcard' : /_/.test(h) ? 'underscore' : 'other';
        parseRejected[why] = (parseRejected[why] ?? 0) + 1;
      }
    }
    const record = formatBlocklist(accepted);
    const blocked = (host: string) => accepted.some((d) => hostMatches(host, d));
    const exact = look.filter(blocked).length;
    const sub = look.filter((h) => blocked(`www.${h}`) && blocked(`app.${h}`)).length;
    const rules = buildRules([{ name: brand, snapshot: { blocklist: accepted } } as any]);
    // (iii) cross-list freshness: a blocklist copied from one feed misses what only the other feed knows.
    const mmOnlyLook = mmLook.filter((h) => !isReal(h));
    const ssOnlyLook = ssLook.filter((h) => !isReal(h));
    perBrand[brand] = {
      real,
      lookalikes: look.length,
      metamask: mmOnlyLook.length,
      scamsniffer: ssOnlyLook.length,
      inBoth: mmOnlyLook.filter((h) => ssSet.has(h)).length,
      scamsnifferNotInMetamask: ssOnlyLook.filter((h) => !mmSet.has(h)).length,
      metamaskNotInScamsniffer: mmOnlyLook.filter((h) => !ssSet.has(h)).length,
      realSiteEntriesExcluded: realHits,
      parseRejected: rejected.length,
      rejectedExamples: rejected.slice(0, 5),
      blockedExact: exact,
      blockedSubdomains: sub,
      dnrRules: rules.length,
      recordBytes: record.length,
      trickMatches,
      examples: look.slice(0, 8),
    };
  }
  const shared = /(^|\.)(pages\.dev|vercel\.app|netlify\.app|github\.io|web\.app|firebaseapp\.com|webflow\.io|gitbook\.io|workers\.dev|surge\.sh|replit\.app|on-fleek\.app|ipfs\.(io|dweb\.link))$/;
  const sharedHosting = [...allLook].filter((h) => shared.test(h)).length;
  const out = {
    sources: { metamask: { url: mmUrl, ...mmC, blacklist: mmList.length }, scamsniffer: { url: ssUrl, ...ssC, domains: ssList.length } },
    totalLookalikes: totalLook,
    distinctLookalikes: allLook.size,
    sharedHosting,
    safetyViolations: violations,
    parseRejected,
    perBrand,
  };
  writeJson('b2-results.json', out);

  const rows = Object.entries(perBrand).map(([b, r]: any) => `| ${b} | ${r.real.join(', ')} | ${r.lookalikes} | ${r.metamask} | ${r.scamsniffer} | ${r.scamsnifferNotInMetamask} (${((100 * r.scamsnifferNotInMetamask) / Math.max(1, r.scamsniffer)).toFixed(0)}%) | ${r.parseRejected} | ${r.blockedExact}/${r.lookalikes - r.parseRejected} | ${r.blockedSubdomains} | ${r.dnrRules} | ${(r.recordBytes / 1024).toFixed(1)} KiB (~${((Math.ceil(r.recordBytes / 32) * 22_100) / 1e6).toFixed(1)}M gas) | ${r.realSiteEntriesExcluded.length ? r.realSiteEntriesExcluded.join(', ') : '–'} |`);
  const md = `# B2 — Look-alike domains (hostMatches / org.copeybara.blocklist)

Generated by \`packages/guard/bench/bench-b2.ts\` (${new Date().toISOString()}).
Sources, downloaded at run time: MetaMask eth-phishing-detect \`src/config.json\` @ \`${mmC.sha?.slice(0, 10)}\` (${mmC.date}; ${mmList.length} blacklist entries)
and ScamSniffer scam-database \`blacklist/domains.json\` @ \`${ssC.sha?.slice(0, 10)}\` (${ssC.date}; ${ssList.length} domains; public copy is delayed 7 days).
A domain counts as a look-alike of a brand when a label/dash-token contains the brand name or (brand ≥ 6 chars) is one edit away
(\`uniswep\`, \`un1swap\`). Entries that \`hostMatches\` the brand's real host in either direction are reported and excluded.

**${allLook.size} distinct look-alike domains across ${Object.keys(BRANDS).length} brands** (${sharedHosting} of them on shared hosting such as pages.dev / vercel.app / netlify.app).

## (i) hostMatches false-positive safety
- Pairs checked: every look-alike × every real host of its brand, both directions → **${violations.length} violations**${violations.length ? ': ' + violations.slice(0, 10).join('; ') : ''}.
- Suffix/prefix tricks on the apex domain (\`<real>.evil.com\`, \`evil-<real>\`, \`<real>-app.com\`, \`x<real>\`, dashes-for-dots) matched a real host: ${Object.values(perBrand).flatMap((r: any) => r.trickMatches).length}.
- So a protocol can publish any number of look-alikes without ever blocking its own site, and a look-alike is never mistaken for the real host (label-boundary match).

## (ii) Coverage if the protocol published them in \`org.copeybara.blocklist\`

| brand | real hosts | look-alikes | in MetaMask | in ScamSniffer | ScamSniffer-only (missed by a MetaMask copy) | rejected by parseBlocklist | blocked (exact host) | blocked (www./app. subdomain) | DNR rules | record size | listed entries that ARE the real site (excluded) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${rows.join('\n')}

parseBlocklist rejections by reason: ${JSON.stringify(parseRejected)}.

Reading: every listed host that passes \`parseBlocklist\` is blocked, including all its subdomains (DNR \`requestDomains\` and \`hostMatches\`
have the same label-boundary semantics). The cost is the record: an ENS text record grows by ~${(Object.values(perBrand).reduce((s: number, r: any) => s + r.recordBytes, 0) / Math.max(1, totalLook)).toFixed(0)} bytes per domain,
and writing it costs roughly 22.1k gas per new 32-byte storage word (≈${((Object.values(perBrand).reduce((s: number, r: any) => s + Math.ceil(r.recordBytes / 32), 0) * 22_100) / 1e6).toFixed(0)}M gas for all ${Object.keys(BRANDS).length} lists, i.e. a protocol can realistically publish a curated short list, not a feed);
Chrome caps dynamic DNR rules (30,000 "safe" rules since Chrome 121), with one rule per domain in \`buildRules\`.

## (iii) What Copeybara misses without a blocklist entry
- The extension blocks **only domains a followed protocol lists**. With no entry, **0** of the ${allLook.size} look-alikes are blocked by domain;
  there is no fuzzy/edit-distance matching (MetaMask's detector has a fuzzylist with tolerance ${mm.tolerance} for ${mm.fuzzylist.length} brands; Copeybara has nothing equivalent).
- Freshness: even a protocol that copied one feed would miss what only the other feed has (column "ScamSniffer-only"); new look-alikes appear daily and the
  public ScamSniffer copy lags 7 days.
- What still protects the user on an unlisted look-alike is \`classifyRequest\` on the wallet request the site makes. Typical drainer-kit requests are
  approve / increaseAllowance / setApprovalForAll / EIP-2612 permit / Permit2 / Seaport orders / payable "claim" calls — see B1 for per-category detection
  on real requests (\`b1-drainer-requests.md\`).
- Site fingerprints (B3) do not help here: a look-alike is not the protocol's origin, so no \`org.copeybara.site\` check applies.

## Examples
${Object.entries(perBrand).map(([b, r]: any) => `- **${b}**: ${r.examples.map((e: string) => '`' + e + '`').join(', ')}`).join('\n')}
`;
  writeFileSync(join(REPO, 'docs', 'benchmarks', 'b2-lookalike-domains.md'), md);
  console.log(JSON.stringify({ totalLook, distinct: allLook.size, violations: violations.length, parseRejected }, null, 1));
  for (const [b, r] of Object.entries(perBrand) as any) console.log(b, r.lookalikes, r.metamask, r.scamsniffer, r.scamsnifferNotInMetamask, r.parseRejected, r.realSiteEntriesExcluded);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
