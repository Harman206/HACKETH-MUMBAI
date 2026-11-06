import { encodeFunctionData, parseAbi, type Abi } from 'viem';
import { SIGS, type TxRequest, type Hex, type Address } from '@blackout/core';
import { approveData, ATTACKER, aaveWithdrawData, collectData, curveRemoveData, decreaseData, multicallData, USER, v4 } from './helpers';
import { V4_ACTIONS as A } from '@blackout/core';
import { AAVE_POOL, CURVE_POOL, NPM_MAINNET, POSM_MAINNET, STATEVIEW_MAINNET, tx } from './manifest-fixture';
import { INCIDENT_CORPUS } from './incidents';

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const Z32 = `0x${'00'.repeat(32)}` as Hex;

const enc = (sig: string, args: unknown[]): Hex => {
  const abi = parseAbi([`function ${sig}`] as string[]) as Abi;
  const fn = (abi[0] as { name: string }).name;
  return encodeFunctionData({ abi, functionName: fn, args } as never);
};

const uniExit = multicallData([decreaseData(), collectData(USER)]);

export interface CorpusCase {
  name: string;
  tx: TxRequest;
}

/** Every call the Guard must reject. Real-incident calldata is appended from replay fixtures (Task 9.2). */
export const BANNED_CORPUS: CorpusCase[] = [
  { name: 'approve attacker on USDC', tx: tx(USDC, approveData(ATTACKER)) },
  { name: 'approve to an address in the manifest', tx: tx(NPM_MAINNET, approveData(ATTACKER)) },
  { name: 'increaseAllowance', tx: tx(USDC, enc(SIGS.banned[1], [ATTACKER, 1n])) },
  { name: 'EIP-2612 permit', tx: tx(USDC, enc(SIGS.banned[2], [USER, ATTACKER, 1n, 1n, 27, Z32, Z32])) },
  { name: 'DAI permit', tx: tx(USDC, enc(SIGS.banned[3], [USER, ATTACKER, 0n, 1n, true, 27, Z32, Z32])) },
  { name: 'ERC721 permit on the NPM', tx: tx(NPM_MAINNET, enc(SIGS.banned[4], [ATTACKER, 1n, 1n, 27, Z32, Z32])) },
  { name: 'setApprovalForAll on the NPM', tx: tx(NPM_MAINNET, enc(SIGS.banned[5], [ATTACKER, true])) },
  { name: 'transfer', tx: tx(USDC, enc(SIGS.banned[6], [ATTACKER, 1n])) },
  { name: 'transferFrom user', tx: tx(USDC, enc(SIGS.banned[7], [USER, ATTACKER, 1n])) },
  { name: 'NFT safeTransferFrom', tx: tx(NPM_MAINNET, enc(SIGS.banned[8], [USER, ATTACKER, 1n])) },
  { name: 'NFT safeTransferFrom with data', tx: tx(NPM_MAINNET, enc(SIGS.banned[9], [USER, ATTACKER, 1n, '0x'])) },
  { name: 'Permit2 approve', tx: tx(PERMIT2, enc(SIGS.banned[10], [USDC, ATTACKER, 1n, 1])) },
  {
    name: 'Permit2 permit single',
    tx: tx(PERMIT2, enc(SIGS.banned[11], [USER, [[USDC, 1n, 1, 0], ATTACKER, 1n], '0x'])),
  },
  {
    name: 'Permit2 permit batch',
    tx: tx(PERMIT2, enc(SIGS.banned[12], [USER, [[[USDC, 1n, 1, 0]], ATTACKER, 1n], '0x'])),
  },
  {
    name: 'Permit2 permitTransferFrom',
    tx: tx(PERMIT2, enc(SIGS.banned[13], [[[USDC, 1n], 0n, 1n], [ATTACKER, 1n], USER, '0x'])),
  },
  {
    name: 'Permit2 permitWitnessTransferFrom',
    tx: tx(PERMIT2, enc(SIGS.banned[14], [[[USDC, 1n], 0n, 1n], [ATTACKER, 1n], USER, Z32, 'W', '0x'])),
  },
  { name: 'collect to attacker', tx: tx(NPM_MAINNET, multicallData([decreaseData(), collectData(ATTACKER)])) },
  { name: 'aave withdraw to attacker', tx: tx(AAVE_POOL, aaveWithdrawData(ATTACKER)) },
  { name: 'multicall: valid exit + hidden approve', tx: tx(NPM_MAINNET, multicallData([decreaseData(), collectData(USER), approveData()])) },
  {
    name: 'multicall: valid exit + second collect to attacker',
    tx: tx(NPM_MAINNET, multicallData([decreaseData(), collectData(USER), collectData(ATTACKER)])),
  },
  { name: 'uniswap exit with value', tx: tx(NPM_MAINNET, uniExit, { value: 1n }) },
  { name: 'aave exit with value', tx: tx(AAVE_POOL, aaveWithdrawData(USER), { value: 1n }) },
  { name: 'curve exit with value', tx: tx(CURVE_POOL, curveRemoveData(), { value: 1n }) },
  { name: 'valid exit to an address not in the manifest', tx: tx(ATTACKER, uniExit) },
  { name: 'curve exit sent from another account', tx: tx(CURVE_POOL, curveRemoveData(), { from: ATTACKER }) },
  // Uniswap v4: the real instructions live in modifyLiquidities' action list.
  { name: 'v4: TAKE_PAIR pays the attacker', tx: tx(POSM_MAINNET, v4.exit(ATTACKER)) },
  { name: 'v4: TAKE_PAIR to the MSG_SENDER magic address', tx: tx(POSM_MAINNET, v4.exit('0x0000000000000000000000000000000000000001')) },
  { name: 'v4: exit + SETTLE_PAIR (pulls tokens through the Permit2 allowance)', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.SETTLE_PAIR, A.TAKE_PAIR], [v4.decrease(), v4.settlePair(), v4.takePair()])) },
  { name: 'v4: exit + SWEEP to the attacker', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.TAKE_PAIR, A.SWEEP], [v4.decrease(), v4.takePair(), v4.sweep()])) },
  { name: 'v4: TAKE one currency to the attacker', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.TAKE], [v4.decrease(), v4.take()])) },
  { name: 'v4: MINT_POSITION owned by the attacker', tx: tx(POSM_MAINNET, v4.call([A.MINT_POSITION, A.SETTLE_PAIR], [v4.mint(), v4.settlePair()])) },
  { name: 'v4: CLOSE_CURRENCY (may settle from the user)', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.CLOSE_CURRENCY], [v4.decrease(), v4.sweep(USER)])) },
  { name: 'v4: unknown action code', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, 0x30], [v4.decrease(), '0x'])) },
  { name: 'v4: action count differs from params count', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.TAKE_PAIR], [v4.decrease()])) },
  { name: 'v4: truncated DECREASE params', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.TAKE_PAIR], ['0x1234', v4.takePair()])) },
  { name: 'v4: exit wrapped in multicall with a Permit2 permit', tx: tx(POSM_MAINNET, multicallData([enc(SIGS.banned[11], [USER, [[USDC, 1n, 1, 0], ATTACKER, 1n], '0x']), v4.exit()])) },
  { name: 'v4: valid exit sent to the read-only StateView', tx: tx(STATEVIEW_MAINNET, v4.exit()) },
  { name: 'v4: DECREASE with attacker-chosen hookData (a hook could take a cut)', tx: tx(POSM_MAINNET, v4.call([A.DECREASE_LIQUIDITY, A.TAKE_PAIR], [v4.decrease(7n, 1000n, 0n, 0n, '0xbadbad'), v4.takePair()])) },
  { name: 'v4: BURN with hookData', tx: tx(POSM_MAINNET, v4.call([A.BURN_POSITION, A.TAKE_PAIR], [v4.burnWithHook('0x01'), v4.takePair()])) },
  { name: 'v4: valid exit with value', tx: tx(POSM_MAINNET, v4.exit(), { value: 1n }) },
  ...INCIDENT_CORPUS,
];
