# Copeybara: browser extension, watcher agent, `org.copeybara.*` records — design

Status: approved in conversation 2026-11-06 (flowcharts, architecture, security model, rename scope). ENS name stays `demoswap-blackout.eth`.

## Goal

Turn the exit kit into a product that is proactive as well as reactive, installed as an unpacked browser extension:

1. **Site down** → the extension offers "Exit safely", which opens the ENS-verified kit and exits from the contracts directly.
2. **DNS hijack** → the extension fingerprints every script the page runs against the Safe-published `org.copeybara.site` record; a mismatch replaces the tab with a warning page; dangerous wallet requests are intercepted before the wallet popup.
3. **2-of-3 trust** → only the Safe writes `release`, `manifest`, `site`, `extension`; the website key writes only `url`; a new **watcher** key writes only `status` and `blocklist`. Every exit tx still passes the fail-closed Exit Guard.

## Rename

Brand is **Copeybara** everywhere user-facing; package scope `@copeybara/*`; kit file `copeybara-kit.html`. ENS keys move to `org.copeybara.*`; `org.blackout.*` records stay on chain frozen so already-saved kits keep working. Historical docs (old plans/specs/PRD) are not rewritten.

## ENS records (on the protocol's name)

| key | writer | format |
|---|---|---|
| `url` | website key | official site origin, e.g. `http://demoswap.localhost:8080` |
| `org.copeybara.release` | Safe | `sha256:<hex>;v=<n>` (kit) |
| `org.copeybara.manifest` | Safe | full manifest JSON (existing codec) |
| `org.copeybara.site` | Safe | `v=2;sha256=<h1>,<h2>,…` set of allowed script hashes (legacy `sha256:<hex>` = one-hash set) |
| `org.copeybara.extension` | Safe | `sha256:<hex>;v=<n>` (extension zip) |
| `org.copeybara.status` | Safe or watcher | `v=1;state=ok\|degraded\|compromised;at=<unix>;note=<urlencoded ≤200 chars>` (empty = ok) |
| `org.copeybara.blocklist` | Safe or watcher | `{"v":1,"domains":["host",…]}` (host matches itself and subdomains) |

The kit requires `release` + `manifest`; everything else is optional. Status and blocklist can only warn or block *websites*; they can never block an exit.

## Site fingerprint

Script hash = sha256 of `normaliseBundle(text)` (existing rule). Every script that runs in a page on the protocol's `url` origin (parser-inserted, inline, dynamically added; observed from `document_start` by a MutationObserver in the isolated world) must be in the `site` set. Any unknown hash → mismatch (listing which scripts). External bytes are re-read in the page's cache partition (`fetch(src,{cache:'force-cache'})`); a fetch failure → "can't verify" (amber), never green. Known gap stated in README: Chrome cannot prove which bytes executed.

## Extension (MV3, Chrome; Firefox build best-effort)

- **Service worker = trust core.** Only writer of storage. ENS reads via 3-RPC quorum (`@copeybara/quorum`, `@copeybara/ens`), caches per protocol (≤60 s, alarm every 1 min). Computes all verdicts. Validates every message's sender via Chrome's `sender` (id, tab, origin); never trusts verdicts/data claimed by a page. Rate-limits per tab.
- **Content script (isolated):** script observer + hashing; relays wallet requests; renders a convenience banner in a closed shadow root. No storage access (`storage.local.setAccessLevel` trusted contexts only).
- **MAIN-world shim:** wraps `window.ethereum` and EIP-6963 providers' `request`/`send`/`sendAsync` for `eth_sendTransaction`, `eth_signTypedData(_v3/_v4)`, `personal_sign`, `eth_sign`, `wallet_sendCalls`. Waits for the worker's decision; blocked → rejects with EIP-1193 code 4001. Best effort (a hostile page can bypass in-page code; stated honestly).
- **Authoritative blocks:** `declarativeNetRequest` dynamic rules redirect main-frame navigations to the warning page for (a) followed protocols with `status=compromised`, (b) blocklisted domains. A fingerprint mismatch after load replaces the tab with the warning page (`tabs.update`).
- **Trusted UI:** toolbar badge + side panel (the toolbar icon opens it; Firefox: sidebar), setup wizard tab, dashboard tab, warning page, confirm window (`windows.create` popup). Pages never draw verdicts.
- **Verdicts for wallet requests:** `exit` (passes Exit Guard for a followed protocol) · `known` (target/spender in a followed manifest) · `risky` (unknown contract call, value to unknown contract, unlimited approval to manifest address) · `dangerous` (approve/increaseAllowance/setApprovalForAll/permit/Permit2/transfer to non-manifest, `eth_sign`, 32-byte-hash `personal_sign`). On a red site every request is blocked. `risky` and `dangerous` open the confirm window (dangerous defaults to Cancel; "Continue anyway" needs a typed confirmation); `exit`/`known` pass.
- **Setup wizard:** 1 Wallet (connect through the hosted/served kit which hands the address to the extension after the user clicks, or paste) → 2 Protocols (ENS name → records read → contracts + fingerprints shown, "Follow") → 3 Services (each RPC tested live; add own) → 4 Done → dashboard.
- **Dashboard:** per protocol: site status, release, last sync, contracts; positions auto-detected via `@copeybara/adapters` with amounts; "Exit safely" opens the kit with `#name=`; local stats; export JSON.
- **Stats (local only, worker-incremented):** sitesChecked, verified, mismatched, unverifiable, pagesBlocked (by reason), requestsChecked by verdict, requestsBlocked, pageNoise (rate-limited/malformed page messages), lastSync.
- **Build:** reproducible zip (`SOURCE_DATE_EPOCH=0`, sorted entries, fixed mtimes) + `.sha256`; published as `org.copeybara.extension`. No remote code; strict extension CSP.

## Watcher agent (`apps/watcher`, Node)

Every N s per watched name: read records (quorum) → fetch `url` HTML + scripts → verdict via shared site-check. 2 consecutive mismatches → write `status=compromised` with a note; 5 consecutive matches after compromise → `status=ok`. Candidate lookalike domains (config list) that resolve and serve content are added to `blocklist`. Writes use the watcher key directly on the resolver (role-scoped). Optional LLM (Anthropic API, only if `ANTHROPIC_API_KEY`) writes the note from structured facts only; deterministic note otherwise. Exposes `/status` JSON for the harness/theater. A stolen watcher key can only flip warnings; the extension still fingerprints independently.

## Contracts

`grantWatcherRoles(safe, resolver, label, watcher)` grants setter roles on `org.copeybara.status` and `org.copeybara.blocklist` only. Fork tests: watcher can write status/blocklist; cannot write release/manifest/site/extension/url, cannot grant itself roles. `permission-checks.sh` adds the watcher's must-reverts live. Migration: the Safe writes the six `org.copeybara.*` keys once and grants the watcher role.

## Testing

Unit: codecs, site-check, classifier corpus (+ property tests), worker modules with a fake `chrome`. Contracts: fork tests. E2E (Playwright, real unpacked extension, anvil Sepolia fork world): setup wizard → follow → verified badge; DNS hijack → warning page; watcher flips status → next visit redirected before load; blocklisted lookalike → blocked; dangerous approve → confirm window → cancelled; exit from dashboard via kit → recovered; hostile-page suite (forged messages, pre-captured provider, banner removal, flood, storage probe, iframe, cloaked script); exact stats asserted.
