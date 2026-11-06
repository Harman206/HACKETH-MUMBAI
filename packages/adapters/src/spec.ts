import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, maxUint256, pad, parseAbi, stringToHex, type Abi, type Hex } from 'viem';
import { CallRevertedError } from '@copeybara/quorum';
import { type Address, type ExitKind, type ExitPlan, type Position, type SpecCall } from '@copeybara/core';
import { applySlippage, target, type Ctx, type ExitAdapter } from './types';
import { mapLimit } from './limit';

/** Enumerable discovery stops here; the rest of a huge list is not shown (the kit says so). */
export const SPEC_MAX_IDS = 50;
/** An exit's deadline, when the spec asks for one. */
const DEADLINE_SEC = 20 * 60;

export interface SpecRaw {
  role: string;
  target: Address;
  tokens: Address[];
  id?: bigint;
  amount?: bigint;
}

const kindsOn = (ctx: Ctx): [string, ExitKind, Address][] => {
  const roles = ctx.manifest.chains[String(ctx.chainId)]?.spec ?? {};
  return Object.entries(roles).flatMap(([role, t]) => {
    const kind = ctx.exitSpec?.kinds[role];
    return kind && t.selectors.length ? [[role, kind, t.address] as [string, ExitKind, Address]] : [];
  });
};

const maxOf = (type: string) => {
  const bits = Number(/^uint(\d+)?$/.exec(type)?.[1] ?? 256);
  return bits === 256 ? maxUint256 : (1n << BigInt(bits)) - 1n;
};

type Env = { account: Address; id?: bigint; index?: bigint; amount?: bigint; deadline?: bigint; mins?: bigint[] };

/** Fill a spec's argument placeholders. Anything unresolved throws: no guessing. */
function fill(args: string[], fn: string, env: Env): unknown[] {
  const types = /\(([^)]*)\)/.exec(fn)![1]!.split(',').filter(Boolean);
  return args.map((a, i) => {
    const t = types[i]!;
    if (a === '$account') return env.account;
    if (a === 'true' || a === 'false') return a === 'true';
    if (/^[0-9]+$/.test(a)) return BigInt(a);
    if (a === '$max') return maxOf(t);
    const v = a === '$id' ? env.id : a === '$index' ? env.index : a === '$amount' ? env.amount : a === '$deadline' ? env.deadline : /^\$min:(\d)$/.test(a) ? (env.mins?.[Number(a.slice(5))] ?? 0n) : undefined;
    if (v === undefined) throw new Error(`${fn}: ${a} is not known here`);
    return v;
  });
}

async function view(ctx: Ctx, to: Address, c: SpecCall, env: Env, out: 'uint256' | 'address', block = ctx.block): Promise<bigint | Address> {
  const abi = parseAbi([`function ${c.fn} view returns (${out})`] as string[]) as Abi;
  const name = c.fn.slice(0, c.fn.indexOf('('));
  const data = encodeFunctionData({ abi, functionName: name, args: fill(c.args, c.fn, env) });
  const ret = await ctx.q.call({ to, data }, block);
  const [v] = decodeAbiParameters([{ type: out }], ret);
  return out === 'address' ? getAddress(v as Address) : (v as bigint);
}

function position(role: string, kind: ExitKind, raw: SpecRaw): Position {
  const suffix = raw.id !== undefined ? ` #${raw.id}` : '';
  return { adapter: 'spec', id: `spec:${role}${raw.id !== undefined ? `:${raw.id}` : ''}`, label: `${kind.label}${suffix}`, tokens: raw.tokens, raw };
}

/**
 * The generic adapter: discovers and exits positions in a protocol's own contracts from the declarative
 * org.copeybara.exits record, with no protocol code in the kit. Contract addresses come only from the manifest's
 * `spec` entries. Anything the description cannot express (approvals, ETH, signatures, multi-step flows) is not
 * expressible, and anything the contract refuses at simulation becomes a manual position; nothing is sent for it.
 */
export const specAdapter: ExitAdapter = {
  id: 'spec',

  async discover(user, ctx) {
    const out: Position[] = [];
    for (const [role, kind, to] of kindsOn(ctx)) {
      const env: Env = { account: user };
      const tokens = (await Promise.all(kind.tokens.map((t) => view(ctx, to, t, env, 'address')))) as Address[];
      const d = kind.discover;
      if (d.mode === 'balance') {
        const amount = (await view(ctx, to, d.amount, env, 'uint256')) as bigint;
        if (amount > 0n) out.push(position(role, kind, { role, target: to, tokens, amount }));
        continue;
      }
      let ids: bigint[];
      if (d.mode === 'enumerable') {
        const count = (await view(ctx, to, d.count, env, 'uint256')) as bigint;
        const n = Number(count > BigInt(SPEC_MAX_IDS) ? BigInt(SPEC_MAX_IDS) : count);
        ids = await mapLimit([...Array(n).keys()], 8, async (i) => (await view(ctx, to, d.byIndex, { ...env, index: BigInt(i) }, 'uint256')) as bigint);
      } else {
        const topics: (Hex | null)[] = [keccak256(stringToHex(d.event)), null, null, null];
        topics[d.toTopic] = pad(user.toLowerCase() as Hex, { size: 32 });
        const from = ctx.block > BigInt(d.maxBlocks) ? ctx.block - BigInt(d.maxBlocks) : 0n;
        const logs = await ctx.q.getLogs({ address: to, topics: topics.slice(0, Math.max(d.toTopic, d.idTopic) + 1) }, from, ctx.block);
        const seen = [...new Set(logs.map((l) => BigInt(l.topics[d.idTopic] ?? '0x0')))].slice(0, SPEC_MAX_IDS);
        const owned = await mapLimit(seen, 8, async (id) => ((await view(ctx, to, d.owner, { ...env, id }, 'address')) as Address).toLowerCase() === user.toLowerCase());
        ids = seen.filter((_, i) => owned[i]);
      }
      const amountCall = d.amount;
      for (const id of ids) {
        const amount = amountCall ? ((await view(ctx, to, amountCall, { ...env, id }, 'uint256')) as bigint) : undefined;
        if (amount === 0n) continue;
        out.push(position(role, kind, { role, target: to, tokens, id, ...(amount !== undefined ? { amount } : {}) }));
      }
    }
    return out;
  },

  async buildExit(pos, ctx): Promise<ExitPlan> {
    if (pos.manual) return { position: pos, calls: [], expected: [] };
    const raw = pos.raw as SpecRaw;
    const kind = ctx.exitSpec?.kinds[raw.role];
    const to = target(ctx, 'spec', raw.role)?.address;
    if (!kind || !to || to.toLowerCase() !== raw.target.toLowerCase()) throw new Error(`${pos.label} is no longer listed in the manifest or exit description.`);
    const abi = parseAbi([`function ${kind.exit.fn} returns (${kind.exit.returns.join(',')})`] as string[]) as Abi;
    const name = kind.exit.fn.slice(0, kind.exit.fn.indexOf('('));
    const env: Env = { account: ctx.account, id: raw.id, amount: raw.amount, deadline: BigInt(ctx.nowSec() + DEADLINE_SEC) };
    const encode = (mins: bigint[]) => encodeFunctionData({ abi, functionName: name, args: fill(kind.exit.args, kind.exit.fn, { ...env, mins }) });

    const simulate = async (data: Hex) => {
      const ret = await ctx.q.call({ to, from: ctx.account, data }, ctx.block);
      const r = decodeFunctionResult({ abi, functionName: name, data: ret });
      return (Array.isArray(r) ? r : [r]) as unknown[];
    };
    let rets: unknown[];
    let data = encode([]);
    try {
      rets = await simulate(data);
      if (kind.exit.args.some((a) => a.startsWith('$min:'))) {
        data = encode(kind.exit.returns.map((_, i) => (typeof rets[i] === 'bigint' ? applySlippage(rets[i] as bigint, ctx.slippageBps) : 0n)));
        rets = await simulate(data);
      }
    } catch (e) {
      if (!(e instanceof CallRevertedError)) throw e;
      const manual = `${kind.label} refuses this withdrawal right now (${e.message}). It may be paused, locked or short of liquidity; nothing was sent.`;
      return { position: { ...pos, manual }, calls: [], expected: [] };
    }
    const payouts = kind.exit.payout.map((p) => ({ token: raw.tokens[p.token]!, amount: rets[p.ret] as bigint }));
    return {
      position: pos,
      calls: [{ chainId: ctx.chainId, from: ctx.account, to, data, value: 0n }],
      expected: payouts.filter((p) => p.amount > 0n).map((p) => ({ token: p.token, min: applySlippage(p.amount, ctx.slippageBps) })),
      preview: payouts.filter((p) => p.amount > 0n),
    };
  },
};
