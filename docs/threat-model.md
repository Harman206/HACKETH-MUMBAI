# Threat model

Copeybara is built for one kind of failure: everything between you and the contracts breaking, or turning against you. This is what it is designed to survive, what it deliberately trusts, and where it stops.

## Built to survive

- The protocol's website, DNS, hosting and third-party scripts going down or being hijacked. None of them is on the exit path.
- The primary RPC dying, and any single RPC lying. Reads need two of three providers to agree.
- A stolen website key (it can write `url` and nothing else) and a stolen watcher key (it can raise or clear a warning; nothing it writes can block an exit).
- A tampered kit, wherever it's hosted: the sha256 check against ENS runs outside the kit.
- Copeybara itself disappearing. There is no server, and the last ENS release stays valid if the Safe never publishes again.

## Trusted, on purpose

- Your wallet and the RPC it broadcasts through (switch it if it censors you).
- Ethereum and the ENS contracts.
- The protocol's release Safe signers. In this testnet demo all three Safe keys sit on one machine (`contracts/.env`), so the 2-of-3 rule is demonstrated, not independent; a real protocol uses independent signers.
- `sha256sum`, or whatever you check the file with.

## Outside the threat model

- Bugs in the protocol's own contracts, oracle attacks, and paused or insolvent contracts. The replay control C1 shows a contract exploit going through untouched.
- A stolen key for your own wallet.

## Open edges, measured

- **Coverage.** Uniswap v3 and v4 positions held directly, Aave v3 supply, Curve 3pool LP, and any vault the protocol describes in `org.copeybara.exits` (fork-tested with a sample ERC-4626 vault; none published on Sepolia yet). Staked positions, Aave positions with debt (repaying needs an approval) and v4 pools that pay native ETH are shown as "manual", and nothing is sent.
- **Uniswap v4 discovery** searches the last ~50k blocks through public RPCs; older positions are added by ID after an ownership check. A v4 hook that takes a cut on withdrawal pushes the payout under the minimum, so the simulation fails and nothing is sent.
- **Preparation.** You need the kit (saved, or any copy that matches ENS) and the protocol's ENS name from a source other than the kit. The hosted site's offline copy covers the host going down, not being hijacked.
- **Releases.** The kit warns if it sees an older release than one it saw before in this browser, but monotonic versions aren't enforced on chain. Serving an old record would take the Safe or a majority of the kit's RPCs lying together; one provider reporting an old block is dropped.
- **The extension's in-page checks are best effort.** A hostile page can talk to the wallet before the shim wraps it, and a script served `no-store` can show the extension different bytes (benchmark B3). Code built from strings (`eval`), `blob:` workers and WebAssembly are not hashed. The checks you can rely on are the ones that run before a page loads, and replacing the tab on a mismatch. The extension is a Sepolia testnet preview, installed unpacked.
- **ENSv2 resolver roles are per resolver, not per name,** so we deploy one resolver per protocol name.
- **Reproducible builds** are verified on one toolchain; cross-machine reproduction is not yet verified.
- **Evidence labels.** Replays are labelled mainnet fork, impersonated account and counterfactual; none is a live mainnet rescue. The automated e2e uses an injected EIP-6963 test wallet; checks with MetaMask and Rabby on Sepolia were done by hand.
