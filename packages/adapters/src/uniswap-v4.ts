import { encodeAbiParameters, encodeFunctionData, pad, parseAbiParameters, toHex, type Hex } from 'viem';
import { V4_ACTIONS, v4PosmAbi, v4StateViewAbi, type Address, type ExitPlan, type Position, type TxRequest } from '@copeybara/core';
import { applySlippage, target, type Ctx, type ExitAdapter } from './types';
import { symbolOf } from './symbols';
import { amountsForDecrease, decodePositionInfo, feesOwed, hookBadges, poolIdOf, type PoolKey } from './v4-math';

export interface UniswapV4Raw {
  tokenId: bigint;
  key: PoolKey;
  poolId: Hex;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

const DEADLINE_SEC = 1200;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex;
const ZERO = '0x0000000000000000000000000000000000000000';
/** Public RPCs serve eth_getLogs in ≤10k-block ranges; scan the last 50k blocks (~1 week on Ethereum) at most. */
const CHUNK = 10_000n;
const WINDOW = 50_000n;
const NOT_FOUND_ID = 'uniswap-v4:not-found';

const posm = (ctx: Ctx) => target(ctx, 'uniswap-v4', 'positionManager')?.address;
const stateView = (ctx: Ctx) => target(ctx, 'uniswap-v4', 'stateView')?.address;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Token ids sent to `user` in the recent window, newest first. Stops (keeping results) where RPCs lack history. */
async function recentlyReceived(address: Address, user: Address, ctx: Ctx): Promise<bigint[]> {
  const ids: bigint[] = [];
  const floor = ctx.block > WINDOW ? ctx.block - WINDOW : 0n;
  let failures = 0;
  for (let to = ctx.block; to > floor; to -= CHUNK) {
    const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor + 1n;
    let logs;
    try {
      logs = await ctx.q.getLogs({ address, topics: [TRANSFER, null, pad(user)] }, from, to);
      failures = 0;
    } catch {
      // One failed chunk (a provider briefly behind, a 429) is skipped; two in a row means the RPCs no longer have
      // that history. Positions beyond this point can be added by ID.
      if (++failures >= 2) break;
      continue;
    }
    for (const l of [...logs].reverse()) if (l.topics[3]) ids.push(BigInt(l.topics[3]));
  }
  return [...new Set(ids)];
}

async function load(address: Address, tokenId: bigint, ctx: Ctx): Promise<Position | null> {
  const [key, info] = await ctx.q.read({ address, abi: v4PosmAbi, functionName: 'getPoolAndPositionInfo', args: [tokenId] }, ctx.block);
  if (key.tickSpacing === 0) throw new Error(`Uniswap v4 position #${tokenId} does not exist.`);
  const liquidity = await ctx.q.read({ address, abi: v4PosmAbi, functionName: 'getPositionLiquidity', args: [tokenId] }, ctx.block);
  if (liquidity === 0n) return null; // v4 pays fees out on every liquidity change, so an empty position owes nothing
  const { tickLower, tickUpper } = decodePositionInfo(info);
  const pk: PoolKey = { currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks };
  const native = eq(pk.currency0, ZERO);
  const [s0, s1] = await Promise.all([native ? 'ETH' : symbolOf(pk.currency0, ctx), symbolOf(pk.currency1, ctx)]);
  const raw: UniswapV4Raw = { tokenId, key: pk, poolId: poolIdOf(pk), tickLower, tickUpper, liquidity };
  const badges = hookBadges(pk.hooks);
  return {
    adapter: 'uniswap-v4',
    // v3 and v4 NFT ids are independent counters: a wallet can hold v3 #N and v4 #N, so keep the kit's keys distinct.
    id: `v4:${tokenId}`,
    label: `Uniswap v4 #${tokenId} ${s0}/${s1} ${pk.fee & 0x800000 ? 'dynamic fee' : `${pk.fee / 10_000}%`}`,
    tokens: native ? [pk.currency1] : [pk.currency0, pk.currency1],
    ...(badges.length ? { badges } : {}),
    ...(native
      ? { manual: 'This pool pays out native ETH. This kit version exits ERC-20 pairs only; withdraw it from the Uniswap app or a block explorer.' }
      : {}),
    raw,
  };
}

const unlockData = (actions: number[], params: Hex[]): Hex => encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [toHex(Uint8Array.from(actions)), params]);

export const uniswapV4: ExitAdapter = {
  id: 'uniswap-v4',

  /**
   * v4 position NFTs are not enumerable. balanceOf gives the true count; recent Transfer logs give candidate ids,
   * each confirmed with ownerOf. Any shortfall becomes one "manual" row asking for the id.
   */
  async discover(user, ctx) {
    const address = posm(ctx);
    if (!address) return [];
    const n = await ctx.q.read({ address, abi: v4PosmAbi, functionName: 'balanceOf', args: [user] }, ctx.block);
    if (n === 0n) return [];
    const owned: bigint[] = [];
    for (const id of await recentlyReceived(address, user, ctx)) {
      const owner = await ctx.q.read({ address, abi: v4PosmAbi, functionName: 'ownerOf', args: [id] }, ctx.block).catch(() => null);
      if (owner && eq(owner, user)) owned.push(id);
    }
    const out = (await Promise.all(owned.map((id) => load(address, id, ctx)))).filter((p): p is Position => p !== null);
    const missing = n - BigInt(owned.length);
    if (missing > 0n) {
      out.push({
        adapter: 'uniswap-v4',
        id: NOT_FOUND_ID,
        label: `Uniswap v4: ${missing} more position${missing === 1n ? '' : 's'} in this wallet`,
        tokens: [],
        manual: `${missing} more Uniswap v4 position${missing === 1n ? ' was' : 's were'} not found automatically (received too long ago for public RPCs to search). Enter the position ID below; your wallet's NFT list or the Uniswap app shows it.`,
        raw: null,
      });
    }
    return out;
  },

  async byId(id, user, ctx) {
    const address = posm(ctx);
    if (!address) throw new Error(`Uniswap v4 is not listed in the manifest for chain ${ctx.chainId}.`);
    const raw = id.trim().replace(/^(#|v4:)/i, '');
    if (!/^\d{1,30}$/.test(raw)) throw new Error('A Uniswap v4 position ID is a whole number, like 41448.');
    const tokenId = BigInt(raw);
    const owner = await ctx.q.read({ address, abi: v4PosmAbi, functionName: 'ownerOf', args: [tokenId] }, ctx.block).catch(() => null);
    if (!owner) throw new Error(`Uniswap v4 position #${tokenId} does not exist.`);
    if (!eq(owner, user)) throw new Error(`Uniswap v4 position #${tokenId} is owned by ${short(owner)}, not your wallet.`);
    const p = await load(address, tokenId, ctx);
    if (!p) throw new Error(`Uniswap v4 position #${tokenId} is empty: nothing to withdraw.`);
    return p;
  },

  /**
   * modifyLiquidities([DECREASE_LIQUIDITY(all, mins), TAKE_PAIR(currency0, currency1, user)]).
   * Mins = principal from v4 math at the pinned block − slippage (the contract checks principal, fees excluded).
   * Preview and expected deltas = principal + fees owed (from StateView fee growth).
   */
  async buildExit(pos, ctx): Promise<ExitPlan> {
    const address = posm(ctx);
    const sv = stateView(ctx);
    if (!address || !sv) throw new Error(`Uniswap v4 is not fully listed in the manifest for chain ${ctx.chainId}.`);
    if (pos.manual || !pos.raw) throw new Error(pos.manual ?? 'Nothing to exit.');
    const r = pos.raw as UniswapV4Raw;
    const user = ctx.account;
    const liquidity = await ctx.q.read({ address, abi: v4PosmAbi, functionName: 'getPositionLiquidity', args: [r.tokenId] }, ctx.block);
    const [[sqrtPriceX96, tick], [g0, g1], [, last0, last1]] = await Promise.all([
      ctx.q.read({ address: sv, abi: v4StateViewAbi, functionName: 'getSlot0', args: [r.poolId] }, ctx.block),
      ctx.q.read({ address: sv, abi: v4StateViewAbi, functionName: 'getFeeGrowthInside', args: [r.poolId, r.tickLower, r.tickUpper] }, ctx.block),
      ctx.q.read({ address: sv, abi: v4StateViewAbi, functionName: 'getPositionInfo', args: [r.poolId, address, r.tickLower, r.tickUpper, pad(toHex(r.tokenId))] }, ctx.block),
    ]);
    const principal = amountsForDecrease({ sqrtPriceX96, tick, tickLower: r.tickLower, tickUpper: r.tickUpper, liquidity });
    const fee0 = feesOwed(g0, last0, liquidity);
    const fee1 = feesOwed(g1, last1, liquidity);

    const decrease = encodeAbiParameters(parseAbiParameters('uint256, uint256, uint128, uint128, bytes'), [
      r.tokenId,
      liquidity,
      applySlippage(principal.amount0, ctx.slippageBps),
      applySlippage(principal.amount1, ctx.slippageBps),
      '0x',
    ]);
    const takePair = encodeAbiParameters(parseAbiParameters('address, address, address'), [r.key.currency0, r.key.currency1, user]);
    const data = encodeFunctionData({
      abi: v4PosmAbi,
      functionName: 'modifyLiquidities',
      args: [unlockData([V4_ACTIONS.DECREASE_LIQUIDITY, V4_ACTIONS.TAKE_PAIR], [decrease, takePair]), BigInt(ctx.nowSec() + DEADLINE_SEC)],
    });
    const tx: TxRequest = { chainId: ctx.chainId, from: user, to: address, data, value: 0n };

    const preview = [
      { token: r.key.currency0, amount: principal.amount0 + fee0 },
      { token: r.key.currency1, amount: principal.amount1 + fee1 },
    ].filter((e) => e.amount > 0n);
    const expected = preview.map((e) => ({ token: e.token, min: applySlippage(e.amount, ctx.slippageBps) }));
    return { position: pos, calls: [tx], expected, preview };
  },
};
