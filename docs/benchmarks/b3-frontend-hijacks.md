# B3: Frontend-hijack incidents through the site fingerprint check

Script: `packages/guard/bench/bench-b3.ts`. Raw output: [data/b3-results.json](data/b3-results.json).

The script runs the product's own `@copeybara/sitecheck` code: `fetchCodeItems` (the watcher's static path), `scriptHash` and `checkScripts`. The extension's live path hashes the same `<script>` elements, inline code and handlers, using a MutationObserver. The drainer requests go through `classifyRequest`. The "published set" for each incident is the script-hash set of the legitimate page, which is what the protocol's Safe would have put in `org.copeybara.site`.

## Results

| Incident | Page state | Evidence | Verdict | Expected |
|---|---|---|---|---|
| Ledger Connect Kit (2023-12-14) | before: published set = dapp bundle + connect-kit 1.1.4 | **real bytes** (cdn.jsdelivr.net) | match | match |
| | malicious 1.1.5 (legit code + stage-2 `<script>` loader) | **real bytes**; the stage-2 package now returns 403 | **mismatch** (connect-kit@1 unknown; stage 2 unreadable) | mismatch |
| | malicious 1.1.6 (244-byte loader only) | **real bytes** | **mismatch** | mismatch |
| | malicious 1.1.7 (1.87 MB with the drainer inlined) | **real bytes** | **mismatch** | mismatch |
| | fixed 1.1.8, not yet re-published by the dapp | real bytes | mismatch (false alarm until the Safe re-publishes) | mismatch |
| | legit 1.1.9 (Jan 2024), 1.1.12 (Feb 2024) | real bytes | mismatch (false alarm on every upstream release) | mismatch |
| Balancer (2023-09-19/20, EuroDNS) | before: 2023-09-08 capture (published set) | **real Wayback capture** | match | match |
| | during: 2023-09-20 04:40 UTC capture. The hijacked host sits behind Cloudflare's "Suspected phishing" interstitial | **real Wayback capture** | **mismatch** (3 unknown inline scripts) | mismatch |
| | after: 2023-09-23 legit redeploy with a new bundle | real Wayback capture | unverifiable (the new bundle was never archived, so its hash is null) | the browser path would give mismatch until re-published |
| Curve (2022-08-09, iwantmyname DNS) | before: 2022-08-09 11:06 UTC capture (published set) | real Wayback capture | match | match |
| | hijack window: 20:51 UTC capture | real capture, but the Wayback crawler reached the legit origin (byte-identical bundles) | match | (not the attacker's copy) |
| | hijacked clone: same HTML and file names, modified `app.9b0312df.js` | **RECONSTRUCTED** injection appended to the real legit bundle | **mismatch** | mismatch |
| Evasion E2 (synthetic) | malicious lazy chunk loaded with `import()` | synthetic page, real `fetchCodeItems`/`checkScripts` | **match (missed)** | should be mismatch |
| Evasion E1 (synthetic) | server cloaks by User-Agent | synthetic server, real `fetchCodeItems`/`checkScripts` | **match (missed)** | should be mismatch |

Drainer requests from these incidents, run through `classifyRequest` (fresh install, follows nothing):

| Incident | Request | Evidence | Verdict |
|---|---|---|---|
| Curve 2022 | `approve(0x9Eb5…8881, 400,000 USDC)` | **real calldata**, tx `0xec72bb41…` ([replay/fixtures/R1.json](../../replay/fixtures/R1.json)) | dangerous |
| Ledger Connect Kit 2023 | `approve(0x6587…5c2d, max)` on USDT | RECONSTRUCTED; the address is the Angel Drainer customer address as attributed by ZachXBT (not checked on chain) | dangerous |
| Ledger Connect Kit 2023 | Permit2 `PermitBatch` to the same address | RECONSTRUCTED | dangerous |
| Balancer 2023, Squarespace/Compound 2024 | — | no drainer request in a primary source; their kits (Angel, Inferno) are covered by B1 | — |

## What this shows

- **Every real injected payload we could get was flagged.** That covers 3 of 3 malicious Connect Kit builds and the real Balancer hijack capture. The reconstructed Curve clone was flagged as well. This follows from the design: any byte change to any executed script is a mismatch. There is no heuristic to evade, as long as the changed code appears as a `<script>` element, inline code or a handler.
- **The Ledger case shows the cost too.** Dapps loaded connect-kit through a *floating* tag (`connect-kit@1`). The fingerprint therefore also flags every legitimate upstream release: 1.1.8 (the fix, 4 hours later), then 1.1.9 through 1.1.12 within seven weeks. Each one blocks the dapp until its Safe re-publishes `org.copeybara.site`. Connect Kit had 13 releases between June 2023 and February 2024. A site that pins third-party code by hash should pin the *version* as well (or use SRI). Otherwise the fingerprint becomes an availability problem.
- **Same for first-party redeploys** (Balancer, 2023-09-23): a new bundle is a mismatch until the record is re-published. Releases must go through the Safe *before* deploying, as the README's release flow already says.
- The Balancer capture is a useful real negative control. During the hijack, the Wayback crawler got Cloudflare's phishing interstitial for the attacker's host. Its three inline scripts are unknown, so the result is mismatch and the extension blocks the tab.

## Gaps found (not fixed; product code is out of scope for this task)

**G1: Code loaded with `import()` is never hashed (E2).** The live content script (`apps/extension/src/content/index.ts`) hashes `<script>` elements, inline code and handlers that a MutationObserver sees. The static path (`extractScripts` in `packages/sitecheck`) parses `<script>` tags. A dynamic `import('/assets/chunk.js')` creates no DOM element, and neither do `new Worker(url)`, `importScripts`, `eval(await (await fetch(u)).text())` or WebAssembly. Vite/Rollup apps load every lazy route and wallet chunk this way, and vite builds only add `<link rel="modulepreload">` for *static* deps. An attacker who controls the CDN or origin and modifies only a lazily imported chunk (for example the wallet-connect chunk) gets **match**.
- Minimal repro: the `evasions()` function in `bench-b3.ts`. The page has `<script type=module src=/assets/index.js>`, and index.js does `import("/assets/wallet-chunk.js")`. Only the chunk is malicious, and `checkScripts` returns `match`.
- Suggested fix: in the content script, also hash every `PerformanceObserver({type:'resource'})` entry with `initiatorType` in {`script`, `link`, `other`} whose URL ends in `.js`/`.mjs` or that came from `import()`. Also hash `link[rel=modulepreload]` hrefs. In the static path, follow `import("…")` string literals in fetched modules. The most robust fix is a published *manifest of every JS asset URL+hash* (not just the HTML-referenced ones), with the check failing closed on any resource-timing JS URL that is not in the manifest.

**G2: The re-fetch can be cloaked (E1).** Both paths hash bytes they fetch *again*. The watcher uses plain `fetch` (Node UA). The extension uses `fetch(url, {cache:'force-cache'})`, which sends `Sec-Fetch-Dest: empty` / `Sec-Fetch-Mode: cors` where the real load sends `Sec-Fetch-Dest: script`. A malicious server can return the legit bundle to anything that does not look like a browser script load. Drainer kits commonly cloak by UA, IP and referrer.
- Minimal repro: the `/cloak/` route in `bench-b3.ts`. It serves the drainer only to `Mozilla/*` UAs, and the watcher reports `match`. For the extension, the equivalent server rule is `Sec-Fetch-Dest: script` → malicious, else → legit, with `Cache-Control: no-store` so `force-cache` cannot reuse the executed response. **Not executed in a browser here.**
- Suggested fix: the watcher should send a browser UA and `Sec-Fetch-Dest: script`, and fetch from several vantage points. The extension should not re-fetch at all. Instead it should hash what actually executed: compare the hash with the published set via Subresource Integrity (inject or require an `integrity=` attribute that the browser enforces on the real load), or read the bytes via `chrome.debugger`/`webRequest` response bodies (MV3 cannot, so SRI is the practical route). Treat a script served `no-store` on a fingerprinted origin as `unverifiable`.

**G3: Wayback-style "unverifiable" on the static path.** When a script cannot be fetched, the static path says `unverifiable`, never `mismatch`. That is correct fail-amber behavior, but an attacker who makes the new script 404 for the watcher only (see G2) downgrades a block to amber.

## Honest limits

- Real payloads: Connect Kit 1.1.5/1.1.6/1.1.7 (bytes from cdn.jsdelivr.net; the stage-2 file now returns 403, so its hash is unknown and it counts as unreadable). Real hijacked capture: Balancer 2023-09-20 (the interstitial page, not the drainer behind "Ignore & proceed").
- Reconstructed: the Curve injection (no archived copy exists; every Wayback capture in the window is byte-identical to the legit build) and the Ledger drainer requests. The Squarespace/Compound and Celer hijacks have no archived malicious page, so they are not in the table.
- The dapp bundle in the Ledger rows is a placeholder. Only the Connect Kit item varies, which is how the incident worked.
- The verdicts are what `checkScripts` returns. The extension then blocks the tab on `mismatch` (core.ts `evaluateScripts`) unless the record is stale or unreadable. This benchmark does not exercise that browser flow.
