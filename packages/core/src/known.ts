/**
 * Built-in table of well-known contracts (config/known-contracts.json), used by the request classifier so the
 * normal Uniswap flow (approve Permit2, sign a Permit2 permit for the Universal Router) is not flagged as a drainer.
 * Addresses come from Uniswap's deployment docs and were checked for bytecode on chain; the JSON lists the sources.
 * This table only lowers false alarms. It never lets the Exit Guard accept anything: exits still come from the ENS manifest.
 */
import { getAddress, isAddress } from 'viem';
import table from '../../../config/known-contracts.json' with { type: 'json' };
import type { Address } from './types';

/** protocol → decimal chain id → role → address */
export interface KnownTable {
  v: 1;
  protocols: Record<string, Record<string, Record<string, string>>>;
}

export interface KnownContract {
  protocol: string;
  role: string;
  /** Plain name for explanations, e.g. "Universal Router". */
  name: string;
  address: Address;
}

export const KNOWN_CONTRACTS: KnownTable = table as KnownTable;

const ROLE_NAMES: Record<string, string> = {
  permit2: 'Permit2',
  universalRouter: 'Universal Router',
  universalRouter211: 'Universal Router',
  universalRouter212: 'Universal Router',
  v3PositionManager: 'v3 Position Manager',
  swapRouter02: 'SwapRouter02',
  v4PoolManager: 'v4 PoolManager',
  v4PositionManager: 'v4 Position Manager',
  v4StateView: 'v4 StateView',
};

/** The well-known contract at `addr` on `chainId`, if any. */
export function knownContract(addr: string, chainId: number, t: KnownTable = KNOWN_CONTRACTS): KnownContract | undefined {
  if (!isAddress(addr, { strict: false })) return undefined;
  const a = addr.toLowerCase();
  for (const [protocol, chains] of Object.entries(t.protocols)) {
    for (const [role, address] of Object.entries(chains[String(chainId)] ?? {})) {
      if (address.toLowerCase() === a) return { protocol, role, name: ROLE_NAMES[role] ?? role, address: getAddress(address) };
    }
  }
  return undefined;
}

/** Permit2 is at the same address on every chain Uniswap deploys to. */
export const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
