export * from './types';
export * from './uniswap-v3';
export * from './aave-v3';
export * from './curve-3pool';
import { uniswapV3 } from './uniswap-v3';
import { aaveV3 } from './aave-v3';
import { curve3pool } from './curve-3pool';
import type { ExitAdapter } from './types';

export const ADAPTERS: ExitAdapter[] = [uniswapV3, aaveV3, curve3pool];
