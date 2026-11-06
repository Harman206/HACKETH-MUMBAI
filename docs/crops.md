# CROPS

## C: censorship resistance (the lead property)

- **No server on the exit path.** The kit is a static file served from `http://localhost`. Switching off the protocol's website, DNS, company or primary RPC cannot block an exit. The Fire Drill does this live: `apps/kit/e2e/drill.spec.ts` presses the three switches on the judge's control page and then exits three positions.
- **Read quorum.** By default the kit reads from the user's endpoints plus two or three public providers. It refuses to continue if fewer than two answer, or if any two disagree on the chain ID, an ENS record, ownership, positions or balances. All of these are read at one pinned block.
- **Trusted dependency, disclosed.** Broadcast goes through the wallet's own RPC (`eth_sendTransaction`). If the wallet's RPC censors you, switch your wallet's RPC.

## O: open source

- MIT. Everything builds from this repo with pinned Node 22, pnpm 9 and a lockfile.
- Reproducible kit: `apps/kit/scripts/check-repro.mjs` builds twice (production mode, `SOURCE_DATE_EPOCH=0`) and compares sha256; `apps/kit/test/build.test.ts` runs it and asserts no local paths are baked in. Cross-machine reproduction is not yet verified.

## P: privacy

- No Copeybara server, no analytics, no telemetry, in either the kit or the hosted page.
- What each third party learns: the RPC providers you use see `eth_call` reads for your address and the contracts you hold positions in. The wallet's RPC sees the transaction you send. Nobody else is contacted (Playwright: 0 third-party origins).
- **Anon-RPC: evaluated, not shipped in the kit.** We checked the docs at https://ethereum.github.io/anon-rpc/ (spec v0.4.0, Draft) on 2026-11-06:
  - It is not an RPC URL. It is a browser library (`@anon-rpc/browser-harness`) that runs a network "worker" in a null-origin sandbox iframe. The worker is chosen by an on-chain specifier contract that pins its code hash. Its transports are Tor (WebAssembly, through gateways), the Nym mixnet (an ~18 MB bundle) and WebRTC.
  - For Sepolia it lists one network, Nox (a demo Sphinx mixnet; specifier `0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A`).
  - Bundling it would break three kit invariants that carry the trust model: one self-contained file whose sha256 is published on ENS, no code loaded at runtime from anywhere else, and under 1 MB. The worker would also see every read, so choosing a network is itself a trust decision.
  - **What a privacy-minded user can do today:** put their own endpoint in the kit's "Your own RPC endpoints" box (for example a local node, or a local proxy that forwards over Tor) and untick the public providers. The quorum then reads only from the endpoints they chose. It still needs two of them to answer and agree, so give it at least two (for example two Tor-routed proxies to different providers).
  - **How it could be added safely later:** as an opt-in quorum path through the existing `fetchFn` hook in `packages/quorum`, inside a separate "private reads" build of the kit with its own published sha256, so the default kit stays self-contained.

## S: security

- Keys never leave the wallet. The only transaction methods the kit calls are `eth_estimateGas` (to add 25 % gas headroom) and `eth_sendTransaction`; connecting uses `eth_requestAccounts`, `eth_chainId`, `wallet_switchEthereumChain`, and `wallet_addEthereumChain` only when the wallet does not know the network. It has no code path for typed-data signing (e2e asserts zero `*sign*` calls).
- The Exit Guard (`packages/guard`) rejects anything that is not a published exit paying the connected account. It is tested with a 26-case banned corpus (including a real Curve 2022 victim's approve calldata) and 10,000-run property tests.
- Release integrity: the kit's sha256 lives in `org.blackout.release`, written by a 2-of-3 Safe (testnet demo: the three owner keys are on one machine; a real protocol uses independent signers). Verify it outside the kit with `scripts/verify-kit.sh`; the kit cannot verify itself.
- Role separation (ENSv2 Enhanced Access Control): the website key holds only `ROLE_SET_TEXT` on the `url` key. Fork tests and live transactions show it cannot write the release or manifest, swap the resolver, upgrade the resolver, or grant itself roles.
