import { toHex } from 'viem';
import type { Address, Hex, TxRequest } from '@blackout/core';
import type { Sender } from '@blackout/exec';
import { CHAIN_NAMES } from './config';

const chainName = (id: number) => CHAIN_NAMES[id] ?? `chain ${id}`;

export interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface WalletInfo {
  name: string;
  rdns: string;
}

export class WrongChainError extends Error {
  override name = 'WrongChainError';
  readonly want: number;
  readonly have: number | null;
  constructor(want: number, have: number | null) {
    super(`Switch your wallet to ${chainName(want)}${have ? ` (it is on ${chainName(have)})` : ''}.`);
    this.want = want;
    this.have = have;
  }
}

/** EIP-6963 discovery, with window.ethereum as a fallback. */
export async function discoverWallets(waitMs = 300): Promise<{ info: WalletInfo; provider: Eip1193 }[]> {
  const found = new Map<string, { info: WalletInfo; provider: Eip1193 }>();
  const onAnnounce = (e: Event) => {
    const d = (e as CustomEvent).detail as { info?: { name?: string; rdns?: string; uuid?: string }; provider?: Eip1193 };
    if (d?.provider && d.info?.rdns) found.set(d.info.rdns, { info: { name: d.info.name ?? d.info.rdns, rdns: d.info.rdns }, provider: d.provider });
  };
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((r) => setTimeout(r, waitMs));
  window.removeEventListener('eip6963:announceProvider', onAnnounce);
  const injected = (window as { ethereum?: Eip1193 }).ethereum;
  if (found.size === 0 && injected) found.set('injected', { info: { name: 'Browser wallet', rdns: 'injected' }, provider: injected });
  return [...found.values()];
}

export async function connect(p: Eip1193): Promise<{ account: Address; chainId: number }> {
  const accounts = (await p.request({ method: 'eth_requestAccounts' })) as Address[];
  if (!accounts?.[0]) throw new Error('The wallet returned no account.');
  const chainId = Number(await p.request({ method: 'eth_chainId' }));
  return { account: accounts[0], chainId };
}

export async function ensureChain(p: Eip1193, chainId: number): Promise<void> {
  const have = Number(await p.request({ method: 'eth_chainId' }));
  if (have === chainId) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(chainId) }] });
  } catch {
    throw new WrongChainError(chainId, have);
  }
  const now = Number(await p.request({ method: 'eth_chainId' }));
  if (now !== chainId) throw new WrongChainError(chainId, now);
}

/** Gas headroom over the wallet's own estimate (forked/cold state can be underestimated). */
const GAS_HEADROOM_PCT = 125n;

/**
 * The only wallet methods the kit calls: eth_estimateGas, then eth_sendTransaction.
 * No typed-data signing exists in the kit.
 */
export function senderFrom(p: Eip1193, account: Address): Sender {
  return {
    async sendTransaction(tx: TxRequest): Promise<Hex> {
      if (tx.from.toLowerCase() !== account.toLowerCase()) throw new Error('Refusing to send for an account other than the connected account.');
      const have = Number(await p.request({ method: 'eth_chainId' }));
      if (have !== tx.chainId) throw new WrongChainError(tx.chainId, have);
      const params = { from: tx.from, to: tx.to, data: tx.data, value: toHex(tx.value), chainId: toHex(tx.chainId) };
      let estimate: bigint;
      try {
        estimate = BigInt((await p.request({ method: 'eth_estimateGas', params: [params] })) as string);
      } catch (e) {
        throw new Error(`Your wallet's simulation says this exit would fail: ${(e as Error).message}`);
      }
      const gas = toHex((estimate * GAS_HEADROOM_PCT) / 100n);
      return (await p.request({ method: 'eth_sendTransaction', params: [{ ...params, gas }] })) as Hex;
    },
  };
}
