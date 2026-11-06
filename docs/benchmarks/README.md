# Copeybara benchmarks

Measurements of Copeybara's detection code on public, real-world data. Every number below comes from the product's own functions:
`classifyRequest` (`packages/guard/src/classify.ts`), `hostMatches` / `parseBlocklist` / `formatBlocklist`
(`packages/core/src/records.ts`), the extension's DNR rule builder (`apps/extension/src/background/rules.ts`) and
`fetchCodeItems` / `checkScripts` (`packages/sitecheck`). Nothing about the classifier or the checks is mocked. Data that
had to be rebuilt is labeled **reconstructed** in each report.

| Benchmark | Report | Headline |
|---|---|---|
| Related work | [literature.md](literature.md) | 17 papers, reports and datasets. Used here: PTXPhish (NDSS'25), the ScamSniffer address and domain lists, MetaMask eth-phishing-detect, Ledger Connect Kit CDN artefacts, Wayback captures |
| B1 Drainer requests | [b1-drainer-requests.md](b1-drainer-requests.md) | First run: grants to drainers 430/430 `dangerous`, but **108/108 proxy-upgrade and 37/37 NFT bulk-transfer phish missed**, and **42.5%** of real dapp requests raised the red alarm. **After the fixes:** PTXPhish phish stopped (red or ask) **79.2% → 99.9%**, NFT bulk transfers 37/37 red, proxy upgrades 107/108 red + 1 ask. Benign red alarms **42.5% → 1.6%**, any alarm 47.3% → 4.3% |
| B2 Look-alike domains | [b2-lookalike-domains.md](b2-lookalike-domains.md) | 14,130 real phishing domains imitating 15 DeFi brands: **0** `hostMatches` safety violations. 100% are blocked *if listed*, **0%** if not. 94–100% of each brand's ScamSniffer look-alikes are missing from MetaMask's list |
| B3 Frontend hijacks | [b3-frontend-hijacks.md](b3-frontend-hijacks.md) | Real Ledger Connect Kit 1.1.5/1.1.6/1.1.7 payloads and the real Balancer hijack capture: all **mismatch**. First run: two evasions missed, `import()` chunks and fetch cloaking. **After:** the extension catches the `import()` chunk and a cloaked cacheable script. Still missed: a cloaked `no-store` script, and both evasions on the watcher's static path |
| B4 Guard robustness | below | 206 guard tests pass (152 before the fixes), including 62,300 generated property cases with 0 counterexamples |

## Reproduce

Node 22, `pnpm install`. The scripts live in `packages/guard/bench/` so they resolve `viem` and `@copeybara/core` from that
workspace. Network access is needed: Routescan's free Etherscan-compatible API, ethereum-rpc.publicnode.com, eth.drpc.org,
GitHub raw files, cdn.jsdelivr.net and web.archive.org. Responses are cached in `node_modules/.cache/copeybara-bench`.

```bash
cd packages/guard
../../node_modules/.bin/tsx bench/collect-drainers.ts 150   # B1 Set A positives  → docs/benchmarks/data/b1-drainer-requests.json (~35 min, API rate limits)
../../node_modules/.bin/tsx bench/collect-benign.ts         # B1 Set A negatives  → data/b1-benign-requests.json (recent blocks, so it changes per run)
../../node_modules/.bin/tsx bench/collect-ptxphish.ts 120   # B1 Set B (PTXPhish) → data/b1-ptxphish-requests.json
../../node_modules/.bin/tsx bench/bench-b1.ts               # → b1-drainer-requests.md, data/b1-results.json (offline, seconds)
../../node_modules/.bin/tsx bench/bench-b2.ts               # → b2-lookalike-domains.md, data/b2-results.json
../../node_modules/.bin/tsx bench/bench-b3.ts               # → data/b3-results.json (b3-frontend-hijacks.md is hand-written from it;
                                                             #   the extension rows need `node apps/extension/scripts/build.mjs` first)
cd ../.. && pnpm vitest run packages/guard                  # B4
```

Or run `tools/bench/run-all.sh`. The committed `data/*.json` files are the exact inputs and outputs the reports were generated from.
`bench-b1.ts` runs offline from them.

## B1: drainer-request detection

Full report: [b1-drainer-requests.md](b1-drainer-requests.md). Raw data: [data/b1-results.json](data/b1-results.json).

**Data.**
- **Set A** (our own collection): a seeded sample of 150 of ScamSniffer's 2,530 listed drainer addresses. We searched full mainnet history for approvals, Permit2 permits, transfers and ETH sends *to* them, then rebuilt the victim's request: 283 positives (275 real calldata, 8 signature-verified permit reconstructions). Negatives: 186 real requests from the last 2.8 days, 183 recent dapp requests plus 3 victims revoking drainer approvals.
- **Set B**: PTXPhish (NDSS'25), up to 120 hashes per labeled column. 697 phishing and 218 benign (KOL/developer) requests. Many PTXPhish hashes are the attacker's *drain*, not the victim's request. For those we found the victim's earlier grant (approve or permit) in the 30k blocks before the drain, and skipped the 48 where we found none.

**Scenarios.**
- S0: follows nothing, built-in well-known table off.
- S1: shipped default (built-in well-known table).
- S2: S1 + follows the published `config/manifest.json`.
- S3: S2 with only the old Uniswap-only table. It shows what the new table entries buy.

"red" = `dangerous`; "any" = `dangerous` or `risky`. Both stop the request in the extension; only red defaults to Cancel.

**Before → after the gap fixes** (shipped default, S1; the first run is kept in [data/b1-results-before.json](data/b1-results-before.json)):

| | drainers: red | drainers: any | benign: red | benign: any |
|---|---|---|---|---|
| Set A | 134/283 (47.3%) → 119/283 (42.0%) | 282/283 (99.6%) → **282/283 (99.6%)** | 79/186 (42.5%) → **3/186 (1.6%)** | 88/186 (47.3%) → **8/186 (4.3%)** |
| Set B (PTXPhish) | 312/697 (44.8%) → **455/697 (65.3%)** | 552/697 (79.2%) → **696/697 (99.9%)** | 39/218 (17.9%) → **19/218 (8.7%)** | 94/218 (43.1%) → 90/218 (41.3%) |

- Set A red went *down* by 15 on purpose. Those are plain `transfer`s straight to a drainer. They now ask (`risky`) instead of alarming, because the same request is how people pay each other (gap 6). They are still stopped.
- No drainer request in either set became `known` or `pass`, except one PTXPhish "Permit" row whose grant lookup found a real revoke tx, `approve(x, 0)`. It is now `pass`, which is right for that tx.
- With the old Uniswap-only table (S3), benign red is 32.3%. The rest of the drop comes from revocations and plain sends.

**First run (before the fixes)**, for the record:

| | positives: red / any | benign FP: red / any |
|---|---|---|
| Set A, S1 (shipped default) | 134/283 (47.3%) / **282/283 (99.6%)** | **79/186 (42.5%)** / 88/186 (47.3%) |
| Set A, S2 (following the manifest) | 47.3% / 99.6% | 71/186 (38.2%) / 47.3% |
| Set A, S3 (what-if, extended table) | 47.3% / 99.6% | **11/186 (5.9%)** / 5.9% |
| Set B (PTXPhish), S1 | 312/697 (44.8%) / **552/697 (79.2%)** | 39/218 (17.9%) / 94/218 (43.1%) |

Per category, first run (S1):
- **Permission grants are caught every time.** Approve (limited, unlimited), increaseAllowance, setApprovalForAll, EIP-2612 and DAI permits, and Permit2 single/batch to a drainer: 119/119 in Set A and 311/311 in Set B are `dangerous`. (Set B's 312 red also counts one Permit row whose "grant" lookup found a revoke tx, `approve(x,0)`. It is a lookup artefact, flagged because of gap 3.) ERC-20 `transfer` straight to a drainer: 15/15.
- **ETH sends and payable "claim / security update" calls** are 148/148 in Set A and 240/240 in Set B, all `risky` and never `dangerous`. The extension still stops and explains them, but without the red alarm.
- **Misses** (`unknown`, so no prompt at all):
  - **Proxy upgrade, 108/108.** The victim calls `upgradeTo(attacker impl)` on their own smart-contract wallet.
  - **NFT bulk transfer, 37/37.** The victim calls `bulkTransfer` on OpenSea's TransferHelper to send their NFTs to the attacker.
  - One no-value call into a drainer contract.
- **Benign red alarms** (Set A, S1) come from five sources:
  - approvals to well-known non-Uniswap spenders (1inch, 0x, CoW, Aave, Lido, the OpenSea conduit): 66
  - the explanation calls them "how wallet drainers work"
  - plain ERC-20 sends to anyone (stETH transfers): 5
  - **revocations**, `approve(x, 0)` and `setApprovalForAll(x, false)`: 7, including all 3 victims revoking drainers
  - one Lido call
  - In Set B: KOL token sends (15/16 red) and contract deployments (`risky`).

**Gaps found in the first run, and what changed.** Each fix has a test built from the benchmark's own rows
([`packages/guard/test/classify-gaps.test.ts`](../../packages/guard/test/classify-gaps.test.ts), real requests in
[`bench-cases.ts`](../../packages/guard/test/bench-cases.ts)). The Exit Guard still rejects every one of these calls: the new selectors are in
`BANNED_SELECTORS`.
1. **Ownership/upgrade phishing was invisible. Fixed.** `upgradeTo`, `upgradeToAndCall`, `transferOwnership`, `setOwner`, Safe `addOwnerWithThreshold` / `swapOwner` / `enableModule` / `setGuard` / `setFallbackHandler`, and Safe delegatecalls (inside `execTransaction`, `multiSend` or a signed `SafeTx`) are decoded. They are `dangerous` unless the new owner or code is you or a known/followed contract (then `risky`). The reason says who gets control: "This hands control of your Safe to 0x…". EIP-7702 delegations are checked where a request shows them (`authorizationList` on `eth_sendTransaction`). `changeThreshold` and removing another owner ask (`risky`); removing *you* is `dangerous`. `upgradeTo(your own account)` asks, because an account is not code and the proxy would break. Result: 107/108 red, 1/108 ask.
2. **NFT bulk-transfer helpers. Fixed.** OpenSea TransferHelper `bulkTransfer` and ERC-1155 `safeTransferFrom` / `safeBatchTransferFrom` are decoded; anything sent to someone other than you is `dangerous`. Result: 37/37.
3. **Revocations raised the drainer alarm. Fixed.** `approve(x, 0)`, `setApprovalForAll(x, false)`, Permit2 `approve(…, 0, …)` and `lockdown`, and permit signatures for 0 (or DAI `allowed: false`) are `pass`: "Removes a permission … This is safe." A revocation that also sends ETH to an unknown contract still asks.
4. **Reason text read the amount from the outer calldata. Fixed.** The decoder returns each call's own amount.
5. **Well-known table covered only Uniswap. Fixed.** [`config/known-contracts.json`](../../config/known-contracts.json) now lists 1inch (Aggregation Router v5, v6), 0x (AllowanceHolder, Exchange Proxy), CoW Protocol (Vault Relayer, Settlement), Aave v3 (Pool, ETH gateway), Lido (stETH, wstETH, Withdrawal Queue), OpenSea (Seaport 1.5/1.6, conduit, Conduit Controller) and Safe's MultiSend libraries, on mainnet and on Sepolia where the project lists a deployment. Each address comes from the project's own docs or repo (sources in the JSON) and has bytecode (`cast code`, 2026-11-07).
6. **Plain token sends were red. Changed.** A direct ERC-20 `transfer` to an address no followed protocol publishes is now `risky`: "You are sending N units of the token at 0x… to 0x…. Make sure you know this address." Sends inside a multicall or a batch, `transferFrom` and NFT transfers stay `dangerous`. There is no drainer address list in the classifier, so a direct send to a drainer also only asks (15 rows in Set A).

What still alarms on benign traffic: approvals to spenders we do not list (2 in Set A, 19 in PTXPhish's KOL/developer set), plain token sends and ETH sends (ask), contract deployments (ask), and payable calls to unknown contracts (ask).

Not measured: Seaport/Blur order signatures (464 PTXPhish "free buy order" rows are attacker fills). Copeybara flags any `*Order*` typed data as `risky` by type alone. Address poisoning (226 rows) is attacker-sent, so there is no victim request.

## B2: look-alike domains

- **Safety holds.** We checked every one of the 14,130 look-alikes against every real host of its brand, in both directions, plus 5 suffix/prefix tricks per apex. `hostMatches` never confuses them (0 violations), so a protocol can list look-alikes without risking its own site.
- **Coverage is all or nothing.** Every listed host that `parseBlocklist` accepts is blocked, and so are all its subdomains. DNR `requestDomains` and `hostMatches` share the same label-boundary semantics. An unlisted look-alike is never blocked: Copeybara has no fuzzy matching. MetaMask's detector, for comparison, has a fuzzylist with edit-distance tolerance 1.
- **Freshness is the real limit.** A protocol that copied MetaMask's list would still miss 94–100% of the look-alikes ScamSniffer knows for the same brand. The feeds barely overlap, and the public ScamSniffer copy lags 7 days.
- **Cost.** One domain is about 25 bytes of the ENS text record. Uniswap's 1,820 look-alikes come to 44 KiB, roughly 31M gas to write. A protocol can publish a curated short list, not a feed. The extension makes one DNR rule per domain (Chrome allows 30,000 dynamic rules).
- **Path-based phishing cannot be expressed.** We found 3 phishing pages on `sites.google.com/view/…` and similar paths. A host-only blocklist would have to block all of `sites.google.com`, and `parseBlocklist` correctly rejects paths. 3,333 look-alikes live on shared hosting (`*.pages.dev`, `*.vercel.app`, …), which works fine because the specific subdomain gets listed.
- **What protects the user on an unlisted look-alike** is `classifyRequest` on the wallet request the site makes. See B1 for per-category detection on real drainer-kit requests.

## B3: frontend hijacks

See [b3-frontend-hijacks.md](b3-frontend-hijacks.md). In short:

- **Real payloads, all caught.** Connect Kit 1.1.5, 1.1.6 and 1.1.7 (fetched from cdn.jsdelivr.net, which still serves them) and the Balancer 2023-09-20 hijacked-host capture are all `mismatch`. The reconstructed Curve clone (real legit bundle plus appended code) is `mismatch` too. The drainer requests are `dangerous`: the real Curve R1 approve, plus reconstructed Angel Drainer approve and Permit2 requests.
- **The cost of floating dependencies.** Connect Kit's legitimate 1.1.8 to 1.1.12 releases are also `mismatch`, because dapps loaded `connect-kit@1`. A fingerprinted site must pin third-party versions, or every upstream release blocks it until the Safe re-publishes.
- **Gap G1, `import()`. Fixed in the extension.** The content script now also hashes every `.js`/`.mjs` URL that shows up in resource timing (`import()` chunks, module workers, preloads, fetched JS) and every `<link rel=modulepreload>`. With the real built content script in Chromium, a modified lazy chunk is now `mismatch` (it was `match`). Still not covered: `eval` / `new Function` of strings, `blob:`/`data:` workers, WebAssembly. The watcher's static path still only reads `<script>` tags.
- **Gap G2, cloaking. Partly mitigated.** The extension reads same-origin scripts with `cache: 'only-if-cached'` first, so it hashes the cache entry the page itself used. A server that gives the drainer only to real script loads (`Sec-Fetch-Dest: script`) is now caught *if the response is cacheable*. Honest note: Chromium's old `force-cache` read already reused that entry (we probed it; see the B3 report), so this makes the behavior explicit rather than adding new catches. A `no-store` response is not in the cache: the extension falls back to a re-fetch, which the server can cloak, and the result is still `match`. The watcher still re-fetches with a Node user agent.

## B4: Guard robustness (existing tests)

`pnpm vitest run packages/guard` on 2026-11-07, after the gap fixes: **9 files, 206 tests, all pass** (first run: 7 files, 152 tests).

- 6 fast-check properties of the fail-closed Exit Guard × 10,000 runs each: valid exits pass; a mutated recipient, target, selector, value or an injected approve always fails.
- A Uniswap v4 action-sequence property × 2,000 runs (accept ⇔ only exit actions and every TAKE_PAIR pays the user).
- A `classifyRequest` fuzz over random calldata × 300 runs.
- In total **62,300 generated cases, 0 counterexamples**, plus the 42-entry banned-calldata corpus (including the real Curve 2022 attacker calldata).

These are the project's own tests, reported as-is. They show the Guard is fail-closed on its input space. They do not measure detection on real-world traffic, which is what B1 does.

## Honest limits

- **Sample sizes are small** (hundreds of requests per set, not the full datasets) because of free-API rate limits.
  The samples are seeded, so they are reproducible. The benign "recent dapp traffic" set comes from a 2.8-day window.
- **Label noise.** ScamSniffer's address list is a scam/drainer list frozen in February 2024. ETH sent to a listed address is counted as a victim request, which is mostly true but not always. PTXPhish labels come from the authors.
- **Reconstructed rows.** Off-chain signatures (EIP-2612 / DAI / Permit2) were rebuilt from the on-chain calldata that consumed them. `reconstructed-verified` means the rebuilt EIP-712 message recovers to the owner's address. `reconstructed-unverified` means the spender and amount come from events or calldata, but the nonce or deadline could not be confirmed. The classifier only uses the domain, `primaryType` and `spender`, so the verdicts do not depend on those fields.
- **Out of scope.** Address poisoning and "free buy order" fills are sent by the attacker, not the victim, so there is no user request to classify. They are listed as skipped, not counted as misses. Signed Seaport/Blur orders are flagged `risky` by type (`/order/i`) whatever their content. We did not rebuild them.
- **Only the classifier is measured.** The extension's UI flow (how it stops and explains a request) is not part of these numbers.
