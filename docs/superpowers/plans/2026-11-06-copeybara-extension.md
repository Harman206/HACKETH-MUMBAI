# Copeybara Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename to Copeybara, move ENS records to `org.copeybara.*`, and ship an MV3 extension + watcher agent that detect site-down / DNS-hijack / incident states and intercept dangerous wallet requests, wired end to end on Sepolia.

**Architecture:** Pure-TS shared logic in packages (`core` codecs, `sitecheck`, `guard` classifier); extension = service worker trust core + isolated content script + MAIN shim + trusted extension pages; watcher = Node loop with a role-scoped ENS key.

**Tech Stack:** TypeScript, viem 2.21.55, Preact 10.25.4, Vite 5.4.11, vitest 2.1.9, Playwright 1.49.1, Foundry.

**Spec:** docs/superpowers/specs/2026-11-06-copeybara-extension-design.md

## Global Constraints

- Testnet only (Sepolia / anvil forks). Keys only in gitignored `contracts/.env`.
- Kit invariants unchanged: single inline script, CSP hash, reproducible bytes, zero third-party requests, fail-closed Guard.
- Extension: no remote code, no analytics, nothing leaves the browser except RPC reads to configured RPCs.
- Commit small and push to `origin main`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Old `org.blackout.*` records are never rewritten.

## Review Focus

1. A page forging extension messages (fake verdicts, fake "allow", spoofed origin) must never change a verdict or a stat other than `pageNoise`.
2. RPC disagreement / timeouts → "can't verify" (amber), never green, never a crash of the worker.
3. A followed protocol with no `site` record → `unset` (grey), not mismatch; with no `status` → ok.
4. Hostnames: `evil-demoswap.localhost` must not match `demoswap.localhost`; blocklist `x.com` matches `a.x.com` but not `ax.com`.
5. Wallet wrapper must preserve the provider's normal behavior for unwatched methods and for `exit`/`known` verdicts (same return values, same errors).

---

### Task 1: Rename to Copeybara (mechanical)
**Files:** all `package.json` (`@blackout/*` → `@copeybara/*`), imports, kit title/copy, site copy, `blackout-kit.html` → `copeybara-kit.html` (build scripts, harness, site, tests, verify script, deploy script), CLAUDE.md, README brand.
- [ ] sed the scope + filename + brand strings (not historical docs, not `org.blackout` keys yet); `pnpm install`.
- [ ] `pnpm typecheck && pnpm test` green; kit e2e smoke (`exit.spec.ts`) green. Commit.

### Task 2: `org.copeybara.*` record codecs (core) + ENS reader
**Interfaces — Produces (core):** `COPEYBARA_KEYS`, `parseStatus(s): StatusRecord {state:'ok'|'degraded'|'compromised', at?:number, note?:string}`, `formatStatus(r)`, `parseBlocklist(s): string[]`, `formatBlocklist(domains)`, `hostMatches(host, domain): boolean`, `parseSiteRecord(s): string[]` (hex hashes; accepts legacy `sha256:<hex>`), `formatSiteRecord(hashes)`. **(ens):** `readCopeybaraRecords(name, q, cfg): CopeybaraRecords {name,url,release,manifest,site:string[]|null,status,blocklist,extension:ReleaseRecord|null,block,resolver}`; `readBlackoutRecords` kept as alias returning the same shape for the kit.
- [ ] Tests: status round-trip, malformed → throws, empty → ok; blocklist rejects non-hostnames; `hostMatches` cases from Review Focus 4; site record legacy + v2 + bad hex; reader with fake quorum (existing test pattern) requires release+manifest, optional rest.
- [ ] Implement; kit + tools/manifest + scripts switch to new keys. Tests green. Commit.

### Task 3: `@copeybara/sitecheck`
**Produces:** `scriptHash(text): Promise<string>`, `checkScripts(hashes: string[], allowed: string[]|null): {verdict:'match'|'mismatch'|'unset', unknown:string[]}`, `extractScripts(html, base): {inline:string[], src:string[]}`. Node CLI `scripts/site-fingerprint.mjs <url|file…>` prints the `org.copeybara.site` value.
- [ ] Tests incl. DemoSwap site (match) vs hijack page (inline + inject.js → 2 unknown).
- [ ] Kit Check tab uses it. Commit.

### Task 4: Contracts — new keys + watcher role
- [ ] `grantWatcherRoles` in BlackoutSetup (renamed CopeybaraSetup), SetupName writes `org.copeybara.*` (+ optional legacy), WriteRecords env `STATUS`,`BLOCKLIST`,`EXTENSION_RELEASE`, `SITE`, `GRANT_WATCHER`.
- [ ] Fork tests: watcher writes status/blocklist; cannot write release/manifest/site/extension/url; cannot grant itself. `forge test` green. permission-checks.sh watcher must-reverts. Commit.

### Task 5: Wallet-request classifier (guard)
**Produces:** `classifyRequest(req:{method:string; params:unknown[]}, ctx:{account:Address; chainId:number; manifests:Manifest[]}): {verdict:'exit'|'known'|'risky'|'dangerous'|'pass'; reasons:string[]}` (`pass` = unwatched method).
- [ ] Corpus tests: approve/increaseAllowance/setApprovalForAll/transfer to stranger → dangerous; approve to manifest address unlimited → risky; Exit-Guard-valid exit → exit; Permit (2612) + Permit2 PermitSingle/Batch typed data to stranger → dangerous; `eth_sign` → dangerous; personal_sign text → known? no: `pass`-level info → verdict `known` only if origin protocol; personal_sign 32-byte hex → dangerous; wallet_sendCalls worst-of; malformed → risky with "could not decode". Property test: random calldata never `exit` unless Guard ok.
- [ ] Implement. Commit.

### Task 6: Extension scaffold, build, zip
**Files:** `apps/extension/{manifest.ts,vite.config.ts,scripts/build.mjs,src/background/*,src/content/*,src/shim/*,src/pages/*}`.
- [ ] Build test: produces `dist/chrome/manifest.json` (MV3, permissions exactly `storage, alarms, tabs, declarativeNetRequestWithHostAccess, scripting`; host perms `<all_urls>`), worker/content/shim bundles with no `eval`/remote URLs, zip + sha256 identical across two builds. Commit.

### Task 7: Worker core
**Produces:** `createCore(deps:{chrome:ChromeLike; quorumFor; now})` with `handleMessage(msg, sender)`, `sync()`, `onNavigate(tabId,url)`, `stats()`. Modules: `store.ts`, `protocols.ts` (follow/unfollow/sync cache), `site.ts` (per-tab script hashes → verdict), `rules.ts` (DNR rules), `requests.ts` (classify + confirm flow), `messages.ts` (schema + sender validation + rate limit).
- [ ] Tests with fake chrome: forged sender/origin ignored + `pageNoise`++, unknown hash → mismatch → tab replaced, missing site record → unset, quorum error → unverifiable, compromised status → DNR rule added, blocklist rule, dangerous request → confirm window → cancel → reply blocked, stats exact. Commit.

### Task 8: Content script + MAIN shim
- [ ] Shim: wraps providers (window.ethereum setter trap + EIP-6963 announce + re-request), forwards watched methods, preserves others. jsdom tests with a fake provider (Review Focus 5). Content: observer + hashing + bridge + banner. Commit.

### Task 9: Trusted UI pages
- [ ] Popup, setup wizard (4 steps), dashboard (protocols, positions, exit link, stats, export), warning page, confirm window. Kit: "Send address to Copeybara" button when `#connect=copeybara`. Unit tests for view-models. Commit.

### Task 10: Watcher agent
**Produces:** `createWatcher({names, q, fetch, writer, interval, candidates, llm?})` with `tick()`, `state()`; `apps/watcher/src/main.ts` (env: `WATCHER_KEY`, `WATCH_NAMES`, `CANDIDATE_DOMAINS`, `ANTHROPIC_API_KEY?`).
- [ ] Tests: 2 mismatches → status compromised written once; 5 matches → ok; lookalike serving → blocklist; LLM note capped 200 chars and only from facts; write failure retried next tick. Commit.

### Task 11: Harness + e2e world + extension e2e
- [ ] Shared world builder writes `org.copeybara.*` + watcher role; harness runs watcher; extension Playwright suite (journey + hostile pages + stats). Commit.

### Task 12: Live Sepolia migration + docs + release
- [ ] Safe publishes six keys + watcher role on `demoswap-blackout.eth`; live permission checks; kit + extension released; site deploy with extension download; README/CLAUDE.md/docs updated; zip to Desktop.
