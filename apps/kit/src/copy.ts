/** Every user-facing string in the kit. Plain language; no jargon in primary text. */
export const COPY = {
  title: 'BLACKOUT exit kit',
  tagline: "Withdraw straight from the protocol's contracts, even when its website is down or hijacked.",
  needName: "Enter the protocol's ENS name. Get it from the protocol's docs or where you deposited, never from this file.",
  nameHint: "From the protocol's docs, never from this file",
  loadingRecords: (n: string) => `Reading ${n} from ENS through 3 independent RPC providers. They must all agree…`,
  connecting: 'Approve the connection in your wallet — click its toolbar icon if no popup appeared (MetaMask: the fox, top right).',
  findingPositions: 'Asking the protocol’s contracts which positions your wallet holds…',
  noExitsOnChain: (id: number) => `This protocol has no exits listed for chain ${id}.`,
  verifyTitle: 'Check this file yourself',
  verifyBody:
    'This page cannot prove it has not been tampered with. Compare its fingerprint with the ENS release record using a tool outside this page:',
  rollback: 'Warning: this release is older than one you used before. Someone may be trying to roll back to an old kit.',
  noPositions: 'No positions found for this wallet on this network.',
  exit: 'Exit',
  exitAll: 'Exit all',
  exiting: 'Exiting…',
  recovered: 'Recovered',
  notRecovered: 'Not recovered',
  blocked: 'Blocked by the Exit Guard',
  unsimulated: 'Could not simulate',
  downloadJson: 'Download report (JSON)',
  downloadHtml: 'Download report (HTML)',
  manual: 'Needs manual action',
  trusted: 'Still trusted: your wallet and its RPC, Ethereum, ENS, and the protocol’s release Safe.',
} as const;

export const STEPS = [
  { n: 1, title: 'Verify', what: 'The kit reads the protocol’s ENS name: the official fingerprint of this kit and the list of exit contracts. Three independent providers must agree, or it stops.' },
  { n: 2, title: 'Connect', what: 'Your wallet shares your address. The kit never sees your keys, and the only transactions it can ask for are withdrawals to you.' },
  { n: 3, title: 'Positions', what: 'The kit asks the protocol’s own contracts which positions your address holds. The website is not involved.' },
  { n: 4, title: 'Exit', what: 'Each withdrawal is checked by the Exit Guard (only to you, no approvals, no ETH), rehearsed first, then sent. “Recovered” appears only after your balances really go up.' },
] as const;
