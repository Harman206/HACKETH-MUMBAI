# Feedback: Uniswap Foundation

What we built: **independent exit tooling for Uniswap v3 and v4 LPs** that keeps working when the app, DNS or an RPC fails. Uniswap's contracts are the hero: they outlive every frontend.

## How we used Uniswap

- `NonfungiblePositionManager` discovery: `balanceOf` → `tokenOfOwnerByIndex` → `positions(id)` ([adapter](packages/adapters/src/uniswap-v3.ts#L34-L59)).
- One-transaction exit: `multicall[decreaseLiquidity, collect(recipient = user)]`. Minimums come from an `eth_call` simulation minus 0.5 % ([adapter](packages/adapters/src/uniswap-v3.ts#L62-L102)).
- Live on Sepolia (`0x1238…cDA52`) and replayed on mainnet forks at the 9 Aug 2022 Curve-hijack block. A real LP (#287037, USDC/USDT 0.01 %) exits through the kit's code at that block ([report](docs/replay/R1.md)).

## What worked well

- The NPM is an excellent "exit surface". Exits need **no approvals at all** when the wallet owns the NFT, so a safety tool can ban approvals outright.
- `multicall` makes decrease + collect atomic, so the user signs once.
- `eth_call` simulation of the multicall returns exact `(amount0, amount1)` for both steps, which is enough to set honest minimums without a quoter.

## Friction we hit (and how we handled it)

1. **`decreaseLiquidity(0)` reverts.** A position with liquidity 0 that is still owed tokens needs a `collect`-only path. Tooling that always builds `decrease + collect` fails on exactly the dust positions users forget about. A note in the NPM docs would help.
2. **`tokensOwed` excludes uncollected fees** until the position is poked, and you cannot poke with `decreaseLiquidity(0)`. We rely on simulating `collect` for the true amounts.
3. **Unwrapping WETH conflicts with recipient pinning.** Getting native ETH means `collect(recipient = address(0))` followed by `unwrapWETH9` and `sweepToken`. A security policy that pins every recipient to the user must special-case `address(0)`, so we pay out WETH and say so.
4. **Sepolia addresses.** We had to confirm the Sepolia NPM (`0x1238…cDA52`) and factory (`0x0227…DaC1c`) on chain via `NPM.factory()`. A single canonical testnet address table, linked from the v3 docs, would save time.

## Uniswap v4: what we built and what we hit

We added v4 exits: discovery, `modifyLiquidities([DECREASE_LIQUIDITY, TAKE_PAIR])`, and an Exit Guard that decodes the action list ([adapter](packages/adapters/src/uniswap-v4.ts), [guard](packages/guard/src/decode.ts#L76-L111), [fork test against the real Sepolia contracts](packages/exec/test/uniswap-v4.fork.test.ts)).

What worked well:
- The action list is a clean, decodable "intent". A security check can allowlist exactly `DECREASE_LIQUIDITY` / `BURN_POSITION` / `TAKE_PAIR` and refuse the rest with a reason a user understands.
- v4 pays fees out on every liquidity change, so an empty position owes nothing. v3's "liquidity 0 but still owed" edge case is gone.
- `StateView` makes the reads needed for honest minimums (slot0, fee growth inside, position info) cheap and stable.

Friction:
1. **Positions are not enumerable, and plain-RPC log scans don't reach far.** The PositionManager has `balanceOf` but no `tokenOfOwnerByIndex`. Measured on public Sepolia RPCs: publicnode caps `eth_getLogs` at 50k blocks and has pruned logs older than ~18k blocks; ethPandaOps allows 10k-block ranges. A wallet-side tool with no indexer can only search recent history. We combine `balanceOf` (the true count), a recent `Transfer` scan, and "add by ID" with an `ownerOf` check. An enumerable lens contract (owner → token ids) in v4-periphery would make every self-custody exit tool simpler.
2. **`modifyLiquidities` returns nothing, so `eth_call` can't tell you the amounts.** In v3, simulating `multicall[decreaseLiquidity, collect]` returns exact amounts. In v4 we had to port `TickMath` and `SqrtPriceMath` to TypeScript and read `StateView` to compute minimums (they match on-chain results to the wei). A view such as `quoteDecrease(tokenId, liquidity)`, or returning the deltas, would remove that whole class of bugs.
3. **Recipient magic values.** `_mapRecipient` treats `address(1)` as msg.sender and `address(2)` as the PositionManager. A policy that pins every payout to the user's address must know about them. We refuse both and always encode the user's address explicitly.
4. **Permit2 allowances outlive the mint.** An LP who minted through the app has a live Permit2 allowance to the PositionManager. A hijacked frontend can send a `modifyLiquidities` that looks like "manage position" but contains `SETTLE_PAIR` or `INCREASE_LIQUIDITY` and pulls tokens from the wallet. Wallet-level decoding of v4 action lists, and docs that call this out, would protect users. Our Guard bans those actions in an exit.

## Where to look

- Adapters: `packages/adapters/src/uniswap-v3.ts`, `packages/adapters/src/uniswap-v4.ts`, `packages/adapters/src/v4-math.ts`
- Fork tests: v3 in-range, out-of-range and owed-only positions in `packages/adapters/test/uniswap-v3.fork.test.ts`; v4 on Sepolia in `packages/exec/test/uniswap-v4.fork.test.ts`
- End-to-end exit in a real browser: `apps/kit/e2e/exit.spec.ts`
