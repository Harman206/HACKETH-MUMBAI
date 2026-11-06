/**
 * The watcher's own ENS identity: watcher.<protocol>.eth (an ENSv2 subname owned by the protocol's Safe, with its
 * own Safe-only resolver; contracts/script/RegisterAgent.s.sol). addr = this agent's key; text records say what it
 * is and which records it may write. The watcher reads it at startup and reports it; it cannot change it.
 */
import { decodeAbiParameters, decodeFunctionResult, encodeFunctionData, getAddress, isAddress, namehash, parseAbi, toHex, type Hex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { textResolverAbi, universalResolverAbi, type Address } from '@copeybara/core';
import type { Quorum } from '@copeybara/quorum';

export const AGENT_KEY = 'org.copeybara.agent';

export interface AgentRecord {
  role: string;
  may_write: string[];
  of: string;
  operator: Address;
  code: string;
  version: 1;
}

export interface AgentIdentity {
  name: string;
  addr: Address | null;
  description: string | null;
  url: string | null;
  agent: AgentRecord | null;
  /** addr is this process's key and the agent record parsed */
  verified: boolean;
  problems: string[];
}

const str = (o: Record<string, unknown>, k: string): string => {
  const v = o[k];
  if (typeof v !== 'string' || !v) throw new Error(`"${k}" must be a non-empty string`);
  return v;
};

/** Parse org.copeybara.agent (version 1). Throws on anything malformed; unknown extra fields are ignored. */
export function parseAgentRecord(s: string): AgentRecord {
  let o: unknown;
  try {
    o = JSON.parse(s);
  } catch {
    throw new Error('not JSON');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a JSON object');
  const r = o as Record<string, unknown>;
  if (r.version !== 1) throw new Error(`unsupported version ${JSON.stringify(r.version)}`);
  const mw = r.may_write;
  if (!Array.isArray(mw) || !mw.every((x) => typeof x === 'string' && x)) throw new Error('"may_write" must be a list of record keys');
  const operator = str(r, 'operator');
  if (!isAddress(operator, { strict: false })) throw new Error(`"operator" is not an address: ${operator}`);
  return { role: str(r, 'role'), may_write: mw as string[], of: str(r, 'of'), operator: getAddress(operator) as Address, code: str(r, 'code'), version: 1 };
}

export type ReadText = (name: string, key: string) => Promise<string>;
export type ReadAddr = (name: string) => Promise<string | null>;

/** Read the identity; never throws (a watcher without a readable identity still watches, it just says so). */
export async function readAgentIdentity(name: string, readText: ReadText, readAddr: ReadAddr, me: string): Promise<AgentIdentity> {
  const problems: string[] = [];
  const get = async <T>(what: string, f: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      problems.push(`${what}: ${(e as Error).message}`);
      return fallback;
    }
  };
  const [rawAddr, description, url, rawAgent] = await Promise.all([
    get('addr', () => readAddr(name), null),
    get('description', () => readText(name, 'description'), ''),
    get('url', () => readText(name, 'url'), ''),
    get(AGENT_KEY, () => readText(name, AGENT_KEY), ''),
  ]);
  let agent: AgentRecord | null = null;
  if (rawAgent) {
    try {
      agent = parseAgentRecord(rawAgent);
    } catch (e) {
      problems.push(`${AGENT_KEY}: ${(e as Error).message}`);
    }
  }
  const addr = rawAddr && isAddress(rawAddr, { strict: false }) && BigInt(rawAddr) !== 0n ? (getAddress(rawAddr) as Address) : null;
  const mine = addr !== null && addr.toLowerCase() === me.toLowerCase();
  if (addr && !mine) problems.push(`addr is ${addr}, but this watcher's key is ${getAddress(me)}`);
  return { name, addr, description: description || null, url: url || null, agent, verified: mine && agent !== null, problems };
}

/** The startup log line. */
export function identityLine(id: AgentIdentity): string {
  if (!id.agent && !id.addr) return `no ENS identity found at ${id.name}${id.problems.length ? ` (${id.problems.join('; ')})` : ''}`;
  const may = id.agent ? `allowed to write ${id.agent.may_write.join(', ')} on ${id.agent.of} (operator ${id.agent.operator}` : `(agent record unreadable`;
  return `I am ${id.name}, ${may}; ${id.verified ? 'identity verified on ENS' : `identity NOT verified: ${id.problems.join('; ')}`})`;
}

const addrAbi = parseAbi(['function addr(bytes32 node) view returns (address)']);

/** ENS readers through the quorum + UniversalResolver (same path as every other Copeybara read). */
export function ensReaders(q: Quorum, universalResolver: Address): { readText: ReadText; readAddr: ReadAddr } {
  const call = async (name: string, inner: Hex): Promise<Hex> => {
    const data = encodeFunctionData({ abi: universalResolverAbi, functionName: 'resolve', args: [toHex(packetToBytes(name)), inner] });
    const out = await q.call({ to: universalResolver, data }, await q.pinBlock());
    return decodeAbiParameters([{ type: 'bytes' }, { type: 'address' }], out)[0];
  };
  return {
    readText: async (name, key) =>
      decodeFunctionResult({
        abi: textResolverAbi,
        functionName: 'text',
        data: await call(name, encodeFunctionData({ abi: textResolverAbi, functionName: 'text', args: [namehash(name), key] })),
      }),
    readAddr: async (name) =>
      decodeFunctionResult({ abi: addrAbi, functionName: 'addr', data: await call(name, encodeFunctionData({ abi: addrAbi, functionName: 'addr', args: [namehash(name)] })) }),
  };
}
