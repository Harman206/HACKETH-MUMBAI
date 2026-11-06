# CROPS

## C: censorship resistance (the lead property)

- **No server on the exit path.** The kit is a static file served from `http://localhost`. Switching off the protocol's website, DNS, company or primary RPC cannot block an exit. The Fire Drill does this live: `apps/kit/e2e/drill.spec.ts` presses the three switches on the judge's control page and then exits three positions.
- **Read quorum.** By default the kit reads from the user's endpoints plus two or three public providers. It refuses to continue if fewer than two answer, or if any two disagree on the chain ID, an ENS record, ownership, positions or balances. All of these are read at one pinned block.
- **Trusted dependency, disclosed.** Broadcast goes through the wallet's own RPC (`eth_sendTransaction`). If the wallet's RPC censors you, switch your wallet's RPC.

## O: open source

- MIT. Everything builds from this repo with pinned Node 22, pnpm 9 and a lockfile.
- Reproducible kit: `apps/kit/scripts/check-repro.mjs` builds twice with `SOURCE_DATE_EPOCH=0` and compares sha256. `apps/kit/test/build.test.ts` runs it.

## P: privacy

- No BLACKOUT server, no analytics, no telemetry, in either the kit or the hosted page.
- What each third party learns: the RPC providers you use see `eth_call` reads for your address and the contracts you hold positions in. The wallet's RPC sees the transaction you send. Nobody else is contacted (Playwright: 0 third-party origins).
- Anon-RPC (Nox): **not shipped.** It's a P3 item with a 2-hour cap and a 07:00 go/no-go, so the EF entry leads with CROPS. If it is added, it becomes a quorum path through the `fetchFn` hook in `packages/quorum`.

## S: security

- Keys never leave the wallet. The kit calls exactly two wallet methods: `eth_estimateGas` (to add 25 % gas headroom) and `eth_sendTransaction`. It has no code path for typed-data signing (e2e asserts zero `*sign*` calls).
- The Exit Guard (`packages/guard`) rejects anything that is not a published exit paying the connected account. It is tested with a 26-case banned corpus (including a real Curve 2022 victim's approve calldata) and 10,000-run property tests.
- Release integrity: the kit's sha256 lives in `org.blackout.release`, written by a 2-of-3 Safe. Verify it outside the kit with `scripts/verify-kit.sh`; the kit cannot verify itself.
- Role separation (ENSv2 Enhanced Access Control): the website key holds only `ROLE_SET_TEXT` on the `url` key. Fork tests and live transactions show it cannot write the release or manifest, swap the resolver, upgrade the resolver, or grant itself roles.
