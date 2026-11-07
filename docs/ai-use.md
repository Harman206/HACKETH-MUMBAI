# AI use and team contributions

Copeybara was built at ETHGlobal Mumbai (5–7 November 2026) by a team of five (names on the ETHGlobal submission). We used a spec-driven, AI-assisted workflow, which the event rules permit. This page says plainly what AI did, what the team did, and where every artifact is.

**In one paragraph.** Most of the code was written by AI coding assistants: Claude Code on one laptop (Harman's) and an AI coding tool on the second (Divyam's). The commits come from those two laptops; 201 of the 228 commits carry a `Co-Authored-By: Claude` line. The team came up with the product, set its scope and direction at every step, made the product and design decisions, reviewed what was built, tested it with real wallets on Sepolia and reported the bugs, held every key, deployed everything on chain and on the web, and made the demo and the video. Nothing in this repo was written before kickoff (timeline in the [README](../README.md#built-at-ethglobal-mumbai-whats-new-and-whats-reused)).

## Where AI was used

| Area | How |
|---|---|
| Product spec | The PRD ([`docs/spec/BLACKOUT-technical-PRD.txt`](spec/BLACKOUT-technical-PRD.txt)) was drafted by Claude (Claude Docs) from the team's idea, after kickoff (6 Nov 03:24 IST). It is kept as written. |
| Planning | Claude Code turned the PRD into phased, test-first plans and design specs ([`docs/superpowers/`](superpowers/plans/2026-11-06-blackout.md)). Decisions made against the PRD are listed at the top of the first plan. |
| Code, Harman's laptop | Claude Code wrote the kit, guard, quorum, ENS reader, adapters, contracts scripts, replays, extension, watcher, harness and most of the site, in test-first commits. |
| Code, Divyam's laptop | An AI coding tool, directed by Divyam: the landing-page redesigns, the protocol SDK and `copeybara` CLI, build plugins, widget, certify directory and integration guide (22 commits, merged by Harman). |
| Research | AI with web access read partner-track rules, ENSv2 and Uniswap docs, incident reports and the phishing-research literature. On-chain facts (ENSv2 addresses, incident transactions, LP positions) were checked against chain state with `cast` and `eth_getLogs`, not taken from model memory ([`docs/ens-notes.md`](ens-notes.md)). |
| In the product | The watcher can ask Claude for the one-line warning text on the warning page, from structured facts only. Without a key it uses fixed text. |
| Not AI | The demo video: our own voices, no AI voiceover. Keys, wallets, accounts, funding and deployments. |

## What the team did

Each item can be checked against the prompt logs ([`docs/ai/prompts/`](ai/prompts/README.md)) and `git log`.

- **The idea and the direction.** The product (an exit that keeps working when a protocol's website is down or hijacked), the scope of each phase, and when to stop polishing and move on.
- **Product decisions.** Some of them, in order:
  - an attack replication as the demo
  - make it a usable product with a real UI and hosting, not a test suite
  - how Copeybara differs from existing emergency-exit tools (Brava's emergency access, Uniswap's IPFS interface)
  - a browser extension to make it proactive, not only reactive
  - the three protections (site down, DNS hijack, drainer request) and their flowcharts
  - the rename from BLACKOUT to Copeybara
  - the ENS record keys in scope
  - a security audit of the extension's data and stats
  - the side panel, the demo portal, the watcher agent and its notes
  - the "Saved by Copey" moment
- **Design.**
  - The Copeybara brand: the capybara mark and UI assets, made by the team during the event.
  - The landing-page designs and palettes (Divyam).
  - A screen-by-screen UI review of 19 screens, with each marked approved or changed and why (7 Nov 01:22).
- **Review and critique.** The team brought in a competitive review of BLACKOUT against other projects in the same tracks and turned its weak points into work (6 Nov 21:55): a judge-visible demo, usability, the public repo, README contradictions, and CI.
- **Testing and debugging with real wallets.**
  - Created and funded the Sepolia test wallets.
  - Ran exits through MetaMask on the live site.
  - Reported failures with screenshots and error text. Examples: an exit stuck at a stage, the `wallet_requestPermissions already pending` error, and the extension warning only appearing after MetaMask connects, so its Cancel button did nothing. Then retested the fixes.
  - Checked with MetaMask and Rabby by hand. The automated e2e uses an injected test wallet.
- **Keys and deployment.**
  - The ENS name.
  - The Safe owner, deployer, attacker and watcher keys.
  - The Sepolia deployment and the Safe transactions.
  - Vercel hosting and the GitHub repo.
  - Merging the two laptops' branches.
- **The demo and the submission.** The live demo run, the video and the write-up.

## Artifacts

| What | Where |
|---|---|
| Spec (PRD) | [`docs/spec/BLACKOUT-technical-PRD.txt`](spec/BLACKOUT-technical-PRD.txt) |
| Plans and design specs | [`docs/superpowers/plans/`](superpowers/plans/2026-11-06-blackout.md), [`docs/superpowers/specs/`](superpowers/specs/2026-11-06-copeybara-extension-design.md) |
| Standing instructions for the coding assistant | [`CLAUDE.md`](../CLAUDE.md) |
| Prompts (Claude Code, verbatim) | [`docs/ai/prompts/`](ai/prompts/README.md) |
| Every change | `git log` (small commits; AI-written commits carry a `Co-Authored-By` line) |

Not in the repo yet: the claude.ai conversation that drafted the PRD, and the prompts from the second laptop.
