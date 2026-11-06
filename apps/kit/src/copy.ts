/** Every user-facing string in the kit. Plain language; no jargon in primary text. */
export const COPY = {
  title: 'Copeybara exit kit',
  tagline: "Withdraw straight from the protocol's contracts, even when its website is down or hijacked.",
  needName: "Enter the protocol's ENS name. Get it from the protocol's docs or where you deposited, never from this file.",
  nameHint: "Copy it from the protocol's docs, never from this file",
  loadingRecords: (n: string) => `Reading ${n} from ENS through 3 independent RPC providers. They must all agree…`,
  connecting: 'Approve the connection in your wallet — click its toolbar icon if no popup appeared (MetaMask: the fox, top right).',
  connectPending: 'MetaMask is already asking you to connect. Click the MetaMask icon in your browser toolbar and approve it.',
  connectPendingWait: 'Waiting for your approval — this page continues by itself as soon as you approve.',
  cancel: 'Cancel',
  findingPositions: 'Asking the protocol’s contracts which positions your wallet holds…',
  noExitsOnChain: (id: number) => `This protocol has no exits listed for chain ${id}.`,
  verifyTitle: 'Check this file yourself',
  verifyBody:
    'This page cannot prove it has not been tampered with. Compare its fingerprint with the ENS release record using a tool outside this page:',
  rollback: 'Warning: this release is older than one you used before. Someone may be trying to roll back to an old kit.',
  noPositions: 'No positions found for this wallet on this network.',
  exit: 'Exit',
  exitAll: 'Exit all',
  exitHelp: 'Press Exit on a position, or Exit all. Your wallet asks you to confirm each withdrawal; every one goes only to your own address.',
  how: (network: string) => [
    { title: 'Type the protocol’s ENS name', body: 'Copy it from the protocol’s docs, e.g. demoswap-blackout.eth. Never trust a name from a link.' },
    { title: `Connect MetaMask on ${network}`, body: 'Only your address is shared. The kit never sees your keys and never asks you to sign a message.' },
    { title: 'Press Exit', body: 'MetaMask asks you to confirm each withdrawal. Every one pays out only to your own address.' },
  ],
  checksTitle: 'What the kit checks before anything is sent',
  checks: [
    { title: 'Official release', body: 'Reads the kit fingerprint and the list of exit contracts from the protocol’s ENS name.' },
    { title: '3 RPCs agree', body: 'Three independent providers must give the same answer, or the kit stops.' },
    { title: 'Exit Guard', body: 'Every transaction must withdraw to you only: no approvals, no transfers, no ETH sent.' },
  ],
  exiting: 'Exiting…',
  recovered: 'Recovered',
  notRecovered: 'Not recovered',
  blocked: 'Blocked by the Exit Guard',
  unsimulated: 'Could not simulate',
  downloadJson: 'Download report (JSON)',
  downloadHtml: 'Download report (HTML)',
  manual: 'Needs manual action',
  trusted: 'Still trusted: your wallet and its RPC, Ethereum, ENS, and the protocol’s release Safe.',
  progress: {
    checking: 'Checking the transaction with the Exit Guard…',
    simulating: 'Rehearsing the withdrawal on independent RPC providers…',
    wallet: 'Confirm in your wallet. No popup? Click the wallet’s toolbar icon.',
    confirming: 'Sent. Waiting for a block, usually about 12 seconds…',
    balances: 'Confirmed. Checking that your balances really went up…',
  },
  exitingBatch: (n: number, total: number) => `Exiting ${n} of ${total}…`,
  lowFees: (eth: string) => `Your wallet holds ${eth} ETH. Each exit pays a small network fee in ETH, so this may not be enough.`,
  faucet: 'Get free Sepolia ETH',
  tryAgain: 'Try again',
  switchAndRetry: (network: string) => `Switch to ${network} and continue`,
  addRpc: 'Add my own RPC',
  editName: 'Edit the name',
  noWallet: 'No browser wallet detected yet.',
  serveCmd: (file: string) => `cd <the folder with ${file}>\npython3 -m http.server 8000\n# then open http://localhost:8000/${file}`,
} as const;

/** A public Sepolia faucet (a link only; the kit never contacts it). */
export const FAUCET_URL = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
export const WALLET_LINKS = [
  { name: 'MetaMask', href: 'https://metamask.io/download/' },
  { name: 'Rabby', href: 'https://rabby.io/' },
] as const;

export const STEPS = [
  { n: 1, title: 'Verify', what: 'The kit reads the protocol’s ENS name: the official fingerprint of this kit and the list of exit contracts. Three independent providers must agree, or it stops.' },
  { n: 2, title: 'Connect', what: 'Your wallet shares your address. The kit never sees your keys, and the only transactions it can ask for are withdrawals to you.' },
  { n: 3, title: 'Positions', what: 'The kit asks the protocol’s own contracts which positions your address holds. The website is not involved.' },
  { n: 4, title: 'Exit', what: 'Each withdrawal is checked by the Exit Guard (only to you, no approvals, no ETH), rehearsed first, then sent. “Recovered” appears only after your balances really go up.' },
] as const;
