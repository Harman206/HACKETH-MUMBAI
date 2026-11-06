/** Real chain adapters for the theater (testnet keys from gitignored contracts/.env; never used by the kit). */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, fallback, http, nonceManager, parseAbi, parseEther, formatUnits, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { erc20Abi, npmAbi } from '@blackout/core';
import type { Quorum } from '@blackout/quorum';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NPM: Address = '0x1238536071E1c677A632429e3655c799b22cDA52';
const mintAbi = parseAbi([
  'struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }',
  'function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
]);

/** KEY=VALUE lines from contracts/.env (process env wins). */
export function loadEnv(file = join(REPO, 'contracts', '.env')): Record<string, string> {
  const out: Record<string, string> = {};
  if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) out[m[1]!] = m[2]!; }
  return { ...out, ...(process.env as Record<string, string>) };
}

const PUBLIC_SEPOLIA = ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://1rpc.io/sepolia'];

/** Live Sepolia: fall back across public providers (one rate-limited provider must not stall the demo). Local forks: just the fork. */
export function transportFor(rpcUrl: string) {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(rpcUrl);
  const urls = local ? [rpcUrl] : [...new Set([rpcUrl, ...PUBLIC_SEPOLIA])];
  return fallback(urls.map((u) => http(u, { retryCount: 2, retryDelay: 400 })), { rank: false, retryCount: 1 });
}

export function clients(rpcUrl: string, key: Hex) {
  const chain = defineChain({ id: 11155111, name: 'Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  // Local nonce tracking: load-balanced public RPCs can report a stale pending nonce, so back-to-back sends collided.
  const account = privateKeyToAccount(key, { nonceManager });
  return {
    account,
    pub: createPublicClient({ chain, transport: transportFor(rpcUrl) }),
    wallet: createWalletClient({ chain, account, transport: transportFor(rpcUrl) }),
  };
}

/** What a victim still needs: 10,000 DUSD to lose, gas (0.003 ETH) to act, and one position to rescue. */
export function fundingPlan(b: { dusd: bigint; positions: bigint; eth: bigint }) {
  return { dusd: b.dusd < parseEther('10000'), eth: b.eth < parseEther('0.003'), mint: b.positions < 1n };
}

export function makePrepareVictim(o: { rpcUrl: string; deployerKey: Hex; dusd: Address; deth: Address }) {
  const { pub, wallet, account } = clients(o.rpcUrl, o.deployerKey);
  const [t0, t1] = o.dusd.toLowerCase() < o.deth.toLowerCase() ? [o.dusd, o.deth] : [o.deth, o.dusd];
  return async (victim: Address): Promise<Hex[]> => {
    // Reuse an already-funded victim (re-running the demo with the same "Account 2" costs nothing).
    const [dusdBal, npmBal, ethBal] = await Promise.all([
      pub.readContract({ address: o.dusd, abi: erc20Abi, functionName: 'balanceOf', args: [victim] }),
      pub.readContract({ address: NPM, abi: npmAbi, functionName: 'balanceOf', args: [victim] }),
      pub.getBalance({ address: victim }),
    ]);
    const plan = fundingPlan({ dusd: dusdBal, positions: npmBal, eth: ethBal });
    const wait = async (h: Hex) => {
      const r = await pub.waitForTransactionReceipt({ hash: h });
      if (r.status === 'success') return h;
      // Re-simulate at the parent block to surface the revert reason.
      const t = await pub.getTransaction({ hash: h });
      const why = await pub.call({ account: t.from, to: t.to!, data: t.input, value: t.value, blockNumber: r.blockNumber - 1n }).then(() => 'no reason', (e) => (e as Error).message.split('\n')[0]);
      throw new Error(`prepare tx ${h} reverted: ${why} (gasUsed ${r.gasUsed} of limit ${t.gas}, block ${r.blockNumber})`);
    };
    const txs: Hex[] = [];
    if (plan.dusd) txs.push(await wait(await wallet.writeContract({ address: o.dusd, abi: parseAbi(['function transfer(address,uint256) returns (bool)']), functionName: 'transfer', args: [victim, parseEther('10000')], account, chain: wallet.chain })));
    if (plan.eth) txs.push(await wait(await wallet.sendTransaction({ to: victim, value: parseEther('0.01'), account, chain: wallet.chain })));
    if (!plan.mint) return txs;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const mintArgs = [{ token0: t0, token1: t1, fee: 3000, tickLower: -6000, tickUpper: 6000, amount0Desired: parseEther('1000'), amount1Desired: parseEther('1000'), amount0Min: 0n, amount1Min: 0n, recipient: victim, deadline }] as const;
    // Gas varies a lot (re-initialising ticks after LPs exit costs far more): estimate + 30 % headroom, never a fixed limit.
    const est = await pub.estimateContractGas({ address: NPM, abi: mintAbi, functionName: 'mint', account, args: mintArgs });
    txs.push(await wait(await wallet.writeContract({ address: NPM, abi: mintAbi, functionName: 'mint', account, chain: wallet.chain, gas: (est * 13n) / 10n, args: mintArgs })));
    return txs;
  };
}

export function makeReadVictim(o: { q: Quorum; dusd: Address }) {
  return async (victim: Address) => {
    const block = await o.q.pinBlock();
    const bal = await o.q.read({ address: o.dusd, abi: erc20Abi, functionName: 'balanceOf', args: [victim] }, block);
    const n = await o.q.read({ address: NPM, abi: npmAbi, functionName: 'balanceOf', args: [victim] }, block);
    const positions: string[] = [];
    for (let i = 0n; i < n; i++) positions.push((await o.q.read({ address: NPM, abi: npmAbi, functionName: 'tokenOfOwnerByIndex', args: [victim, i] }, block)).toString());
    return { dusd: Number(formatUnits(bal, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 }), positions };
  };
}

export function makeVerifyKits(o: { kitFile: string; tamperedFile: string; ensName: string; rpcs: string[] }) {
  const run = (f: string) => {
    const three = [o.rpcs[0], o.rpcs[1] ?? o.rpcs[0], o.rpcs[2] ?? o.rpcs[0]] as string[];
    const r = spawnSync('bash', [join(REPO, 'scripts', 'verify-kit.sh'), f, o.ensName, ...three], { encoding: 'utf8' });
    return (r.stdout || r.stderr).trim();
  };
  return async () => ({ real: run(o.kitFile), tampered: run(o.tamperedFile) });
}

export function makeSender(rpcUrl: string, key: Hex) {
  const { wallet, account } = clients(rpcUrl, key);
  return (to: Address, data: Hex) => wallet.sendTransaction({ to, data, account, chain: wallet.chain, gas: 200_000n });
}
