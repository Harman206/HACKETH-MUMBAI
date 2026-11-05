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
  'aave-v3': { pool: [SEL.aaveWithdraw] },
  'curve-3pool': { pool: [SEL.curveRemoveLiquidity], lpToken: [] as Hex[] },
} as const;
