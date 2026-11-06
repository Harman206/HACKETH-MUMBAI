import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
} from 'viem';
import type { Address, Hex } from '@blackout/core';
import { CallRevertedError, QuorumError } from './errors';

export interface QuorumOpts {
  urls: string[];
  minAnswers?: number;
  timeoutMs?: number;
  retries?: number;
  /** A path marked down is skipped for this long before it is tried again. */
  cooldownMs?: number;
  /** Paths whose head is more than this many blocks from the median head are ignored when pinning. */
  maxLagBlocks?: number;
  /** When set, the agreed chain ID must equal this, or every read fails with CHAIN_MISMATCH. */
  expectedChainId?: number;
  fetchFn?: typeof fetch;
}

export interface PathStatus {
  url: string;
  up: boolean;
  lastError?: string;
}

export interface Receipt {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  blockHash: Hex;
  gasUsed: bigint;
  transactionHash: Hex;
}

export interface ReadParams<abi extends Abi, fn extends ContractFunctionName<abi, 'view' | 'pure'>> {
  address: Address;
  abi: abi;
  functionName: fn;
  args?: ContractFunctionArgs<abi, 'view' | 'pure', fn>;
  from?: Address;
}

export interface Quorum {
  readonly urls: readonly string[];
  status(): PathStatus[];
  chainId(): Promise<number>;
  pinBlock(): Promise<bigint>;
  call(req: { to: Address; data: Hex; from?: Address }, block: bigint): Promise<Hex>;
  read<const abi extends Abi, fn extends ContractFunctionName<abi, 'view' | 'pure'>>(
    p: ReadParams<abi, fn>,
    block: bigint,
  ): Promise<ContractFunctionReturnType<abi, 'view' | 'pure', fn>>;
  getBalance(addr: Address, block: bigint): Promise<bigint>;
  getReceipt(hash: Hex): Promise<Receipt | null>;
  /** eth_getLogs over [fromBlock, toBlock]; every answering path must return the same logs. */
  getLogs(filter: { address: Address | Address[]; topics?: (Hex | Hex[] | null)[] }, fromBlock: bigint, toBlock: bigint): Promise<RpcLog[]>;
}

export interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  transactionHash: Hex;
  logIndex: Hex;
}

/** An answer: either a JSON-RPC result, or an execution revert (which is a real answer, not a failure). */
type Answer = { ok: true; value: unknown } | { ok: false; revert: string; data?: string };

class PathFailure extends Error {}
class RateLimited extends PathFailure {}

/** After enough paths answered, wait this long for the rest, then decide without them. */
const GRACE_MS = 1000;

const toHex = (n: bigint) => `0x${n.toString(16)}` as Hex;
const isRevert = (e: { code?: number; message?: string }) => e.code === 3 || /revert/i.test(e.message ?? '');

export function createQuorum(opts: QuorumOpts): Quorum {
  const minAnswers = opts.minAnswers ?? 2;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const retries = opts.retries ?? 2;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const maxLag = BigInt(opts.maxLagBlocks ?? 16);
  const fetchFn = opts.fetchFn ?? fetch;
  const paths = opts.urls.map((url) => ({ url, up: true, lastError: undefined as string | undefined, downUntil: 0 }));
  let chainChecked: Promise<number> | null = null;
  let nextId = 1;

  async function once(url: string, method: string, params: unknown[]): Promise<Answer> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
        signal: ac.signal,
      });
      if (res.status === 429) throw new RateLimited('HTTP 429 (rate limited)');
      if (!res.ok) throw new PathFailure(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
      if (body.error) {
        if (isRevert(body.error)) {
          const data = typeof body.error.data === 'string' ? body.error.data : undefined;
          return { ok: false, revert: body.error.message ?? 'execution reverted', data };
        }
        throw new PathFailure(`RPC error ${body.error.code}: ${body.error.message}`);
      }
      return { ok: true, value: body.result };
    } catch (e) {
      if (e instanceof PathFailure) throw e;
      throw new PathFailure(ac.signal.aborted ? `timeout after ${timeoutMs} ms` : (e as Error).message);
    } finally {
      clearTimeout(timer);
    }
  }

  async function ask(i: number, method: string, params: unknown[]): Promise<Answer | null> {
    const p = paths[i]!;
    if (!p.up && Date.now() < p.downUntil) return null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const a = await once(p.url, method, params);
        p.up = true;
        p.lastError = undefined;
        return a;
      } catch (e) {
        p.lastError = (e as Error).message;
        if (e instanceof RateLimited && attempt < retries) await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
    p.up = false;
    p.downUntil = Date.now() + cooldownMs;
    return null;
  }

  /**
   * Ask every path; require ≥minAnswers answers. Once minAnswers have answered, the remaining paths get
   * GRACE_MS more: a slow path does not delay the result, but any path that does answer is counted.
   */
  async function gather(method: string, params: unknown[]): Promise<Answer[]> {
    const answers = await new Promise<Answer[]>((resolve) => {
      const got: Answer[] = [];
      let settled = 0;
      let grace: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (grace) clearTimeout(grace);
        resolve([...got]);
      };
      paths.forEach((_, i) => {
        void ask(i, method, params).then((a) => {
          settled++;
          if (a && !done) got.push(a);
          if (settled === paths.length) finish();
          else if (got.length >= minAnswers && !grace && !done) grace = setTimeout(finish, GRACE_MS);
        });
      });
    });
    if (answers.length < minAnswers) {
      throw new QuorumError('TOO_FEW', `Only ${answers.length} of ${paths.length} RPC paths answered ${method}; need ${minAnswers}.`);
    }
    return answers;
  }

  // Providers format revert data differently; an agreed revert is "reverted" regardless of payload.
  const key = (a: Answer) => (a.ok ? `r:${JSON.stringify(a.value)}` : 'e:revert');

  /** Every answer must be identical. */
  async function agreed(method: string, params: unknown[]): Promise<unknown> {
    const answers = await gather(method, params);
    const first = answers[0]!;
    if (!answers.every((a) => key(a) === key(first))) {
      throw new QuorumError('DISAGREE', `RPC paths disagree on ${method}; refusing to continue.`);
    }
    if (!first.ok) throw new CallRevertedError(first.revert, first.data);
    return first.value;
  }

  function ensureChain(): Promise<number> {
    chainChecked ??= (async () => {
      const answers = await gather('eth_chainId', []);
      const ids = answers.map((a) => (a.ok ? Number(a.value) : NaN));
      if (ids.some((x) => x !== ids[0]) || Number.isNaN(ids[0])) {
        throw new QuorumError('CHAIN_MISMATCH', `RPC paths report different chains (${[...new Set(ids)].join(', ')}).`);
      }
      if (opts.expectedChainId !== undefined && ids[0] !== opts.expectedChainId) {
        throw new QuorumError('CHAIN_MISMATCH', `The RPC endpoints are on chain ${ids[0]}, not chain ${opts.expectedChainId}.`);
      }
      return ids[0]!;
    })().catch((e) => {
      chainChecked = null;
      throw e;
    });
    return chainChecked;
  }

  const q: Quorum = {
    urls: opts.urls,
    status: () => paths.map(({ url, up, lastError }) => ({ url, up, ...(lastError ? { lastError } : {}) })),
    chainId: ensureChain,

    async pinBlock() {
      await ensureChain();
      const answers = await gather('eth_blockNumber', []);
      const heights = answers.map((a) => (a.ok ? BigInt(a.value as string) : null)).filter((x): x is bigint => x !== null);
      if (heights.length < minAnswers) throw new QuorumError('TOO_FEW', 'Not enough paths reported a block number.');
      // A single path must not be able to pick an old block (stale state = rolled-back records, stale prices).
      // Keep heads within maxLag of the (lower) median head, then pin the lowest of those.
      const sorted = [...heights].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const median = sorted[Math.floor((sorted.length - 1) / 2)]!;
      const near = sorted.filter((h) => (h > median ? h - median : median - h) <= maxLag);
      if (near.length < minAnswers) {
        throw new QuorumError('DISAGREE', `RPC paths are too far apart in block height (${sorted.join(', ')}); refusing to pick one.`);
      }
      return near[0]!;
    },

    async call(req, block) {
      await ensureChain();
      const tx: Record<string, string> = { to: req.to, data: req.data };
      if (req.from) tx.from = req.from;
      return (await agreed('eth_call', [tx, toHex(block)])) as Hex;
    },

    async read(p, block) {
      const data = encodeFunctionData({ abi: p.abi, functionName: p.functionName, args: p.args } as never);
      const out = await q.call({ to: p.address, data, from: p.from }, block);
      return decodeFunctionResult({ abi: p.abi, functionName: p.functionName, data: out } as never) as never;
    },

    async getBalance(addr, block) {
      await ensureChain();
      return BigInt((await agreed('eth_getBalance', [addr, toHex(block)])) as string);
    },

    async getLogs(filter, fromBlock, toBlock) {
      await ensureChain();
      const norm = (logs: RpcLog[]) =>
        logs.map(({ address, topics, data, blockNumber, transactionHash, logIndex }) => ({ address, topics, data, blockNumber, transactionHash, logIndex }));
      const answers = await gather('eth_getLogs', [{ ...filter, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) }]);
      const vals = answers.map((a) => (a.ok ? norm(a.value as RpcLog[]) : null));
      const k = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'string' ? x.toLowerCase() : x));
      if (vals.some((v) => v === null || k(v) !== k(vals[0]))) throw new QuorumError('DISAGREE', 'RPC paths disagree on eth_getLogs.');
      return vals[0]!;
    },

    async getReceipt(hash) {
      await ensureChain();
      const answers = await gather('eth_getTransactionReceipt', [hash]);
      type Raw = { status: string; blockNumber: string; blockHash: Hex; gasUsed: string; transactionHash: Hex };
      const seen = answers.filter((a): a is { ok: true; value: Raw } => a.ok && a.value !== null);
      if (seen.length === 0) return null;
      const k = (r: Raw) => `${r.status}|${r.blockHash}|${r.blockNumber}|${r.gasUsed}`;
      if (!seen.every((a) => k(a.value) === k(seen[0]!.value))) {
        throw new QuorumError('DISAGREE', 'RPC paths disagree on the transaction receipt.');
      }
      if (seen.length < minAnswers) return null;
      const r = seen[0]!.value;
      return {
        status: r.status === '0x1' ? 'success' : 'reverted',
        blockNumber: BigInt(r.blockNumber),
        blockHash: r.blockHash,
        gasUsed: BigInt(r.gasUsed),
        transactionHash: r.transactionHash,
      };
    },
  };
  return q;
}
