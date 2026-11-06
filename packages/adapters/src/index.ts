export * from './types';
export * from './uniswap-v3';
export * from './uniswap-v4';
export * from './v4-math';
export * from './aave-v3';
export * from './curve-3pool';
import { uniswapV3 } from './uniswap-v3';
import { uniswapV4 } from './uniswap-v4';
import { aaveV3 } from './aave-v3';
import { curve3pool } from './curve-3pool';
import type { ExitAdapter } from './types';

export const ADAPTERS: ExitAdapter[] = [uniswapV3, uniswapV4, aaveV3, curve3pool];
