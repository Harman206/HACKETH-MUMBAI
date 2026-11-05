import { encodeFunctionData, parseAbi, type Abi } from 'viem';
import { SIGS, type TxRequest, type Hex, type Address } from '@blackout/core';
import { approveData, ATTACKER, aaveWithdrawData, collectData, curveRemoveData, decreaseData, multicallData, USER } from './helpers';
import { AAVE_POOL, CURVE_POOL, NPM_MAINNET, tx } from './manifest-fixture';
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
  ...INCIDENT_CORPUS,
];
