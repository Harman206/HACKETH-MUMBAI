# Feedback: Uniswap Foundation

What we built: **independent exit tooling for Uniswap v3 LPs** that keeps working when the app, DNS or an RPC fails. Uniswap's contracts are the hero: they outlive every frontend.

## How we used Uniswap

- `NonfungiblePositionManager` discovery: `balanceOf` → `tokenOfOwnerByIndex` → `positions(id)` ([adapter](packages/adapters/src/uniswap-v3.ts#L34-L59)).
- One-transaction exit: `multicall[decreaseLiquidity, collect(recipient = user)]`. Minimums come from an `eth_call` simulation minus 0.5 % ([adapter](packages/adapters/src/uniswap-v3.ts#L62-L98)).
- Live on Sepolia (`0x1238…cDA52`) and replayed on mainnet forks at the 9 Aug 2022 Curve-hijack block. A real LP (#287037, USDC/USDT 0.01 %) exits through the kit's code at that block ([report](docs/replay/R1.md)).

## What worked well

- The NPM is an excellent "exit surface". Exits need **no approvals at all** when the wallet owns the NFT, so a safety tool can ban approvals outright.
- `multicall` makes decrease + collect atomic, so the user signs once.
- `eth_call` simulation of the multicall returns exact `(amount0, amount1)` for both steps, which is enough to set honest minimums without a quoter.

## Friction we hit (and how we handled it)

1. **`decreaseLiquidity(0)` reverts.** A position with liquidity 0 that is still owed tokens needs a `collect`-only path. Tooling that always builds `decrease + collect` fails on exactly the dust positions users forget about. A note in the NPM docs would help.
2. **`tokensOwed` excludes uncollected fees** until the position is poked, and you cannot poke with `decreaseLiquidity(0)`. We rely on simulating `collect` for the true amounts.
3. **Unwrapping WETH conflicts with recipient pinning.** Getting native ETH means `collect(recipient = address(0))` followed by `unwrapWETH9` and `sweepToken`. A security policy that pins every recipient to the user must special-case `address(0)`, so we pay out WETH and say so.
4. **v4 positions are not enumerable the same way.** Without `tokenOfOwnerByIndex`, discovery needs a log scan or an indexer. Most exit tooling would benefit from an enumerable view, or a documented minimal log-scan recipe that works over plain RPC.
5. **Sepolia addresses.** We had to confirm the Sepolia NPM (`0x1238…cDA52`) and factory (`0x0227…DaC1c`) on chain via `NPM.factory()`. A single canonical testnet address table, linked from the v3 docs, would save time.

## Where to look

- Adapter: `packages/adapters/src/uniswap-v3.ts`
- Fork tests (in-range, out-of-range and owed-only positions): `packages/adapters/test/uniswap-v3.fork.test.ts`
- End-to-end exit in a real browser: `apps/kit/e2e/exit.spec.ts`
