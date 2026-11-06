# Security model

## What users trust

- **Your ENS name and its Safe.** The release hash and the exit contracts come only from records the Safe signed.
- **The kit file they verified** against that hash. The kit's only built-in trust roots are the UniversalResolver address and default RPCs (`config/networks.json`). It contains no protocol addresses.
- **Two of three RPCs agreeing** at a pinned block. One lying or failing RPC cannot change what the kit reads.
- **Their own wallet**, which shows and signs each transaction.

## What they don't need to trust

- **Your website, DNS, CDN or frontend dependencies.** The kit runs without them. The extension checks them against `org.copeybara.site`.
- **Your website deploy key.** It can write `url` only (argument-scoped resolver role, proven by `roles-check`).
- **The watcher key.** It can write `status` and `blocklist` only. Neither can block an exit.
- **The Copeybara website.** The widget, the certified page and these docs only point users at things they verify against ENS.

## Guarantees

- **Fail-closed Exit Guard.** Every transaction the kit sends must target a manifest contract, use an allowlisted selector (also inside multicalls), pay only the connected account, carry no ETH and contain no approval, permit or transfer. Anything it cannot decode is refused. There is no override.
- **Proven recovery.** "Recovered" requires a successful receipt **and** a positive balance change of at least the simulated minimum for every payout token.
- **Self-contained kit.** One HTML file, one inline script pinned by CSP hash, no remote resources, byte-for-byte reproducible (`SOURCE_DATE_EPOCH=0`).
- **No third-party requests and no signatures.** The kit uses only connect, chain, `eth_estimateGas` and `eth_sendTransaction` wallet methods. No typed-data signing.
- **The SDK never signs.** It writes Safe proposals. Its batches are decoded and scope-checked before they are written.

## Not covered

- **A compromised Safe** (a quorum of owner keys) can publish a malicious release or manifest. Use independent owners on hardware wallets.
- **A malicious or broken contract** in your manifest: the kit calls what you list. Certification is not an audit.
- **Paused, locked or illiquid positions:** they are shown as manual, with the reason, and nothing is sent.
- **A user who runs an unverified file.** The kit is only as trusted as the hash check the user performs.
- **Wallet or browser compromise** on the user's machine.

## Reporting

Report vulnerabilities privately through the repository's security advisories. Please don't open public issues for them.
