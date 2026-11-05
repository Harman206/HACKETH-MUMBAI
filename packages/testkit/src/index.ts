/** Test-only helpers: spawn anvil forks and fund accounts. Never imported by the kit. */
import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  toHex,
  type Address,
  type Chain,
} from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { parseManifest, type Manifest } from '@blackout/core';

export const ANVIL_ACCOUNTS: Address[] = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
];

/** Fork sources, tried in order (env first). Public endpoints flake; anvil only needs one. */
export const FORK_RPCS: Record<1 | 11155111, string[]> = {
  1: [process.env.MAINNET_RPC, 'https://ethereum-rpc.publicnode.com', 'https://1rpc.io/eth', 'https://gateway.tenderly.co/public/mainnet'].filter(Boolean) as string[],
  11155111: [process.env.SEPOLIA_RPC, 'https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.gateway.tenderly.co', 'https://1rpc.io/sepolia'].filter(Boolean) as string[],
};

function anvilBin(): string {
  const local = `${homedir()}/.foundry/bin/anvil`;
  return existsSync(local) ? local : 'anvil';
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

export interface Fork {
  url: string;
  chain: Chain;
  publicClient: ReturnType<typeof createPublicClient>;
  testClient: ReturnType<typeof createTestClient>;
  wallet: (account: Address) => ReturnType<typeof createWalletClient>;
  stop(): Promise<void>;
}

export async function startFork(opts: { chainId: 1 | 11155111; forkUrl?: string; blockNumber?: bigint }): Promise<Fork> {
  const sources = opts.forkUrl ? [opts.forkUrl] : FORK_RPCS[opts.chainId];
  let last: unknown;
  for (const src of sources) {
    try {
      return await startForkFrom(opts.chainId, src, opts.blockNumber);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function startForkFrom(chainId: 1 | 11155111, forkUrl: string, blockNumber?: bigint): Promise<Fork> {
  const opts = { chainId, blockNumber };
  const port = await freePort();
  const args = ['--fork-url', forkUrl, '--port', String(port), '--silent'];
  if (opts.blockNumber) args.push('--fork-block-number', opts.blockNumber.toString());
  const proc: ChildProcess = spawn(anvilBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr?.on('data', (d) => (stderr += d));
  const url = `http://127.0.0.1:${port}`;
  const chain = { ...(opts.chainId === 1 ? mainnet : sepolia), rpcUrls: { default: { http: [url] } } } as Chain;
  const publicClient = createPublicClient({ chain, transport: http(url) });
  for (let i = 0; ; i++) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      if (i > 120 || proc.exitCode !== null) throw new Error(`anvil did not start: ${stderr}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return {
    url,
    chain,
    publicClient,
    testClient: createTestClient({ chain, mode: 'anvil', transport: http(url) }),
    wallet: (account) => createWalletClient({ chain, account, transport: http(url) }),
    stop: async () => {
      proc.kill('SIGTERM');
      await new Promise((r) => proc.once('exit', r));
    },
  };
}

/** Set an ERC20 balance by writing the balances mapping slot (Solidity layout: keccak(holder, slot)). */
export async function setErc20Balance(f: Fork, token: Address, holder: Address, slot: bigint, amount: bigint) {
  const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, slot]));
  await f.testClient.setStorageAt({ address: token, index: key, value: pad(toHex(amount), { size: 32 }) });
}

/** The published manifest (config/manifest.json), parsed by the same codec the kit uses. */
export function repoManifest(): Manifest {
  const p = fileURLToPath(new URL('../../../config/manifest.json', import.meta.url));
  return parseManifest(readFileSync(p, 'utf8'));
}
