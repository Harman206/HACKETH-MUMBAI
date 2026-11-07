# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Copeybara: a single self-contained HTML **exit kit** that lets a DeFi user withdraw positions straight from protocol contracts when the protocol's website, DNS or RPC is down or hijacked. The kit's sha256 and the list of allowed exit contracts are published in the protocol's **ENSv2** name (Sepolia). It also ships a browser extension (`apps/extension`) and a watcher agent (`apps/watcher`). Renamed from BLACKOUT: ENS records are `org.copeybara.{release,manifest,site,extension,status,blocklist}`; the old `org.blackout.*` records stay frozen on chain for already-saved kits; the ENS name stays `demoswap-blackout.eth`. README.md is the source of truth for claims, trust boundaries and honest limits; keep it in sync with behavior.

## Commands

Node 22 (`.nvmrc`), pnpm 9 (`corepack enable && pnpm install`). Foundry is needed for `contracts/` and `replay/` (forge-std is a git submodule).

```bash
pnpm typecheck                     # tsc -b over the project references in tsconfig.json
pnpm test                          # vitest unit tests (all workspaces; excludes *.fork.test.ts) — this is what CI runs
pnpm vitest run packages/guard/test/guard.test.ts     # a single test file
pnpm vitest run -t "name of test"                     # a single test by name
pnpm test:fork                     # *.fork.test.ts: spawns anvil forks; needs MAINNET_RPC / SEPOLIA_RPC; serial

pnpm --filter @copeybara/kit build  # → apps/kit/dist/copeybara-kit.html + .sha256 (use SOURCE_DATE_EPOCH=0 for the published bytes)
node apps/extension/scripts/build.mjs   # → apps/extension/dist/{chrome,firefox}/ + copeybara-extension-{chrome,firefox}.zip (+ .sha256), reproducible
pnpm --filter @copeybara/site build # needs the kit AND the extension built first (copies kit, extension zips + demo-runs/latest.json into apps/site/dist; fails if missing)
cd apps/extension && pnpm e2e       # extension e2e (Playwright, real unpacked extension)
WATCHER_KEY=… WATCH_NAMES=demoswap-blackout.eth pnpm --filter @copeybara/watcher start   # watcher agent
cd apps/kit && pnpm exec playwright test [e2e/drill.spec.ts]   # browser e2e (injected EIP-6963 test wallet)

cd contracts && SEPOLIA_RPC=… forge test     # ENSv2 setup + must-revert permission tests on a Sepolia fork
cd replay && forge test                      # incident replays (ARCHIVE_RPC)
pnpm --filter @copeybara/replay replay R1     # writes replay/out/R1.{md,html}
pnpm --filter @copeybara/harness start        # Fire Drill / Attack Theater harness (control page on :8090)
scripts/verify-kit.sh <kit.html> demoswap-blackout.eth   # independent kit-vs-ENS fingerprint check
```

Note: `apps/kit/test/build.test.ts` runs a real kit build inside `pnpm test`.

## Architecture

pnpm workspace; internal packages are consumed as TS source (`main: src/index.ts`, no build step). Dependency order: `core` → `guard`, `quorum`, `sitecheck` → `ens`, `adapters` → `exec` → `apps/kit`, `apps/extension`, `apps/watcher`.

- **`packages/core`** — shared types, canonical function signatures → selectors (`EXIT_SELECTORS`), minimal ABIs, and the codecs for the `org.copeybara.*` ENS text records (`COPEYBARA_KEYS`: release, manifest, site, extension, status, blocklist).
- **`packages/guard`** — the fail-closed **Exit Guard** (pure TS): every tx the kit sends must target a manifest contract, use only allowlisted selectors (including inside multicalls), pay only the connected account, carry `value` 0, and never contain approvals/permits/transfers. Any decode failure → reject; the UI has no override. `explain()` produces the plain-language reasons. `classify.ts` gives the extension's verdict for any wallet request (pass / exit / known / unknown / risky / dangerous). Tested by a banned-calldata corpus (incl. real Curve 2022 attacker calldata) and fast-check property tests.
- **`packages/quorum`** — all reads go through 3 RPC paths at a pinned block: ≥2 must answer and all answers must agree, otherwise stop. Heads far from the median are dropped.
- **`packages/ens`** — `readCopeybaraRecords`: reads `url` + the six `org.copeybara.*` records at one pinned block via the ENSv2 UniversalResolver, through the quorum. `release` + `manifest` are required; malformed optional records go to `problems`, never stop an exit.
- **`packages/sitecheck`** — site fingerprint shared by extension and watcher: script hashing (`normaliseBundle` + sha256), set check against `org.copeybara.site` (match / mismatch / unverifiable / unset), static extraction of inline code, event handlers and `javascript:` URLs.
- **`packages/adapters`** — per-protocol discovery + exit-tx builders (Uniswap v3, Aave v3 supply-only, Curve 3pool). Minimums come from `eth_call` simulation minus slippage.
- **`packages/exec`** — `runExit`: Guard → simulate → send → receipt → per-token positive balance delta. "Recovered" requires both.
- **`packages/protocol-cli`** — the `copeybara` CLI for protocol teams (manifest, release, fingerprint, propose, verify, certify, roles-check, drill, incident, watcher, adapter new). Never holds a key: every record write is a Safe Transaction Builder batch checked by `assertBatchScope`. `src/onchain.ts` is the browser-safe part the site uses for the certified check. Guide: `docs/protocol-integration.md`.
- **`packages/fingerprint`** + **`vite-plugin` / `next-plugin` / `webpack-plugin`** — build-time site fingerprint (`.well-known/copeybara-site.json`, CI summary); fail on unpinned third-party scripts; never publish.
- **`packages/widget`** — `<copeybara-exit>`, one hand-written dependency-free file; `pnpm --filter @copeybara/widget hash` after editing it (the site build checks the sidecar).
- **`packages/testkit`** — test-only anvil fork/funding helpers; must never be imported by the kit.
- **`apps/kit`** — Vite + Preact single-file build. `flow.ts` is the state machine (setup → loading → positions → exit); `check.ts` is the "Check a transaction" tab and site-bundle hash check. The only trust roots baked in are in `config/networks.json` (UniversalResolver address + default RPCs); protocol addresses come from the ENS manifest, never from kit code.
- **`apps/extension`** — MV3 extension (Chrome; Firefox best effort). Service worker (`src/background`) = trust core: only storage writer, ENS via quorum, all verdicts, sender checks, DNR rules that block `status=compromised` sites and blocklisted domains before load. Isolated content script hashes every script; MAIN-world shim (`src/shim`) wraps wallet providers and decides nothing. Trusted pages: popup, setup wizard, dashboard, warning, confirm. Stats are local only. Reproducible zips; the Chrome zip's sha256 is `org.copeybara.extension`.
- **`apps/watcher`** — Node agent: fingerprints the official site, 2 mismatches → writes `status=compromised`, clears only alarms it raised; look-alike domains → `blocklist`. Its ENS key holds only the status + blocklist setter roles. Optional Claude note (`ANTHROPIC_API_KEY`) from structured facts only.
- **`apps/site`** — the public landing page (incl. the extension download with its sha256) + "Attack Theater" (live Sepolia attack/rescue replication, driven by the harness via `?booth=`).
- **`harness`** — Fire Drill services: fake DemoSwap site, hijacked clone (`hijack/inject.js`), primary RPC proxy that can be killed, drainer bot, theater control API.
- **`contracts`** — Foundry scripts that set up the ENSv2 name owned by a 2-of-3 Safe, a per-app PermissionedResolver where the website key may only write `url` and the watcher key only `org.copeybara.status` / `.blocklist` (`grantWatcherRoles`), and must-revert permission tests. `live-setup.sh` writes `contracts/deployments/sepolia*.json`.
- **`replay`** — Incident Replay Lab: fixtures (R1 = Curve 2022 hijack, C1 = control) replayed with `vm.transact`, plus kit exits at the incident block.
- **`tools/manifest/build.ts`** — regenerates `config/manifest.json` from the core codec.

## Invariants to preserve

- **Reproducible, self-contained kit.** The build must produce exactly one inline `<script>` (pinned by hash in a CSP meta injected by `apps/kit/scripts/inject-csp.mjs`), no external assets, and identical bytes across builds (`SOURCE_DATE_EPOCH=0`; `vite.config.ts` forces production mode). Any kit change changes its sha256, so the published ENS release record and hosted kit go stale until re-released.
- **Zero third-party requests** from the kit (Playwright `no-trackers.spec.ts`). The only wallet methods used are connect/chain methods, `eth_estimateGas` and `eth_sendTransaction` — no typed-data signing.
- **Guard is fail-closed.** Don't add escape hatches or overrides.
- **Docs are tested** (`scripts/check-docs.test.ts`): relative links in README/FEEDBACK/docs must resolve, and every tx hash in README must appear in `contracts/deployments/`, `replay/fixtures/` or `docs/replay/`. The README `LIVE-DEPLOYMENT` block is generated by `node scripts/readme-live.mjs` — don't hand-edit it.

## Deploy

GitHub Pages workflow builds kit + site on push to main. Vercel production (https://blackout-red.vercel.app) is deployed with `scripts/deploy-site.sh`, which then verifies the hosted kit against the ENS record. Secrets (`DEPLOYER_KEY`, `ATTACKER_KEY`, Safe owner keys) live in `contracts/.env` (gitignored).
