import { EXIT_SELECTORS, type Address, type Manifest, type TxRequest, type Hex } from '@blackout/core';
import { USER } from './helpers';

export const NPM_SEPOLIA: Address = '0x1238536071E1c677A632429e3655c799b22cDA52';
export const NPM_MAINNET: Address = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';
export const AAVE_POOL: Address = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
export const CURVE_POOL: Address = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
export const CURVE_LP: Address = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490';

export const MANIFEST: Manifest = {
  v: 1,
  chains: {
    '11155111': {
      'uniswap-v3': { positionManager: { address: NPM_SEPOLIA, selectors: [...EXIT_SELECTORS['uniswap-v3'].positionManager] } },
    },
    '1': {
      'uniswap-v3': { positionManager: { address: NPM_MAINNET, selectors: [...EXIT_SELECTORS['uniswap-v3'].positionManager] } },
      'aave-v3': { pool: { address: AAVE_POOL, selectors: [...EXIT_SELECTORS['aave-v3'].pool] } },
      'curve-3pool': {
        pool: { address: CURVE_POOL, selectors: [...EXIT_SELECTORS['curve-3pool'].pool] },
        lpToken: { address: CURVE_LP, selectors: [] },
      },
    },
  },
};

export const ctx1 = { account: USER, chainId: 1, manifest: MANIFEST };
export const ctxSepolia = { account: USER, chainId: 11155111, manifest: MANIFEST };

export const tx = (to: Address, data: Hex, over: Partial<TxRequest> = {}): TxRequest => ({
  chainId: 1,
  from: USER,
  to,
  data,
  value: 0n,
  ...over,
});
