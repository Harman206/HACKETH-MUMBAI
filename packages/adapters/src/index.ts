export * from './types';
export * from './uniswap-v3';
import { uniswapV3 } from './uniswap-v3';
import type { ExitAdapter } from './types';

export const ADAPTERS: ExitAdapter[] = [uniswapV3];
