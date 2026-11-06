/** All website copy. Plain language first; every number traceable to the repo's evidence. */
import deployment from '../../../contracts/deployments/sepolia.json';
import permissions from '../../../contracts/deployments/sepolia-permissions.json';

export const ENS_NAME = (deployment as { name: string }).name;
export const PERMISSIONS = permissions as { check: string; tx: string; status: string; expected: string; pass: boolean }[];
export const SAFE = (deployment as { safe: string }).safe;
export const RESOLVER = (deployment as { resolver: string }).resolver;

export const HERO = {
  title: 'If a DeFi website dies or gets hijacked, you can still get your money out.',
  sub: 'BLACKOUT is a saved, verifiable exit for your DeFi positions. It talks to the protocol’s contracts directly. No website, no company server, and a built-in checklist that refuses to sign anything that pays someone else.',
};

export interface Incident { name: string; date: string; what: string; loss: string; source?: string; unverified?: boolean }
export const INCIDENTS: Incident[] = [
  { name: 'Curve Finance DNS hijack', date: '9 Aug 2022', what: 'A cloned site asked users to approve an unverified contract; USDC and DAI were drained.', loss: '~$612k, 7 users', source: 'CertiK incident write-up; replayed on chain below' },
  { name: 'Balancer frontend hijack', date: '19–20 Sep 2023', what: 'Registrar social engineering; the fake site collected approvals for a drainer.', loss: '~$238k', source: 'Cointelegraph report' },
  { name: 'Polymarket third-party script', date: '29 Oct 2026', what: 'A hijacked third-party script ran on the real site.', loss: '~$2.7M', unverified: true },
  { name: 'Name.com DNS hijack', date: '30–31 Oct 2026', what: '12–15 DeFi sites served drainers.', loss: 'not collected', unverified: true },
];

export const REPLAY_R1 = {
  title: 'We replayed the Curve 2022 hijack on a copy of mainnet',
  victim: '0xb30Ca7383DBd1aC31459E8e1De3BCb022A1Db001',
  lostWithout: '400,227.23',
  lostWith: '0.00',
  token: 'USDC',
  approveTx: '0xec72bb412a3e56519af8cf96f7de56edb80de53c1d1b656d2e5d5d8ce2477f69',
  drainTx: '0x361bfdbd76290ead53b29a78c3e6f4633e6eb11459437f3c3955f59abfae1e6a',
  labels: ['mainnet fork', 'counterfactual'],
  body: 'The victim signed one approval on the fake site; one block later the drainer took 400,227.23 USDC. BLACKOUT’s checklist rejects that exact approval, and with no approval the same drain transaction moves nothing.',
};

export const HOW = [
  {
    title: 'Your own remote control',
    body: 'Your money lives in the protocol’s smart contracts, not on its website. The website is just a remote control. BLACKOUT is a second remote control, one HTML file you keep, that talks to the contracts directly.',
  },
  {
    title: 'A fingerprint on ENS proves the file is real',
    body: 'Every file has a fingerprint (sha256). The protocol writes the real one on its ENS name, and only its 2-of-3 Safe can change it. A stolen website password can’t: we tried, live, and every attempt reverted.',
  },
  {
    title: 'A checklist that never pays anyone else',
    body: 'Before your wallet sees anything, the Exit Guard checks it: is it one of the protocol’s published contracts? Does the money go to you? Is it an approval? No approvals, no ETH, no other recipient. Ever.',
  },
  {
    title: 'Three servers must agree',
    body: 'Your browser learns blockchain facts from servers. One could lie or be down, so BLACKOUT asks three. If they disagree, it stops instead of guessing.',
  },
] as const;

export const TRUSTED = ['Your wallet and its RPC (it broadcasts your transaction)', 'Ethereum itself', 'The ENS contracts', 'The protocol’s release Safe signers'];
export const NOT_TRUSTED = ['The protocol’s website and its DNS', 'Third-party scripts on that website', 'Wherever you downloaded the kit from (the fingerprint checks it)', 'Any single RPC provider (three must agree)'];
export const LIMITS = [
  'It does not stop smart-contract exploits; it only helps you exit before one.',
  'It does not help if your own wallet key is stolen, or the contracts are paused or insolvent.',
  'You need to have saved the kit (or fetch it from any mirror) and know the protocol’s ENS name from a source other than the kit.',
  'Covered today: Uniswap v3 positions held in your wallet, Aave v3 supply-only, Curve 3pool LP.',
];

export const PROTOCOL_STEPS = [
  { title: 'Register one ENS name', body: 'Owned by your 2-of-3 Safe, with its own Permissioned Resolver.' },
  { title: 'Publish two records', body: '`org.blackout.release` = the kit’s sha256 and version; `org.blackout.manifest` = your exit contracts per chain.' },
  { title: 'Give your web team only `url`', body: 'An argument-scoped role: a stolen website key can edit the website link and nothing else.' },
];
