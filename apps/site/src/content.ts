/** All website copy. Plain language first; every number traceable to the repo's evidence. */
import deployment from '../../../contracts/deployments/sepolia.json';
import permissions from '../../../contracts/deployments/sepolia-copeybara-permissions.json';
import watcherPermissions from '../../../contracts/deployments/sepolia-watcher-permissions.json';
import site from '../site.json';

/** The public site (also encoded in dist/qr.svg at build time). */
export const SITE_URL = site.url;

export const ENS_NAME = (deployment as { name: string }).name;
/** Opens the hosted kit with the demo name filled in. The kit shows a "came from a link: confirm it" banner. */
export const DEMO_KIT_URL = `copeybara-kit.html?ens=${encodeURIComponent(ENS_NAME)}`;
export type PermissionCheck = { check: string; tx: string; status: string; expected: string; pass: boolean };
export const PERMISSIONS = permissions as PermissionCheck[];
export const WATCHER_PERMISSIONS = watcherPermissions as PermissionCheck[];
export const SAFE = (deployment as { safe: string }).safe;
export const RESOLVER = (deployment as { resolver: string }).resolver;

export const HERO = {
  title: 'An exit of your own.',
  sub: 'Save the Copeybara exit kit to withdraw from supported DeFi positions if the protocol’s website goes down or gets hijacked. Currently a Sepolia testnet demo.',
};

export const EXTENSION = {
  title: 'Get the Copeybara extension',
  lede: 'The kit gets you out after something goes wrong. The extension watches while you use DeFi, so you can see it go wrong before you sign.',
  bullets: [
    { title: 'Checks the site you are on', body: 'It compares the scripts of every protocol site you open with the fingerprints the protocol published on ENS, and warns about code the protocol never published. Sites the protocol flags on ENS, and look-alike domains on its ENS blocklist, are blocked before they load.' },
    { title: 'Holds drainer requests', body: 'Approval and permit requests to unknown addresses, and blind signatures, are held before your wallet shows them. You see a warning with Cancel as the default; to go ahead anyway you must confirm you understand the risk.' },
    { title: 'Warns before you connect to a look-alike', body: 'On a site that imitates a protocol you follow, “Don’t connect your wallet here” opens before your wallet’s own connect popup.' },
    { title: 'Saved by Copey!', body: 'Cancel a risky request, or land on a blocked page, and a short celebration tells you what you just avoided.' },
    { title: 'One click to exit', body: 'When a site is down or hijacked, it opens the verified exit kit and you withdraw straight from the contracts.' },
  ],
  chromeZip: 'copeybara-extension-chrome.zip',
  firefoxZip: 'copeybara-extension-firefox.zip',
  steps: [
    'Unzip copeybara-extension-chrome.zip into a folder you will keep.',
    'Open chrome://extensions in Chrome. Other Chromium browsers such as Brave and Edge use the same steps but are not tested.',
    'Turn on Developer mode (top right).',
    'Click Load unpacked and choose the unzipped folder. The setup wizard opens by itself.',
  ],
  watcher: 'Protocols can also run the Copeybara watcher. It fingerprints the official site, probes look-alike domains, and can write only two ENS records, status and blocklist, which warn about or block websites. Nothing it writes can block an exit.',
  note: 'Sepolia testnet preview, installed unpacked from the zip; no store listing yet. Checks inside a web page are best effort, because a hostile page can get around code running in it. The blocks you can rely on are the ones applied before a flagged site loads.',
} as const;

export interface Incident { name: string; date: string; what: string; loss: string; sources?: { label: string; url: string }[]; unverified?: boolean }
export const INCIDENTS: Incident[] = [
  {
    name: 'Curve Finance DNS hijack', date: '9 Aug 2022',
    what: 'A cloned site asked users to approve an unverified contract; USDC and DAI were drained from 7 users. Replayed on a mainnet fork above.',
    loss: 'about $612,000 (CertiK)',
    sources: [{ label: 'CertiK', url: 'https://www.certik.com/blog/curve-finance-hack-incident-analysis' }],
  },
  {
    name: 'Balancer frontend hijack', date: '19–20 Sep 2023',
    what: 'Social engineering at the .fi registrar (EuroDNS); the fake site collected approvals for a drainer.',
    loss: 'about $238,000 (Cointelegraph)',
    sources: [{ label: 'Cointelegraph', url: 'https://cointelegraph.com/news/balancer-social-engineering-attack-dns-provider-frontend-hijack' }],
  },
  {
    name: 'Polymarket third-party script', date: '29 Oct 2026',
    what: 'Attackers hijacked the DNS of DebugBear, a monitoring vendor, and replaced the script Polymarket loaded from it with a drainer. It used signed-in traders’ own signers; 726 wallets were hit.',
    loss: 'about $2.7 million (Polymarket)',
    sources: [
      { label: 'The Hacker News', url: 'https://thehackernews.com/2026/11/hackers-steal-about-27-million-from.html' },
      { label: 'SecurityWeek', url: 'https://www.securityweek.com/polymarket-returns-3-9-million-to-traders-as-debugbear-cites-dns-hijack/' },
    ],
  },
  {
    name: 'Name.com DNS hijack', date: '30–31 Oct 2026',
    what: 'At least 12 DeFi sites registered at Name.com were redirected to copies running the Step Drainer kit; Name.com said 15 customer domains were affected.',
    loss: 'about $138,000 to $202,000 traced so far (The Block, Bitquery)',
    sources: [
      { label: 'The Block', url: 'https://www.theblock.co/news/defi/2026-10-31-hackers-hijack-a-dozen-defi-websites-all-registered-with-name-com-and-steal-about-138000-432251' },
      { label: 'Bitquery', url: 'https://bitquery.io/investigations/name-com-dns-hijack' },
    ],
  },
];

export const OLD_NAME_NOTE = `Copeybara was first called Blackout, so the demo ENS name (${ENS_NAME}) and this site’s address still use the old name.`;

export const REPLAY_R1 = {
  title: 'The approval that drained a wallet',
  victim: '0xb30Ca7383DBd1aC31459E8e1De3BCb022A1Db001',
  lostWithout: '400,227.23',
  lostWith: '0.00',
  token: 'USDC',
  approveTx: '0xec72bb412a3e56519af8cf96f7de56edb80de53c1d1b656d2e5d5d8ce2477f69',
  drainTx: '0x361bfdbd76290ead53b29a78c3e6f4633e6eb11459437f3c3955f59abfae1e6a',
  labels: ['mainnet fork', 'counterfactual'],
  body: 'The Exit Guard rejects the victim’s real approval. In a mainnet-fork replay without that approval, the attacker’s same drain transaction moved zero USDC (counterfactual).',
};

export const HOW = [
  {
    title: 'Keep a local copy',
    body: 'The kit is a single HTML file. It reads the protocol’s smart contracts through public RPC providers and sends the withdrawal through your wallet, so you can withdraw while the site is down.',
  },
  {
    title: 'Verify the file before connecting',
    body: 'Compare the file’s SHA-256 fingerprint with the release record on the protocol’s official ENS name. Publishing a release requires two of the three Safe signers. In this demo all three Safe keys are held by one maintainer.',
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
  'Supported: Uniswap v3, Uniswap v4 (ERC-20 pairs; native-ETH pools are manual), Aave v3 supply-only, and Curve 3pool LP. This is a Sepolia testnet demo: on Sepolia the manifest lists Uniswap v3 and v4; the Aave and Curve exits are tested on mainnet forks.',
];

export const PROTOCOL_STEPS = [
  { title: 'Set up your ENS name', body: 'Put it under your 2-of-3 Safe and use a Permissioned Resolver. In this demo all three Safe keys are held by one maintainer; a real protocol needs independent signers.' },
  { title: 'Publish the release and exit contracts', body: 'Set org.copeybara.release to the file fingerprint and version, and org.copeybara.manifest to the exit contract list. Leave the old org.blackout.* records in place for kits saved before the rename.' },
  { title: 'Scope the website key to the URL', body: 'Give the web team permission to update the url record. Keep release and resolver changes under the Safe.' },
  { title: 'Prove it, then get certified', body: 'The Copeybara SDK turns all of this into one Safe batch, checks it back through three RPCs, and runs a fork drill with your site switched off. Protocols that pass get the Copeybara certified tick.' },
];
