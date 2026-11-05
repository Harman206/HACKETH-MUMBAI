import { isAddress, isHex } from 'viem';
import type { AdapterId, Address, Hex } from '@blackout/core';

export interface Fixture {
  id: 'R1' | 'R2' | 'R3' | 'C1';
  incident: string;
  sources: string[];
  victim: Address;
  drainer: Address;
  attacker?: Address;
  approveTx?: Hex;
  approveCalldata?: Hex;
  approveTarget?: Address;
  permitTypedData?: unknown;
  drainTx: Hex;
  approveBlock?: number;
  drainBlock: number;
  forkBlock: number;
  tokens: Address[];
  lossObserved?: { token: Address; amount: string; decimals: number };
  lps: { adapter: AdapterId; account: Address; positionId?: string }[];
}

/** Throws with the first problem found. Either approveTx+approveCalldata or permitTypedData is required. */
export function validateFixture(f: Fixture): Fixture {
  const need = (c: boolean, m: string) => { if (!c) throw new Error(`${f.id ?? '?'}: ${m}`); };
  need(['R1', 'R2', 'R3', 'C1'].includes(f.id), 'bad id');
  need(f.sources?.length > 0, 'no sources');
  for (const k of ['victim', 'drainer'] as const) need(isAddress(f[k], { strict: false }), `${k} not an address`);
  need(isHex(f.drainTx) && f.drainTx.length === 66, 'drainTx not a tx hash');
  need(!!(f.approveTx && f.approveCalldata) || f.permitTypedData !== undefined || f.id === 'C1', 'needs approveTx+approveCalldata or permitTypedData');
  if (f.approveTx) need(isHex(f.approveTx) && f.approveTx.length === 66, 'approveTx not a tx hash');
  need(Number.isInteger(f.forkBlock) && f.forkBlock < f.drainBlock, 'forkBlock must precede the drain');
  if (f.approveBlock) need(f.forkBlock < f.approveBlock, 'forkBlock must precede the approve');
  need(f.tokens.every((t) => isAddress(t, { strict: false })), 'bad token');
  need(f.lps.every((l) => isAddress(l.account, { strict: false })), 'bad lp account');
  return f;
}
