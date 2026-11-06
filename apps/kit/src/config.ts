import networks from '../../../config/networks.json';
import type { Address } from '@copeybara/core';

/**
 * Bootstrap constants. These are the trust root: hashed into the kit with everything else.
 * Protocol addresses are NOT here — they come from the ENS manifest.
 */
export const ENS_CONFIG = {
  chainId: networks.ens.chainId,
  universalResolver: networks.ens.universalResolver as Address,
};

export const DEFAULT_RPCS: Record<string, string[]> = networks.defaultRpcs;

export const CHAIN_NAMES: Record<number, string> = { 1: 'Ethereum mainnet', 11155111: 'Sepolia' };
export const EXPLORERS: Record<number, string> = { 1: 'https://etherscan.io/tx/', 11155111: 'https://sepolia.etherscan.io/tx/' };
