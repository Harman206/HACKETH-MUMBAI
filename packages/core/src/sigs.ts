import { toFunctionSelector } from 'viem';
import type { Hex } from './types';

/** Canonical function signatures. Single source for selectors, decoders and tests. */
export const SIGS = {
  exits: {
    multicall: 'multicall(bytes[])',
    decreaseLiquidity: 'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))',
    collect: 'collect((uint256,address,uint128,uint128))',
    aaveWithdraw: 'withdraw(address,uint256,address)',
    curveRemoveLiquidity: 'remove_liquidity(uint256,uint256[3])',
    v4ModifyLiquidities: 'modifyLiquidities(bytes,uint256)',
  },
  banned: [
    'approve(address,uint256)',
    'increaseAllowance(address,uint256)',
    'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
    'permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)',
    'permit(address,uint256,uint256,uint8,bytes32,bytes32)',
    'setApprovalForAll(address,bool)',
    'transfer(address,uint256)',
    'transferFrom(address,address,uint256)',
    'safeTransferFrom(address,address,uint256)',
    'safeTransferFrom(address,address,uint256,bytes)',
    'approve(address,address,uint160,uint48)',
    'permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)',
    'permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)',
    'permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)',
    'permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)',
  ],
} as const;

const sel = (sig: string): Hex => toFunctionSelector(`function ${sig}`);

/** Human name → selector for every signature the kit or the Guard refers to. */
export const SEL = {
  multicall: sel(SIGS.exits.multicall),
  decreaseLiquidity: sel(SIGS.exits.decreaseLiquidity),
  collect: sel(SIGS.exits.collect),
  aaveWithdraw: sel(SIGS.exits.aaveWithdraw),
  curveRemoveLiquidity: sel(SIGS.exits.curveRemoveLiquidity),
  v4ModifyLiquidities: sel(SIGS.exits.v4ModifyLiquidities),
  approve: sel('approve(address,uint256)'),
  increaseAllowance: sel('increaseAllowance(address,uint256)'),
  permit2612: sel('permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'),
  permitDai: sel('permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)'),
  permit721: sel('permit(address,uint256,uint256,uint8,bytes32,bytes32)'),
  setApprovalForAll: sel('setApprovalForAll(address,bool)'),
  transfer: sel('transfer(address,uint256)'),
  transferFrom: sel('transferFrom(address,address,uint256)'),
  safeTransferFrom: sel('safeTransferFrom(address,address,uint256)'),
  safeTransferFromData: sel('safeTransferFrom(address,address,uint256,bytes)'),
  permit2Approve: sel('approve(address,address,uint160,uint48)'),
  permit2PermitSingle: sel('permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'),
  permit2PermitBatch: sel('permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'),
  permit2TransferFrom: sel('permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)'),
  permit2WitnessTransferFrom: sel(
    'permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)',
  ),
} as const satisfies Record<string, Hex>;

export const BANNED_SELECTORS: ReadonlySet<Hex> = new Set(SIGS.banned.map(sel));

/** Exit selectors per adapter, used when writing a manifest. */
export const EXIT_SELECTORS = {
  'uniswap-v3': { positionManager: [SEL.multicall, SEL.decreaseLiquidity, SEL.collect] },
  'uniswap-v4': { positionManager: [SEL.v4ModifyLiquidities], stateView: [] as Hex[] },
  'aave-v3': { pool: [SEL.aaveWithdraw] },
  'curve-3pool': { pool: [SEL.curveRemoveLiquidity], lpToken: [] as Hex[] },
} as const;

/**
 * Uniswap v4 PositionManager action codes (v4-periphery src/libraries/Actions.sol).
 * modifyLiquidities(abi.encode(bytes actions, bytes[] params), deadline) runs them in order.
 */
export const V4_ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  INCREASE_LIQUIDITY_FROM_DELTAS: 0x04,
  MINT_POSITION_FROM_DELTAS: 0x05,
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SWAP_EXACT_OUT: 0x09,
  DONATE: 0x0a,
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  SETTLE_PAIR: 0x0d,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  TAKE_PORTION: 0x10,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  CLEAR_OR_TAKE: 0x13,
  SWEEP: 0x14,
  WRAP: 0x15,
  UNWRAP: 0x16,
  MINT_6909: 0x17,
  BURN_6909: 0x18,
  UNWIND_WITH_FALLBACK: 0x19,
} as const;
