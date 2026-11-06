# BLACKOUT product finish: website, live attack theater, kit redesign, hardening

Status: approved in conversation (2026-11-06), pending written-spec review.
Builds on: `docs/spec/BLACKOUT-technical-PRD.txt` and the shipped code on `main` (ENSv2 live on Sepolia as `demoswap-blackout.eth`).

## 1. Intent

**What the user asked for**
- Ship BLACKOUT as a product, not a hackathon prototype.
- One website explains clearly how it works and has a live demo built in.
- The demo is a **real attack replication**: a hijacked site, a real approval, a real drain, then the BLACKOUT rescue.
- We need to be very sure of the build before demoing it to people.

**Who it is for**
- Hackathon judges and booth visitors with no prior context.
- Protocol teams who might adopt it.
- Users who need to exit.

**Success means**
1. A first-time visitor can explain BLACKOUT in one sentence after two minutes on the site.
2. At the booth, one person runs the four-chapter story live on Sepolia, with no terminal, in under five minutes.
3. Every on-screen claim links to a real transaction, or carries a label saying it is a replay.
4. The full story passes an automated end-to-end test on a Sepolia fork, and a live Sepolia rehearsal, before any human demo.

**Decisions made with the user**
- Live attack on Sepolia, with a labelled local-fork fallback.
- A guided story console.
- One website with the demo embedded.

## 2. Architecture

```
apps/site (new)            Website: explainer sections + embedded Live Demo (Attack Theater)
  ├─ public mode           hosted (GitHub Pages): reads ENS live, shows the last real run (demo-runs/latest.json)
  └─ booth mode            ?booth=http://localhost:8090 → talks to the harness for the interactive story
harness (extended)         theater API, drainer bot, victim preparation, existing switches
contracts (extended)       DemoDrainer.sol + DeployAttack.s.sol (Sepolia)
apps/kit (redesigned)      same single CSP-locked file, new stepper UI, clearer states
packages/* (hardened)      review minors fixed (§7)
```

The trust-critical artefact is still **only** `blackout-kit.html`, verified by its hash. The website and the theater are presentation and demo infrastructure. They never sign anything for the user, and they load no third-party code.

## 3. The real attack (contracts + drainer bot)

**`contracts/src/DemoDrainer.sol`**
- `drain(address token, address victim)` transfers `min(balanceOf(victim), allowance(victim, this))` from the victim to `attacker` (an immutable set at deploy).
- It emits `Drained(token, victim, amount)`.
- Anyone may call it. That mirrors real drainers, and the demo has no reason to restrict it.
- Tests: drains up to the allowance; drains 0 without an allowance (no revert); pays only `attacker`.

**`contracts/script/DeployAttack.s.sol`**
- Deploys `DemoDrainer(attacker)` on Sepolia.
- Writes `deployments/sepolia-attack.json` containing `{drainer, attacker, tokens:[DUSD, DETH]}`, using the demo tokens from `sepolia-positions.json`.
- The attacker key is generated locally and stored in gitignored `contracts/.env` as `ATTACKER_KEY`.

**Drainer bot (`harness/services/drainer-bot.ts`)**
- Every 2 s, polls `Approval(owner, spender=drainer)` logs on the demo tokens, using a quorum of the Sepolia RPCs.
- For each new owner with an allowance > 0, it sends `drain(token, owner)` from `ATTACKER_KEY`.
- It records `{victim, token, amount, approveTx, drainTx, at}` in theater state.
- It is idempotent: each (token, owner, approve tx) is drained once.
- It never touches addresses that didn't approve the drainer.

**Hijacked DemoSwap (`harness/hijack`)**
- The existing clone now asks for `approve(drainer, max)` on **DUSD**, using the deployed drainer from `sepolia-attack.json`.
- The fake page copy mirrors the real Curve 2022 lure: "Approve to view your rewards".

## 4. Attack Theater (booth mode)

**Harness API additions (control service, localhost only)**
- `GET /theater/state`:
  - victim address;
  - victim DUSD balance and positions (read through the quorum);
  - switches;
  - drains;
  - the kit verification results;
  - the rescue results (posted by the kit in drill mode, as now).
- `POST /theater/prepare {victim}`: as the deployer, transfer 10,000 DUSD and 0.01 Sepolia ETH to the victim, and mint one in-range DUSD/DETH Uniswap v3 position to it. It is idempotent per victim, and refuses more than 3 victims per session (testnet funds).
- `POST /theater/verify`: runs `scripts/verify-kit.sh` on the real kit and on the tampered kit against the live ENS record. It returns both outputs: `MATCH` and `MISMATCH`.
- `GET /theater/hijack-request`: the exact request the fake site sends, for pre-filling the kit's Check tab.
- The existing switches (`site-down`, `rpc-down`, `hijack-on`, `reset`) and `/failures` are unchanged.

**Theater UI (section of `apps/site`)**
A progress rail of four chapters. Each chapter has:
- a one-sentence "what's happening";
- one primary action;
- a live proof panel.

| Chapter | Action | Live proof |
|---|---|---|
| 1. A normal day | "Prepare victim wallet", then paste or connect Account 2. "Open DemoSwap" opens the real site. | Victim DUSD balance and position, read live; deployer funding tx links |
| 2. The hijack | "Hijack the domain", then "Open DemoSwap" (now the fake). The visitor approves in MetaMask. | Approve tx, the bot's drain tx, the balance falling to 0. Label: **Without BLACKOUT** |
| 3. The outage | "Take the website down", "Take the RPC down" | Red status chips; DemoSwap returns 502; the primary RPC refuses |
| 4. The rescue | "Verify kits", "Open the kit" (drill mode, pre-configured), "Check the hijack request" | `MATCH` / `MISMATCH`; the Guard verdict "Do not sign" with reasons; exit tx and **Recovered**; scoreboard |

**Scoreboard:** lost without BLACKOUT, recovered with BLACKOUT, time-to-exit (first failure to last receipt), and every tx link. Below it, the real-incident card: Curve 2022, $400,227 lost vs 0 (mainnet fork replay).

**Fallback:** if Sepolia is unreachable, the harness can be started against an Anvil Sepolia fork. Every theater screen then carries a persistent **LOCAL FORK** banner (PRD plan B).

## 5. Website (public mode + structure)

`apps/site`: Vite + Preact, static build, deployable to GitHub Pages.
- CSP: `default-src 'none'`, self scripts only, `connect-src` limited to the public RPCs and the booth origin.
- No third-party fonts or analytics.

**Sections**
1. **Hero:** "If a DeFi website dies or gets hijacked, you can still get your money out." Calls to action: *See the attack live* (jumps to the demo) and *Download the kit*.
2. **The problem:** the four incidents from the PRD table. The two 2026 rows are marked "unverified" unless sourced. Includes the Curve 2022 replay card.
3. **How it works:** four cards (your own remote control; the fingerprint on ENS; the never-pay-anyone-else checklist; three servers must agree), each with a small inline SVG diagram that animates on scroll (CSS only, reduced-motion respected).
4. **Live demo:**
   - Booth mode, when `?booth=` is set and reachable: the theater (§4).
   - Public mode otherwise:
     - live read of `demoswap-blackout.eth` (release version, fingerprint, exit contracts) through the quorum;
     - the six live permission-check txs from `sepolia-permissions.json`;
     - the last real theater run from `demo-runs/latest.json` (committed after each successful booth run): drain tx, rescue tx, amounts.
5. **What's trusted / honest limits:** from the README, in plain words.
6. **Download and verify:** the kit file, its sha256, the release record read live, and copy-paste verify commands. These are `sha256sum` plus a link to the verifier script and an ENS-app path. No repo checkout is needed to compare the hash.
7. **For protocols:** how to publish `org.blackout.release` and `.manifest` with a Safe, the role split, and the runbook.

Accessibility: semantic headings, keyboard-operable controls, WCAG AA contrast in light and dark themes, works at 360 px width.

## 6. Kit redesign (apps/kit, same trust model)

- **Stepper:** 1 Verify, 2 Connect, 3 Positions, 4 Exit. The current step is highlighted. Each step has a collapsible "What's happening" in plain language:
  - Verify: "3 independent providers agree on block N; the release fingerprint is …"
  - Connect: "Approve in your wallet; click its toolbar icon if no popup appeared."
- **Position cards:** protocol, pair, and current token amounts (from the existing simulation), plus status.
- **Result states** are distinct, each with its own colour, icon and copy:
  - `Recovered`;
  - `Not recovered`, with the reason and tx link;
  - `Blocked by the Exit Guard` (Guard reasons only);
  - `Could not simulate` (revert, or quorum disagreement before sending).
- **Check tab:** "your address" is required (already enforced). The verdict card is large; reasons are bulleted. It can be pre-filled from `?check=<base64 request>` (used by the theater).
- **Constraints:** still one inline-script HTML file with the hashed CSP, < 1 MB, reproducible, zero third-party requests. Every existing e2e test is updated and must still pass.

## 7. Hardening (the review's minors, all fixed with a failing test first)

1. Separate `Could not simulate` from `Blocked` in `ExitResult` and the report counts.
2. `senderFrom` passes `chainId` in `eth_sendTransaction` params, so the wallet enforces the chain.
3. `runExit` decodes the re-simulation output where the adapter supports it, and checks each received delta ≥ `min` (Aave included). If not, the result is `Not recovered: received less than the minimum`.
4. Quorum normalises revert answers: agreed reverts compare as "reverted" regardless of provider data formatting.
5. `verify-kit.sh` queries 3 RPCs and requires agreement, DNS-encodes by bytes, and lowercases the name.
6. `live-setup.sh` publishes `release v = current + 1` when the kit hash changes.
7. `live-setup.sh` commit stage is idempotent after a partial broadcast (resume, or detect the existing Safe and resolver).
8. Must-revert fork tests use `expectPartialRevert` with the specific errors, and add positive controls (the Safe succeeds at the same call).
9. The site-hash check normalises line endings and trailing whitespace before hashing, and the record write uses the same normalisation.
10. The Check tab evaluates against the pasted tx's `chainId` when present.
11. Quorum: exponential backoff on HTTP 429 retries. Once at least 2 paths have answered and agree, a path that has not answered within 1 s more is treated as "not answering" for that call (it does not delay the result). Any path that *does* answer must agree, otherwise DISAGREE. The minimum of 2 agreeing answers is unchanged.

## 8. Testing and acceptance

| Layer | Test | Pass bar |
|---|---|---|
| Contracts | `DemoDrainer` unit tests | drains ≤ allowance; 0 without an allowance; pays only the attacker |
| Unit | drainer-bot (fake logs/RPC), theater state, prepare idempotence, the 11 hardening items, kit stepper state machine | all green |
| E2E (fork) | `theater.spec.ts`: full four-chapter story on an Anvil Sepolia fork, real drainer bot, injected victim wallet, kit rescue | 3 consecutive green runs |
| E2E (site) | public mode reads ENS live (fork), zero third-party requests, keyboard navigation through every section | green |
| Existing | all current unit, fork, forge and e2e suites | still green |
| Live rehearsal | `scripts/rehearse-live.ts`: throwaway victim key and injected wallet against **real Sepolia**; runs chapters 1–4 headless and writes `demo-runs/latest.json` | succeeds end to end; tx links valid |
| Review | a fresh full-repo code review after the build; Critical/Important fixed | verdict "ready" |
| Human | the user runs the theater with MetaMask (Account 2 as victim) | four chapters complete |

**Freeze rule:** after the live rehearsal and the review pass, only bug fixes, each with a test.

## 9. Out of scope
Mainnet deployment; Uniswap v4; mobile beyond responsive layout; Docker mode changes; R2 and the shared ENS namespace (documented gaps); Anon-RPC.

## 10. Risks
- **Sepolia/RPC latency on stage.** Mitigations: the bot polls every 2 s; the UI shows "waiting for block…" honestly; the local-fork fallback with banner; a recorded backup run.
- **Testnet funds for preparing victims.** Each prepare costs about 0.012 ETH; cap 3 per session; the deployer is topped up before the demo.
- **MetaMask behaviour in a fresh profile.** Covered by the user's run-through plus the live rehearsal. The theater shows a "click the fox icon" hint at every wallet step.
