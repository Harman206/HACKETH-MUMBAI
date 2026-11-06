/** Copy for the extension page. Source of truth: README → Browser extension (apps/extension). */

export const EXT_HERO = {
  title: 'It reads ENS before your wallet reads the request.',
  sub: 'The Copeybara extension checks every followed protocol site against the script fingerprint that protocol published on ENS, blocks flagged sites before they load, and holds drainer requests before your wallet shows them.',
};

export const VERDICTS = [
  { v: 'exit', tone: 'ok', what: 'Passes the Exit Guard for a protocol you follow.', then: 'Goes through.' },
  { v: 'known', tone: 'ok', what: 'A contract in a followed manifest or the built-in Uniswap table (Permit2, Universal Router, position managers).', then: 'Goes through.' },
  { v: 'unknown', tone: 'muted', what: 'An ordinary call to a contract no followed protocol lists.', then: 'Goes through, labelled.' },
  { v: 'risky', tone: 'warn', what: 'An approval or permit to a followed protocol’s contract, ETH to an unknown address, unreadable data, or connecting on a look-alike site.', then: 'Confirm window first.' },
  { v: 'dangerous', tone: 'bad', what: 'Approve, permit, Permit2 or transfer to an address no followed protocol publishes; eth_sign; signing a bare 32-byte hash.', then: 'Confirm window, Cancel by default.' },
] as const;

export const LAYERS = [
  { title: 'Service worker: the only place that decides', body: 'Reads ENS through the 3-RPC quorum, computes every verdict and checks each message’s sender with Chrome’s own data. It never trusts a verdict a page claims.' },
  { title: 'Content script: watches, never decides', body: 'Hashes every script a page runs from document_start and relays wallet requests. It has no storage access.' },
  { title: 'Wallet shim: waits for the answer', body: 'Wraps window.ethereum and EIP-6963 providers (send, sign, typed data, wallet_sendCalls, connect) and waits for the worker. A blocked request is rejected with code 4001.' },
  { title: 'Trusted UI only', body: 'Badge, side panel, setup wizard, dashboard, warning page and confirm window are extension pages. Verdicts are never drawn inside the web page.' },
];

export const BLOCKS = [
  { title: 'Blocked before a byte runs', body: 'When a followed protocol’s ENS status says compromised, or a domain is on its blocklist, Chrome cancels the page load itself (declarativeNetRequest) and the tab moves to the warning page.' },
  { title: 'Fingerprint mismatch', body: 'Any script outside the published set replaces the tab with the warning page, and every wallet request from that site is blocked. A script it cannot re-read is “can’t verify” (amber), never green.' },
  { title: 'Look-alike connect warning', body: 'On a site whose host imitates a followed protocol (its distinctive label without being the official host), “Don’t connect your wallet here” opens before the wallet’s own connect popup.' },
  { title: 'Saved by Copey!', body: 'Cancel a risky request, or land on a blocked page, and a short celebration plays: a shower of Copeys, one line on what you avoided, and a jingle. Reduced motion respected, mute remembered.' },
];

export const VERIFY_INSTALL = `# Check the folder you loaded (or the zip) against ENS, from outside the browser
scripts/verify-extension.sh ~/copeybara-extension-chrome demoswap-blackout.eth   # MATCH / MISMATCH
scripts/verify-extension.sh --rebuild copeybara-extension-chrome.zip              # rebuild, compare bytes`;

export const EXT_LIMITS = [
  'In-page interception is best effort: a hostile page can talk to the wallet before the shim wraps it. The blocks you can rely on are the worker’s: cancelling the load, and replacing the tab on a mismatch.',
  'Chrome cannot fully prove which bytes ran. The extension hashes the browser’s cached copy of each script, which is normally, but not provably, the copy that executed.',
  'The look-alike check is a name heuristic. A look-alike with an unrelated name is caught only by its later requests or by the blocklist.',
  'It protects people who installed it and follow the protocol. Sepolia testnet preview, installed unpacked, not in any store yet. Stats stay on your device.',
];
