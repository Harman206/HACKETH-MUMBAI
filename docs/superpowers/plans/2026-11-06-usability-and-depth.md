# BLACKOUT usability and partner depth: implementation plan

> Executed inline (the user said "start implementation and go for it"). Test-first; one commit per task, pushed.

**Goal:** Raise usability from 4/5 to 5/5, add booth polish, and deepen partner integrations (Anon-RPC, Uniswap v4, ENS contenthash/IPFS) without weakening the kit's trust model.

## Global constraints (unchanged from the product-finish plan)
- The kit stays one inline-script HTML file with the hashed CSP, < 1 MB, reproducible, 0 third-party requests.
- The protocol name never comes silently from the kit. A demo link uses `?ens=`, which shows the confirm banner.
- Every kit change ends with an ENS release bump (`live-setup.sh`) and a site redeploy (`scripts/deploy-site.sh`), each verified with `verify-kit.sh` MATCH.

## Tasks

### Usability
- **A1:** `runExit` emits progress (`ExitProgress { stage: 'guard'|'simulate'|'wallet'|'sent'|'balances'|'done', txHash?, at }`) via `RunCtx.onProgress`. The flow stores `progress[id]` and `batch {done,total}`. The UI shows live stage text, elapsed seconds and the tx link as soon as it is sent.
- **A2:** `apps/kit/src/errors.ts` `humanize(msg) → { text, fix?: 'faucet'|'switch-chain'|'add-rpc'|'retry'|'install-wallet'|'serve-localhost'|'check-name' }`. Used for flow errors and result reasons, with one-click fixes.
- **A3:** `ensureChain` adds Sepolia via `wallet_addEthereumChain` when the switch fails with 4902. No-wallet and `file://` guidance.
- **A4:** The website's "Try the demo" link is `blackout-kit.html?ens=demoswap-blackout.eth`, so the confirm banner shows.
- **A5:** The website installs a service worker (network-first, cache fallback) so the hosted kit opens offline after one visit, plus an "Available offline" badge. Vercel sends `/sw.js` with no-cache.
- **A6:** Kit mobile layout: no horizontal scroll at 360 px (Playwright).

### Booth
- **E1:** `nextStep(state)` and a sticky "Next step" bar in the theater.
- **E2:** A QR code for the live site, built at build time, as static SVG in the footer and the theater.

### Depth
- **D1:** Anon-RPC spike: check Sepolia support and how a browser app consumes it. Go: an opt-in quorum path. No-go: documented.
- **C1–C3:** Uniswap v4:
  - addresses verified on chain; Actions from v4-periphery source;
  - Guard decoding of `modifyLiquidities` (DECREASE_LIQUIDITY / BURN_POSITION / TAKE_PAIR, recipient pinned);
  - discovery via `balanceOf` plus a backwards Transfer-log scan, with a manual position ID fallback;
  - principal amounts from TickMath/LiquidityAmounts with simulation;
  - Sepolia seed and fork tests;
  - manifest update published by the Safe.
- **B1:** The kit on IPFS: a deterministic CID (`ipfs-car`), an ENS `contenthash` written by the Safe, the kit and site showing the CID, and a pin script that runs when the user supplies a pinning token.

### Ship
- **R1:** Fresh review, fixes, full suites, ENS release bump, site redeploy, live smoke.
