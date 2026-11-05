export * from './types';
export * from './uniswap-v3';
export * from './aave-v3';
import { uniswapV3 } from './uniswap-v3';
import { aaveV3 } from './aave-v3';
import type { ExitAdapter } from './types';

export const ADAPTERS: ExitAdapter[] = [uniswapV3, aaveV3];
