# AI-use disclosure

This project was built with an AI coding assistant (Claude Code) working from the team's technical PRD.

- Spec: [`docs/spec/BLACKOUT-technical-PRD.txt`](spec/BLACKOUT-technical-PRD.txt). This is the team's PRD as written.
- Plan: [`docs/superpowers/plans/2026-11-06-blackout.md`](superpowers/plans/2026-11-06-blackout.md), the phased, test-first implementation plan the assistant executed. Decisions made against the PRD (for example, promoting "Check a transaction" to P0, and verifying the kit outside the kit) are listed at its top.
- Workflow: each task was written test-first, the test was run to see it fail, then implemented and committed in small commits (see `git log`).
- On-chain facts (ENSv2 Sepolia addresses and live API, incident transactions, LP accounts) were checked against chain state with `cast` and `eth_getLogs`, not taken from model memory. Where the PRD and the deployed contracts differed, the deployed bytecode won (`docs/ens-notes.md`).
- Humans own: key custody (Safe owners), the live Sepolia deployment, wallet testing with MetaMask and Rabby, and the demo video.
