/**
 * Benchmark results shown on the landing page. Source of truth: docs/benchmarks/README.md (and the per-benchmark reports
 * next to it). apps/site/test/benchmarks.test.ts checks every figure here against that file, so edit both together.
 */
import { REPO_URL } from './developers';

export const BENCH_DATE = '7 Nov 2026';
export const BENCH_DOCS = `${REPO_URL}/tree/main/docs/benchmarks`;
export const benchDoc = (file: string) => `${REPO_URL}/blob/main/docs/benchmarks/${file}`;

export interface BenchStat {
  figure: string;
  label: string;
  /** the fraction behind the figure, as written in the report */
  detail: string;
  before?: string;
}

export const BENCH_STATS: BenchStat[] = [
  { figure: '99.9%', label: 'of PTXPhish phishing requests stopped', detail: '696/697', before: '79.2%' },
  { figure: '1.6%', label: 'of real dapp requests raised the red alarm', detail: '3/186', before: '42.5%' },
  { figure: '0', label: 'safety violations across 14,130 real look-alike domains', detail: '15 DeFi brands' },
  { figure: '62,300', label: 'generated Exit Guard cases, 0 counterexamples', detail: '206 guard tests' },
];

export interface Dataset {
  name: string;
  what: string;
  url: string;
}

export const DATASETS: Dataset[] = [
  { name: 'PTXPhish (NDSS ’25)', what: '697 phishing + 218 benign requests', url: 'https://github.com/blocksecteam/PTXPhish' },
  { name: 'ScamSniffer scam-database', what: '150 of 2,530 drainer addresses; look-alike domains', url: 'https://github.com/scamsniffer/scam-database' },
  { name: 'MetaMask eth-phishing-detect', what: '116k blacklist entries', url: 'https://github.com/MetaMask/eth-phishing-detect' },
  { name: 'Ledger Connect Kit 1.1.5–1.1.7', what: 'the real malicious builds, from cdn.jsdelivr.net', url: 'https://www.jsdelivr.com/package/npm/@ledgerhq/connect-kit' },
  { name: 'Wayback Machine captures', what: 'Balancer 2023 and Curve 2022 hijacks', url: 'https://web.archive.org/' },
  { name: 'Recent mainnet traffic', what: '186 real dapp requests over 2.8 days', url: benchDoc('b1-drainer-requests.md') },
];

export interface Benchmark {
  id: string;
  title: string;
  /** which product code was measured */
  code: string;
  ran: string;
  worked: string[];
  missed: string[];
  report: string;
}

export const BENCHMARKS: Benchmark[] = [
  {
    id: 'B1',
    title: 'Drainer requests',
    code: 'classifyRequest, the extension’s verdict for every wallet request',
    ran: '283 victim requests we rebuilt from 150 ScamSniffer drainer addresses (full mainnet history), 697 phishing and 218 benign requests from PTXPhish, and 186 recent real dapp requests as the false-alarm baseline.',
    worked: [
      'Every permission grant to a drainer was red: approve, increaseAllowance, setApprovalForAll, EIP-2612 and DAI permits, Permit2. 119/119 in our set, 311/311 in PTXPhish.',
      'Proxy-upgrade phishing: 107/108 red, 1 asks. The first run missed all 108/108.',
      'NFT bulk transfers through OpenSea’s TransferHelper: 37/37 red. The first run missed all 37/37.',
      'Revocations, approve(x, 0), now pass instead of raising the drainer alarm.',
    ],
    missed: [
      'ETH sends and payable “claim” calls only ask (risky), never red. There is no drainer address list in the classifier.',
      'A plain token transfer straight to a drainer also only asks: the same request is how people pay each other.',
      'Approvals to spenders we don’t list still alarm: 2 in our benign set, 19 in PTXPhish’s KOL/developer set.',
      'Seaport/Blur order signatures are flagged by type only; we didn’t rebuild them.',
    ],
    report: 'b1-drainer-requests.md',
  },
  {
    id: 'B2',
    title: 'Look-alike domains',
    code: 'hostMatches, parseBlocklist and the extension’s block rules',
    ran: '14,130 real phishing domains imitating 15 DeFi brands (Uniswap, Aave, Curve, Lido, OpenSea…), from ScamSniffer and MetaMask, each checked against every real host of its brand in both directions.',
    worked: [
      '0 safety violations: a protocol can list look-alikes without ever blocking its own site.',
      'Every listed domain is blocked before it loads, including all its subdomains.',
      'Look-alikes on shared hosting (3,333 on pages.dev, vercel.app…) work, because the exact subdomain is listed.',
    ],
    missed: [
      'An unlisted look-alike is never blocked. There is no fuzzy matching.',
      'Feeds barely overlap: a copy of MetaMask’s list misses 94–100% of each brand’s ScamSniffer look-alikes.',
      'Size: Uniswap’s 1,820 look-alikes are 44 KiB, about 31M gas. A protocol can publish a short curated list, not a feed.',
      'Path-based phishing (sites.google.com/view/…) can’t be expressed in a host blocklist.',
    ],
    report: 'b2-lookalike-domains.md',
  },
  {
    id: 'B3',
    title: 'Frontend hijacks',
    code: 'the site fingerprint check in the extension and the watcher',
    ran: 'The real malicious Ledger Connect Kit 1.1.5, 1.1.6 and 1.1.7 bytes, the real Balancer hijack capture from the Wayback Machine, a reconstructed Curve clone, and two synthetic evasions in the real built extension in Chromium.',
    worked: [
      'All three malicious Connect Kit builds and the Balancer capture: mismatch. The reconstructed Curve clone too.',
      'The drainer requests from these incidents, including the real Curve 2022 approve: dangerous.',
      'After the fix, a malicious chunk loaded with import() is caught by the extension (was missed).',
      'A server that cloaks the drainer to real script loads is caught when the response is cacheable.',
    ],
    missed: [
      'A cloaked script served with Cache-Control: no-store still passes.',
      'The watcher’s static check still misses both evasions; it only reads <script> tags.',
      'Floating dependencies cost false alarms: Connect Kit’s legitimate 1.1.8–1.1.12 also mismatch until the Safe re-publishes.',
      'eval / new Function of strings, blob: workers and WebAssembly aren’t hashed.',
    ],
    report: 'b3-frontend-hijacks.md',
  },
  {
    id: 'B4',
    title: 'Exit Guard robustness',
    code: 'the fail-closed Exit Guard every kit transaction goes through',
    ran: '6 fast-check properties × 10,000 runs, a Uniswap v4 action-sequence property × 2,000 runs, a classifier fuzz × 300 runs, and the 42-entry banned-calldata corpus including the real Curve 2022 attacker calldata.',
    worked: [
      '62,300 generated cases, 0 counterexamples. 206 guard tests pass (152 before the fixes).',
      'A mutated recipient, target, selector, value or an injected approve always fails.',
      'Every function newly decoded for B1 is also banned from the kit.',
    ],
    missed: [
      'These are our own tests. They show the Guard is fail-closed on its input space; they don’t measure real traffic. That is what B1 does.',
    ],
    report: 'README.md',
  },
];

export type GapStatus = 'fixed' | 'partly' | 'changed';

export interface Gap {
  gap: string;
  before: string;
  after: string;
  status: GapStatus;
}

export const GAPS: Gap[] = [
  { gap: 'Proxy upgrades and Safe owner changes were invisible', before: '108/108 missed', after: '107/108 red, 1 asks', status: 'fixed' },
  { gap: 'NFT bulk-transfer helpers', before: '37/37 missed', after: '37/37 red', status: 'fixed' },
  { gap: 'Revocations raised the drainer alarm', before: 'red', after: 'pass: “This is safe”', status: 'fixed' },
  { gap: 'Reason text read the amount from the outer call', before: 'wrong amount', after: 'each call’s own amount', status: 'fixed' },
  { gap: 'Well-known contracts covered only Uniswap', before: '66 red alarms on real dapp approvals', after: 'known: 1inch, 0x, CoW, Aave, Lido, OpenSea, Safe', status: 'fixed' },
  { gap: 'Plain token sends were red', before: 'red', after: 'asks, with the amount and recipient', status: 'changed' },
  { gap: 'import() chunks weren’t fingerprinted', before: 'match (missed)', after: 'mismatch, in the extension', status: 'fixed' },
  { gap: 'Server cloaking of script loads', before: 'match (missed)', after: 'caught if cacheable; no-store still missed', status: 'partly' },
];

export const BENCH_REPRO = `cd packages/guard
../../node_modules/.bin/tsx bench/bench-b1.ts   # offline
../../node_modules/.bin/tsx bench/bench-b2.ts
../../node_modules/.bin/tsx bench/bench-b3.ts
cd ../.. && pnpm vitest run packages/guard     # B4`;

export const BENCH_LIMITS = [
  'Samples are hundreds of requests per set, not the full datasets, because of free-API rate limits. They are seeded, so reruns match.',
  'Labels come from ScamSniffer and the PTXPhish authors. ETH sent to a listed address counts as a victim request, which is mostly but not always true.',
  'Off-chain permit signatures were rebuilt from the calldata that used them, and labeled reconstructed.',
  'Only the classifier and checks are measured, not how people respond to the warning.',
];
