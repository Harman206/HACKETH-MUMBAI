/** All website copy. Plain language first; every number traceable to the repo's evidence. */
import deployment from '../../../contracts/deployments/sepolia.json';
import permissions from '../../../contracts/deployments/sepolia-permissions.json';
import site from '../site.json';

/** The public site (also encoded in dist/qr.svg at build time). */
export const SITE_URL = site.url;

export const ENS_NAME = (deployment as { name: string }).name;
/** Opens the hosted kit with the demo name filled in. The kit shows a "came from a link: confirm it" banner. */
export const DEMO_KIT_URL = `blackout-kit.html?ens=${encodeURIComponent(ENS_NAME)}`;
export const PERMISSIONS = permissions as { check: string; tx: string; status: string; expected: string; pass: boolean }[];
export const SAFE = (deployment as { safe: string }).safe;
export const RESOLVER = (deployment as { resolver: string }).resolver;

export const HERO = {
  title: 'An exit of your own.',
  sub: 'Save the Copeybara exit kit to withdraw from supported DeFi positions if the protocol’s website goes down or gets hijacked.',
};

export interface Incident { name: string; date: string; what: string; loss: string; source?: string; unverified?: boolean }
export const INCIDENTS: Incident[] = [
  { name: 'Curve Finance DNS hijack', date: '9 Aug 2022', what: 'A cloned site asked users to approve an unverified contract; USDC and DAI were drained.', loss: '~$612k, 7 users', source: 'CertiK incident write-up; replayed on chain below' },
  { name: 'Balancer frontend hijack', date: '19–20 Sep 2023', what: 'Registrar social engineering; the fake site collected approvals for a drainer.', loss: '~$238k', source: 'Cointelegraph report' },
  { name: 'Polymarket third-party script', date: '29 Oct 2026', what: 'A hijacked third-party script ran on the real site.', loss: '~$2.7M', unverified: true },
  { name: 'Name.com DNS hijack', date: '30–31 Oct 2026', what: '12–15 DeFi sites served drainers.', loss: 'not collected', unverified: true },
];

export const REPLAY_R1 = {
  title: 'The approval that drained a wallet',
  victim: '0xb30Ca7383DBd1aC31459E8e1De3BCb022A1Db001',
  lostWithout: '400,227.23',
  lostWith: '0.00',
  token: 'USDC',
  approveTx: '0xec72bb412a3e56519af8cf96f7de56edb80de53c1d1b656d2e5d5d8ce2477f69',
  drainTx: '0x361bfdbd76290ead53b29a78c3e6f4633e6eb11459437f3c3955f59abfae1e6a',
  labels: ['mainnet fork', 'counterfactual'],
  body: 'In a replay on a copy of Ethereum mainnet, the Exit Guard blocked the original approval. The same drain transaction then moved zero USDC.',
};

export const HOW = [
  {
    title: 'Keep a local copy',
    body: 'The kit is a single HTML file. It connects directly to the protocol’s smart contracts so you can withdraw while the site is down.',
  },
  {
    title: 'Verify the file before connecting',
    body: 'Compare the file’s SHA-256 fingerprint with the release record on the protocol’s official ENS name. Publishing a release requires two of the three Safe signers.',
  },
  {
    title: 'Review the withdrawal in your wallet',
    body: 'The Exit Guard screens the transaction before it reaches your wallet. It blocks token approvals, ETH transfers, and exits that pay another address.',
  },
  {
    title: 'Ask independent providers',
    body: 'The kit asks three RPC providers for blockchain data. At least two must respond, and every response must agree before the kit proceeds.',
  },
] as const;

export const TRUSTED = [
  'Your wallet and the RPC it uses to broadcast transactions',
  'Ethereum and the ENS contracts',
  'The protocol’s release Safe signers',
];
export const NOT_TRUSTED = [
  'A missing or hijacked protocol website or DNS record',
  'Third-party scripts on the protocol’s website',
  'An unavailable kit host or a single unavailable RPC provider',
];
export const LIMITS = [
  'The kit cannot prevent smart-contract exploits or recover funds after a wallet key is stolen.',
  'Withdrawals require contracts that are running and solvent.',
  'Keep a copy of the kit or use a mirror. Get the protocol’s ENS name independently before verifying.',
  'Supported adapters cover Uniswap v3 and v4, Aave v3 supply positions, and Curve 3pool liquidity positions. Check the published manifest for chain and contract coverage.',
];

export const PROTOCOL_STEPS = [
  { title: 'Set up your ENS name', body: 'Put it under your 2-of-3 Safe and use a Permissioned Resolver.' },
  { title: 'Publish the release and exit contracts', body: 'Set org.blackout.release to the file fingerprint and version. Use org.blackout.manifest2 for the current exit contract list and retain org.blackout.manifest for older kits.' },
  { title: 'Scope the website key to the URL', body: 'Give the web team permission to update the url record. Keep release and resolver changes under the Safe.' },
];
