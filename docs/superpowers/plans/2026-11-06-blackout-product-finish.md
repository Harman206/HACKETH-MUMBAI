# BLACKOUT Product Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn BLACKOUT into a demoable product: harden the remaining review items, add a real Sepolia attack (drainer + bot), redesign the kit so results show amounts and every state explains itself, and ship one website that explains the project and embeds the live four-chapter Attack Theater.

**Architecture:**
- **Hardening** stays inside the existing packages.
- **The attack** is a Foundry contract plus a harness service.
- **The theater** is a harness HTTP API consumed by a new `apps/site` (Vite + Preact, static). The site runs in public mode (hosted, read-only live proof) or booth mode (`?booth=` → the harness).
- **The kit** stays one CSP-locked HTML file.

**Tech Stack:** TypeScript, viem 2.21.55, Preact 10.25.4, Vite 5.4.11, vitest 2.1.9, Playwright 1.49.1, Foundry 1.9, Node 22, pnpm 9.

**Spec:** `docs/superpowers/specs/2026-11-06-blackout-product-finish-design.md`

## Global Constraints

- The kit stays one inline-script HTML file with the hashed CSP, < 1 MB, reproducible, and makes 0 third-party requests.
- The site loads no third-party code, fonts or analytics. CSP: `default-src 'none'`, self scripts only, `connect-src` = the public RPCs plus the booth origin.
- Every on-screen claim links to a real tx, or carries a label: `mainnet fork`, `impersonated account`, `counterfactual`, `LOCAL FORK`.
- The theater never signs for the user. Only the harness's local deployer and attacker keys sign (testnet, gitignored `contracts/.env`).
- `prepare` is capped at 3 victims per harness session. Each prepare gives 10,000 DUSD + 0.01 Sepolia ETH + one in-range DUSD/DETH position.
- The bot polls every 2 s and drains each (token, owner, approveTx) once.
- Accessibility: semantic headings, keyboard-operable, WCAG AA contrast in light and dark themes, works at 360 px.
- Commit after every task and push to `origin main`. Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The victim approves twice, or approves another spender.** Expect one drain per approve, and no drain for other spenders. Test in B2.
2. **The victim has no DUSD left when the approve lands.** Expect a drain of 0 to be recorded as "nothing to take", not an error loop. Test in B2.
3. **The booth origin is unreachable or wrong.** Expect the site to fall back to public mode with a visible notice. Test in D3.
4. **A theater action pressed twice, or out of order** (rescue before hijack). Expect idempotent actions and chapter gating with an explanation. Test in B4/D3.
5. **The exit lands but token metadata reads fail.** Expect the result to still show raw amounts with the token address. Test in C2.

---

## Phase A: Hardening (review minors)

### Task A1: "Could not simulate" status, and amounts in results

**Files:** Modify `packages/exec/src/run-exit.ts`, `packages/exec/src/report.ts`. Test: `packages/exec/test/run-exit.test.ts`.

**Interfaces (produces):**
- `ExitStatus = 'recovered' | 'not-recovered' | 'rejected' | 'unsimulated'`.
- `ExitResult.deltas: { token: Address; before: bigint; after: bigint; min: bigint }[]`.
- Report `guardVerdicts` counts only `rejected`. A new `unsimulated` count is added.

- [ ] Tests:
  - A simulation revert gives `status === 'unsimulated'`, and `guardVerdicts.rejected === 0`.
  - A quorum disagreement before sending gives `unsimulated`.
  - A Guard rejection stays `rejected`.
  - A recovered result has `deltas[i].after > before` and `deltas[i].min === plan.expected[i].min`.
- [ ] Implement. Update the kit labels (`COPY.unsimulated = 'Could not simulate'`) and `reportToHtml`.
- [ ] Run `pnpm vitest run packages/exec apps/kit`. Expected: PASS. Commit `fix(exec): separate 'could not simulate' from Guard blocks; results carry per-token deltas`.

### Task A2: Received-amount minimum check

**Files:** `packages/exec/src/run-exit.ts`. Test: same file.

- [ ] Test: status 1, and a delta > 0 but < `min`, gives `not-recovered` with the reason `received less than the minimum for <token>`.
- [ ] Implement in the balance check (after > before **and** after − before ≥ min). Run, commit `fix(exec): require each received delta to meet the plan's minimum`.

### Task A3: The wallet enforces the chain

**Files:** `apps/kit/src/wallet.ts`. Test: `apps/kit/test/wallet.test.ts`.

- [ ] Test: the `eth_sendTransaction` params include `chainId: '0xaa36a7'` for chain 11155111.
- [ ] Implement, run, commit `fix(kit): pass chainId in eth_sendTransaction so the wallet enforces the chain`.

### Task A4: Quorum robustness (normalised reverts, 429 backoff, slow paths)

**Files:** `packages/quorum/src/quorum.ts`. Test: `packages/quorum/test/quorum.test.ts`.

- [ ] Tests:
  - Three paths revert with different `data` formats (`0x08c379a0…`, none, `"execution reverted"`) → `CallRevertedError`, not DISAGREE.
  - One path returns HTTP 429 twice, then answers → that path's answer is counted, and the elapsed time includes ≥ 2 backoff waits (fake timers).
  - Two paths agree immediately while the third answers after 3 s → resolves in < 1.5 s, and the third path is reported as not answering for that call.
  - Two paths agree and the third answers differently within 1 s → DISAGREE.
- [ ] Implement:
  - The revert answer key is the constant `'e:revert'`; revert data is kept only for the error message.
  - 429 → retry with 250 ms × 2^attempt.
  - The gather resolves when ≥ `minAnswers` agree and the remaining paths have had 1 s past that point (per the spec §7.11).
- [ ] Run, commit `fix(quorum): normalised reverts, 429 backoff, don't wait on slow paths after agreement`.

### Task A5: verify-kit.sh reads ENS from 3 RPCs

**Files:** `scripts/verify-kit.sh`. Test: `apps/kit/test/build.test.ts` (verify case), plus a new `scripts/verify-kit.test.ts`.

- [ ] Tests (using `BLACKOUT_RELEASE_OVERRIDE_<n>` env per RPC, test-only):
  - Three matching records → `MATCH`.
  - One differing record → exit 3, `RPCS DISAGREE`.
  - A name with uppercase → normalised to lowercase before DNS encoding.
  - A non-ASCII label gets its length in bytes (`printf %s | wc -c`).
- [ ] Implement:
  - Default RPCs = the three Sepolia defaults from `config/networks.json`.
  - Optional args override them.
- [ ] Run, commit `fix(verify): read the release record from 3 RPCs and require agreement`.

### Task A6: Check tab chain, site-hash normalisation

**Files:** `apps/kit/src/check.ts`. Test: `apps/kit/test/check.test.ts`, `apps/kit/test/site-hash.test.ts`.

- [ ] Tests:
  - Pasted `{"chainId":"0x1", …}` is evaluated with chain 1 (and is blocked when the manifest has no chain-1 entry for that target).
  - `siteHashCheck` gives the same verdict for CRLF and trailing-whitespace variants of `app.js`.
- [ ] Implement `normaliseBundle(text) = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd() + '\n'`. Apply it both in the check and in `live-setup.sh`'s site-hash computation (node one-liner using the same function exported from `scripts/site-hash.mjs`).
- [ ] Run, commit `fix(kit): check uses the pasted tx's chain; site hash normalises whitespace`.

### Task A7: Runbook version bump and idempotent commit; forge controls

**Files:** `contracts/script/live-setup.sh`, `contracts/script/SetupName.s.sol`, `contracts/test/Permissions.fork.t.sol`.

- [ ] `live-setup.sh` reads the current `org.blackout.release` version through `cast` and publishes `v = current + 1` when the hash differs.
- [ ] `commit()`:
  - if `predictProxyAddress`/Safe already have code, it reuses them;
  - it skips `commit` if `commitmentAt(commitment) != 0`.
- [ ] Fork tests:
  - Replace the bare `expectRevert()` for upgrade, grantSetterRoles and grantRootRoles with `expectPartialRevert(EACUnauthorizedAccountRoles.selector)` (confirm with `-vvvv` which error each raises; use the observed selector).
  - Add positive controls: the Safe's `grantSetterRoles` for a new key succeeds; the Safe's `grantRootRoles(ROLE_SET_TEXT, x)` succeeds.
- [ ] Verify: run `forge test` on the Sepolia fork, then a rehearsal of `live-setup.sh` twice on an Anvil fork (second run: publishes nothing new, exits 0). Commit `fix(deploy): version bump, idempotent commit stage, must-revert tests with positive controls`.

---

## Phase B: The real attack

### Task B1: DemoDrainer contract and deploy script

**Files:** Create `contracts/src/DemoDrainer.sol`, `contracts/script/DeployAttack.s.sol`, `contracts/test/DemoDrainer.t.sol`.

**Interfaces:**
```solidity
contract DemoDrainer { address public immutable attacker; event Drained(address indexed token, address indexed victim, uint256 amount);
  constructor(address attacker_); function drain(address token, address victim) external returns (uint256 amount); }
```
`DeployAttack.s.sol` (env `DEPLOYER_KEY`, `ATTACKER_KEY`) writes `deployments/sepolia-attack.json`:
```json
{"drainer": "0x…", "attacker": "0x…", "tokens": {"DUSD": "0x79c2…6EcA", "DETH": "0x6271…596A"}}
```

- [ ] Tests (local, with `DemoToken`):
  - Allowance 50, balance 100 → drains 50 to the attacker.
  - No allowance → returns 0, no revert.
  - Allowance > balance → drains the balance.
  - The emitted event matches.
- [ ] Implement. Run `forge test --match-contract DemoDrainerTest`. Commit `feat(attack): DemoDrainer contract and deploy script`.

### Task B2: Drainer bot

**Files:** Create `harness/services/drainer-bot.ts`. Test: `harness/test/drainer-bot.test.ts`.

**Interfaces:**
```ts
interface DrainRecord { victim: Address; token: Address; amount: bigint; approveTx: Hex; drainTx: Hex | null; at: number; note?: string }
createDrainerBot(o: { q: Quorum; send: (to: Address, data: Hex) => Promise<Hex>; drainer: Address; tokens: Address[]; pollMs?: number; fromBlock: bigint })
  : { tick(): Promise<DrainRecord[]>; start(): void; stop(): void; records(): DrainRecord[] }
```
`tick()` reads `Approval` logs (via a new `Quorum.getLogs(filter, toBlock)`, which requires agreement), filtered to `spender == drainer` and allowance > 0, and sends `drain(token, owner)` once per (token, owner, txHash).

- [ ] Tests (fake quorum/logs):
  - One approval → one `drain` send, one record.
  - The same log on the next tick → no second send (Review Focus 1).
  - An approval to another spender → ignored.
  - Victim balance 0 → the drain is still sent and the record gets `note: 'nothing to take'` once the receipt shows amount 0, with no retry loop (Review Focus 2).
  - A `send` failure → retried on the next tick, at most 3 times.
- [ ] Add `getLogs` to the quorum (unit test: 3 paths agree → logs; one differs → DISAGREE).
- [ ] Implement, run, commit `feat(attack): drainer bot that drains approvals to the demo drainer`.

### Task B3: Hijacked DemoSwap uses the real drainer

**Files:** `harness/services/hijack-request.ts`, `harness/services/hijack.ts`, `harness/site/index.html`, `harness/hijack/inject.js`. Test: `harness/test/harness.test.ts`.

- [ ] Tests:
  - The hijack request is `approve(<drainer from sepolia-attack.json or option>, max)` on DUSD.
  - The hijacked page shows the lure text "Approve to view your rewards".
  - The real DemoSwap page shows the victim's position (via `/theater/state`) without any approve request.
- [ ] Implement:
  - `startHijack` takes `drainer` and `token`.
  - DemoSwap gets a minimal, believable UI (pool list, "Your liquidity").
- [ ] Run, commit `feat(harness): hijacked DemoSwap requests a real approval to the drainer`.

### Task B4: Theater API

**Files:** Create `harness/services/theater.ts`. Modify `harness/services/control.ts`, `harness/start.ts`. Test: `harness/test/theater.test.ts`.

**Interfaces:**
```ts
interface TheaterState { network: 'sepolia' | 'local-fork'; victim: Address | null; victimDusd: string | null; victimPositions: string[];
  switches: { site: 'up'|'down'; rpc: 'up'|'down'; hijack: boolean }; drains: DrainRecord[];
  verify: { real: string; tampered: string } | null; rescue: unknown | null; chapter: 1|2|3|4; prepareTxs: Hex[] }
GET /theater/state → TheaterState      POST /theater/prepare {victim} → {txs: Hex[]}
POST /theater/verify → {real, tampered} GET /theater/hijack-request → {to, data, value}
```
`prepare` (deployer key):
- transfer 10,000 DUSD and 0.01 ETH;
- mint one in-range position;
- cap 3 victims;
- idempotent per victim.

`chapter` derives from state:
- 1: until a drain exists;
- 2: drain recorded;
- 3: site and rpc are down;
- 4: a rescue was posted.

- [ ] Tests (fake chain adapters injected):
  - prepare twice for the same victim → one set of txs.
  - A fourth victim → 429 "demo cap reached".
  - `chapter` progression.
  - `verify` returns MATCH/MISMATCH strings from the injected runner.
  - Out-of-order calls (rescue posted before any drain) → chapter stays honest (Review Focus 4).
- [ ] Implement:
  - `start.ts` reads `contracts/deployments/sepolia-attack.json`.
  - `start.ts` starts the bot.
  - `start.ts` sets `network` from `THEATER_NETWORK`.
- [ ] Run, commit `feat(harness): theater API (state, prepare victim, verify kits, hijack request)`.

---

## Phase C: Kit redesign

### Task C1: Stepper and explanations

**Files:** Create `apps/kit/src/screens/Stepper.tsx`. Modify `app.tsx`, `copy.ts`, `styles.css`, `flow.ts`. Test: `apps/kit/test/flow.test.ts`, `apps/kit/test/stepper.test.ts`.

**Interfaces:**
- `stepOf(state: FlowState): 1|2|3|4` (Verify / Connect / Positions / Exit).
- The flow's `loading` state gets `step: 1|2|3`.
- New `FlowState` field `facts: { label: string; value: string }[]`, for example `{label:'RPC agreement', value:'3 of 3 providers at block 12073643'}`.

- [ ] Tests:
  - `stepOf` for each state.
  - After `start`, `facts` include the ENS release version, the provider agreement count, and the fingerprint.
  - The connecting state's copy contains "click its toolbar icon if no popup appeared".
- [ ] Implement the UI:
  - A stepper bar.
  - A per-step "What's happening" panel (collapsible).
  - Large status text.
- [ ] Run, commit `feat(kit): step-by-step UI with plain-language explanations`.

### Task C2: Position and result cards with amounts

**Files:** `apps/kit/src/screens/PositionCard.tsx`, `apps/kit/src/tokens.ts`, `flow.ts`. Test: `apps/kit/test/tokens.test.ts`, `flow.test.ts`.

**Interfaces:**
- `tokenMeta(q, tokens, block): Promise<Record<Address, {symbol: string; decimals: number}>>`. Fallbacks: symbol = short address, decimals = 18 on failure.
- `formatAmount(amount: bigint, decimals: number): string`. 4 significant decimals, thousands separators.
- `Position.preview?: {token: Address; amount: bigint}[]`, filled by the flow from `buildExit` simulation when the user opens a card.

- [ ] Tests:
  - `formatAmount(1234567890000000000000n, 18) === '1,234.5679'`.
  - A metadata read failure → falls back, with no throw (Review Focus 5).
  - A recovered result card shows `+<amount> <symbol>` per token, plus a tx link.
- [ ] Implement, run, commit `feat(kit): show token amounts on positions and results`.

### Task C3: Result states, Check prefill, rebuild e2e

**Files:** `app.tsx`, `screens/Check.tsx`, `apps/kit/e2e/*.spec.ts`.

- [ ] Four distinct result styles (Recovered / Not recovered / Blocked by the Exit Guard / Could not simulate). `?check=<base64url JSON>` pre-fills the pasted request.
- [ ] Update the e2e selectors.
- [ ] Run the full kit e2e (`pnpm exec playwright test`). Expected: all pass. Commit `feat(kit): distinct result states, check prefill`.

---

## Phase D: Website

### Task D1: Site scaffold and explainer sections

**Files:** Create `apps/site/{package.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx,src/sections/*.tsx,src/styles.css,src/content.ts}`. Test: `apps/site/test/content.test.ts`.

- [ ] Sections, with copy in `content.ts`:
  - Hero, Problem (incidents table; 2026 rows tagged "unverified"), How it works (4 cards + inline SVG, CSS animation honouring `prefers-reduced-motion`), Trust & limits, Download & verify, For protocols.
  - Data comes from `config/networks.json`, `docs/replay/R1.md` numbers, and `contracts/deployments/sepolia*.json` (imported at build).
- [ ] Tests:
  - Every incident has a source or the `unverified` tag.
  - Every tx hash in the content exists in `contracts/deployments/*.json` or the replay fixtures.
  - The build has no `<script src="http`, no `fonts.googleapis`.
- [ ] Build, commit `feat(site): product website with explainer sections`.

### Task D2: Public live-proof panel

**Files:** `apps/site/src/sections/LiveProof.tsx`, `apps/site/src/live.ts`. Test: `apps/site/test/live.test.ts`.

**Interfaces:** `readLiveProof(q: Quorum): Promise<{release, manifestSummary, permissions, lastRun: DemoRun | null}>`. `demo-runs/latest.json` schema:
```json
{"network": "sepolia", "victim": "0x…", "drained": "…", "drainTx": "0x…", "rescueTx": "0x…", "recovered": "…", "at": 0}
```

- [ ] Tests (stub quorum): it shows the release v and the fingerprint; it shows 6 permission rows with pass marks; a missing `latest.json` gives "No live run recorded yet".
- [ ] Implement, commit `feat(site): live on-chain proof panel (public mode)`.

### Task D3: Attack Theater (booth mode)

**Files:** `apps/site/src/theater/{Theater.tsx,chapters.ts,api.ts}`. Test: `apps/site/test/theater.test.ts`.

**Interfaces:**
- `boothUrl(): string | null`, from `?booth=` (must be `http://localhost:*` or `127.0.0.1`).
- `api.state() / prepare(victim) / switch(name) / verify() / hijackRequest()`.
- `chapters.ts` exports the four chapter definitions `{id, title, sentence, action, proof}` with the copy from the spec §4.

- [ ] Tests:
  - An invalid or unreachable booth URL → public mode plus a notice (Review Focus 3).
  - Chapter gating: "Open the kit" is disabled until chapter 3, with an explanation (Review Focus 4).
  - The scoreboard computes lost/recovered/time from the state.
  - The kit link includes the `?check=` prefill and drill settings.
- [ ] Implement the UI:
  - The progress rail.
  - The live proof cards (polling `/theater/state` every 2 s).
  - The persistent `LOCAL FORK` banner when `network === 'local-fork'`.
- [ ] Commit `feat(site): embedded four-chapter Attack Theater (booth mode)`.

---

## Phase E: End to end, live, review

### Task E1: Theater e2e on a fork

**Files:** `apps/kit/e2e/theater.spec.ts`. Modify `global-setup.ts`: deploy `DemoDrainer`, start the harness with the bot and theater, serve the site.

- [ ] The spec drives the site in booth mode, with an injected victim wallet:
  1. prepare;
  2. hijack, open DemoSwap, approve → the bot drains (balance 0);
  3. site and rpc down;
  4. verify (MATCH/MISMATCH), the check shows "Do not sign", exit → Recovered; the scoreboard shows lost > 0 and recovered > 0.
- [ ] Three consecutive green runs. Commit `test(e2e): full four-chapter attack theater on a Sepolia fork`.

### Task E2: Site e2e (public mode, a11y)

- [ ] Public mode against the fork world:
  - release v shown;
  - 0 third-party origins;
  - keyboard tab order reaches every primary action;
  - no horizontal scroll at 360 px.
- [ ] Commit `test(e2e): website public mode, keyboard and narrow viewport`.

### Task E3: Live Sepolia deploy and rehearsal

**Files:** Create `scripts/rehearse-live.ts`, `demo-runs/latest.json` (output).

- [ ] Run `DeployAttack.s.sol` on Sepolia: generate and fund `ATTACKER_KEY` with 0.01 from the deployer. Commit `deployments/sepolia-attack.json`.
- [ ] `rehearse-live.ts`:
  - starts the harness against real Sepolia;
  - uses a fresh throwaway victim key and an injected wallet (Playwright);
  - runs chapters 1–4 headless;
  - asserts the drain tx and the rescue tx succeeded on Sepolia;
  - writes `demo-runs/latest.json`.
- [ ] Verify: the script exits 0, and both tx hashes resolve with status 1 via `cast receipt`. Commit `chore(demo): live Sepolia attack + rescue rehearsal`.

### Task E4: Docs, fresh review, fixes, freeze

- [ ] Update README and the site links:
  - website;
  - theater instructions (`pnpm --filter @blackout/harness start`, open the site with `?booth=http://localhost:8090`);
  - MetaMask token import addresses.
- [ ] A fresh full-repo review (subagent, most capable model). Fix Critical/Important test-first. Re-run all suites (unit, fork, forge, e2e ×3).
- [ ] Commit `docs: website and theater instructions`; fixes as separate commits.
