/**
 * org.copeybara.exits: a declarative description of how to find and exit a protocol's own positions, so the kit can
 * exit contracts it has no adapter code for. It holds NO addresses: each kind names a role under the manifest's
 * `spec` protocol, and the manifest (also Safe-written) carries the address and the allowed exit selector.
 *
 * Parsing is fail-closed: an unknown field, an unknown argument type or placeholder, an address argument that is not
 * pinned to the connected account, or anything that needs ETH, a signature or bytes is a SpecError, never a default.
 */
import { toFunctionSelector } from 'viem';
import { BANNED_SELECTORS, SEL } from './sigs';
import type { Hex, Manifest } from './types';

export class SpecError extends Error {
  override name = 'SpecError';
}

export const EXIT_SPEC_VERSION = 1;

/** Value placeholders. `$min:<i>` = simulated return value i minus slippage. Decimal strings are literals. */
export type SpecArg = string;

/** A view call on the kind's own target (the manifest address). */
export interface SpecCall {
  fn: string;
  args: SpecArg[];
}

export type SpecDiscovery =
  /** One position when amount(args) > 0 (e.g. ERC-4626 shares: balanceOf($account)). Position id = the kind name. */
  | { mode: 'balance'; amount: SpecCall }
  /** count($account) ids via byIndex($account, $index); optional per-id amount. */
  | { mode: 'enumerable'; count: SpecCall; byIndex: SpecCall; amount?: SpecCall }
  /** Bounded scan of an ERC-721-style Transfer event to the account, each id confirmed with owner($id) == $account. */
  | { mode: 'logs'; event: string; toTopic: 1 | 2 | 3; idTopic: 1 | 2 | 3; owner: SpecCall; amount?: SpecCall; maxBlocks: number };

export interface SpecExit {
  /** Canonical signature, e.g. "redeem(uint256,address,address)". */
  fn: string;
  args: SpecArg[];
  /** Argument indexes that receive the payout. Each must be an address argument set to $account. */
  recipient: number[];
  /** Other address arguments that must also be the account (e.g. ERC-4626 `owner`). */
  self: number[];
  /** True when the contract pays msg.sender; the Guard then pins `from` to the account. */
  paysCaller: boolean;
  /** Return types of the exit function, used to read simulated payouts. */
  returns: string[];
  /** Which return value is paid in which token (index into `tokens`). Proves recovery by balance delta. */
  payout: { token: number; ret: number }[];
}

export interface ExitKind {
  label: string;
  discover: SpecDiscovery;
  /** View calls on the target that return the payout token addresses (e.g. ERC-4626 asset()). */
  tokens: SpecCall[];
  exit: SpecExit;
}

export interface ExitSpec {
  v: 1;
  kinds: Record<string, ExitKind>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const KIND_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
const FN_RE = /^([A-Za-z_][A-Za-z0-9_]*)\(([a-z0-9,]*)\)$/;
const INT_RE = /^(u?)int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
const LITERAL_RE = /^(0|[1-9][0-9]{0,77})$/;
const MAX_LOG_BLOCKS = 200_000;

export const isIntType = (t: string) => INT_RE.test(t);
const isUint = (t: string) => INT_RE.test(t) && t.startsWith('u');
const isScalar = (t: string) => t === 'address' || t === 'bool' || isIntType(t);

/** Parse a canonical signature into name + parameter types. Only address, bool and (u)intN parameters are allowed. */
export function parseSpecFn(fn: unknown, where: string): { name: string; types: string[] } {
  if (typeof fn !== 'string') throw new SpecError(`${where}: the function must be a signature string.`);
  const m = FN_RE.exec(fn);
  if (!m) throw new SpecError(`${where}: "${fn}" is not a canonical signature like name(uint256,address).`);
  const types = m[2] ? m[2].split(',') : [];
  for (const t of types) {
    if (!isScalar(t)) throw new SpecError(`${where}: argument type "${t}" is not supported (only address, bool and (u)intN).`);
  }
  return { name: m[1]!, types };
}

const strict = (o: Record<string, unknown>, allowed: string[], where: string) => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new SpecError(`${where}: unknown field "${k}".`);
};

type ArgScope = 'view' | 'index' | 'exit';

function checkArg(a: unknown, type: string, scope: ArgScope, where: string, returns: string[] = []): SpecArg {
  if (typeof a !== 'string') throw new SpecError(`${where}: every argument must be a string placeholder or a decimal literal.`);
  if (type === 'address') {
    if (a !== '$account') throw new SpecError(`${where}: an address argument must be $account (exits never name another address).`);
    return a;
  }
  if (type === 'bool') {
    if (a !== 'true' && a !== 'false') throw new SpecError(`${where}: a bool argument must be true or false.`);
    return a;
  }
  // integers
  if (LITERAL_RE.test(a)) return a;
  if (a === '$id') return a;
  if (a === '$index' && scope === 'index') return a;
  if (scope === 'exit') {
    if (a === '$amount' || a === '$deadline' || a === '$max') return a;
    const m = /^\$min:([0-9])$/.exec(a);
    if (m) {
      const i = Number(m[1]);
      if (i >= returns.length || !isUint(returns[i]!)) throw new SpecError(`${where}: ${a} must refer to an unsigned return value.`);
      return a;
    }
  }
  if (a === '$account') throw new SpecError(`${where}: $account can only fill an address argument.`);
  throw new SpecError(`${where}: unknown placeholder "${a}".`);
}

function parseCall(x: unknown, where: string, scope: 'view' | 'index' = 'view'): SpecCall {
  if (!isObj(x)) throw new SpecError(`${where} must be an object with fn and args.`);
  strict(x, ['fn', 'args'], where);
  const { types } = parseSpecFn(x.fn, where);
  if (!Array.isArray(x.args) || x.args.length !== types.length) {
    throw new SpecError(`${where}: ${String(x.fn)} takes ${types.length} argument(s).`);
  }
  return { fn: x.fn as string, args: x.args.map((a, i) => checkArg(a, types[i]!, scope, `${where} argument ${i}`)) };
}

const topic = (x: unknown, where: string): 1 | 2 | 3 => {
  if (x !== 1 && x !== 2 && x !== 3) throw new SpecError(`${where} must be 1, 2 or 3 (an indexed event topic).`);
  return x;
};

const EVENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)\(([a-z0-9,]*)\)$/;

function parseDiscovery(x: unknown, where: string): SpecDiscovery {
  if (!isObj(x)) throw new SpecError(`${where} must be an object.`);
  switch (x.mode) {
    case 'balance':
      strict(x, ['mode', 'amount'], where);
      return { mode: 'balance', amount: parseCall(x.amount, `${where}.amount`) };
    case 'enumerable': {
      strict(x, ['mode', 'count', 'byIndex', 'amount'], where);
      const byIndex = parseCall(x.byIndex, `${where}.byIndex`, 'index');
      if (!byIndex.args.includes('$index')) throw new SpecError(`${where}.byIndex must take $index.`);
      return {
        mode: 'enumerable',
        count: parseCall(x.count, `${where}.count`),
        byIndex,
        ...(x.amount !== undefined ? { amount: parseCall(x.amount, `${where}.amount`) } : {}),
      };
    }
    case 'logs': {
      strict(x, ['mode', 'event', 'toTopic', 'idTopic', 'owner', 'amount', 'maxBlocks'], where);
      if (typeof x.event !== 'string' || !EVENT_RE.test(x.event)) throw new SpecError(`${where}.event must be a canonical event signature.`);
      const toTopic = topic(x.toTopic, `${where}.toTopic`);
      const idTopic = topic(x.idTopic, `${where}.idTopic`);
      if (toTopic === idTopic) throw new SpecError(`${where}: toTopic and idTopic must differ.`);
      if (typeof x.maxBlocks !== 'number' || !Number.isInteger(x.maxBlocks) || x.maxBlocks < 1 || x.maxBlocks > MAX_LOG_BLOCKS) {
        throw new SpecError(`${where}.maxBlocks must be a whole number from 1 to ${MAX_LOG_BLOCKS}.`);
      }
      const owner = parseCall(x.owner, `${where}.owner`);
      if (!owner.args.includes('$id')) throw new SpecError(`${where}.owner must take $id.`);
      return {
        mode: 'logs',
        event: x.event,
        toTopic,
        idTopic,
        owner,
        maxBlocks: x.maxBlocks,
        ...(x.amount !== undefined ? { amount: parseCall(x.amount, `${where}.amount`) } : {}),
      };
    }
    default:
      throw new SpecError(`${where}: unknown discovery mode "${String(x.mode)}" (balance, enumerable or logs).`);
  }
}

const indexList = (x: unknown, where: string): number[] => {
  if (!Array.isArray(x) || x.some((i) => typeof i !== 'number' || !Number.isInteger(i) || i < 0)) {
    throw new SpecError(`${where} must be a list of argument indexes.`);
  }
  if (new Set(x).size !== x.length) throw new SpecError(`${where} repeats an index.`);
  return x as number[];
};

const KIT_SELECTORS = new Set<string>(Object.values(SEL));

function parseExit(x: unknown, tokenCount: number, where: string): SpecExit {
  if (!isObj(x)) throw new SpecError(`${where} must be an object.`);
  strict(x, ['fn', 'args', 'recipient', 'self', 'paysCaller', 'returns', 'payout'], where);
  const { types } = parseSpecFn(x.fn, where);
  const selector = toFunctionSelector(`function ${x.fn as string}`);
  if (BANNED_SELECTORS.has(selector)) throw new SpecError(`${where}: ${String(x.fn)} is an approval, permit or transfer, which is never an exit.`);
  if (KIT_SELECTORS.has(selector)) throw new SpecError(`${where}: ${String(x.fn)} collides with a selector the kit already decodes.`);

  if (!Array.isArray(x.returns) || x.returns.some((t) => typeof t !== 'string' || !isScalar(t))) {
    throw new SpecError(`${where}.returns must list address, bool or (u)intN types.`);
  }
  const returns = x.returns as string[];
  if (!Array.isArray(x.args) || x.args.length !== types.length) throw new SpecError(`${where}: ${String(x.fn)} takes ${types.length} argument(s).`);
  const args = x.args.map((a, i) => checkArg(a, types[i]!, 'exit', `${where} argument ${i}`, returns));

  const recipient = indexList(x.recipient, `${where}.recipient`);
  const self = x.self === undefined ? [] : indexList(x.self, `${where}.self`);
  if (typeof x.paysCaller !== 'boolean' && x.paysCaller !== undefined) throw new SpecError(`${where}.paysCaller must be true or false.`);
  const paysCaller = x.paysCaller === true;
  for (const i of [...recipient, ...self]) {
    if (i >= types.length || types[i] !== 'address') throw new SpecError(`${where}: argument ${i} is not an address argument.`);
  }
  if (recipient.some((i) => self.includes(i))) throw new SpecError(`${where}: an argument cannot be both recipient and self.`);
  const pinned = new Set([...recipient, ...self]);
  types.forEach((t, i) => {
    if (t === 'address' && !pinned.has(i)) throw new SpecError(`${where}: address argument ${i} must be listed in recipient or self.`);
  });
  if (!recipient.length && !paysCaller) throw new SpecError(`${where}: the exit must pay a recipient argument or the caller.`);

  if (!Array.isArray(x.payout) || x.payout.length === 0) throw new SpecError(`${where}.payout must map at least one return value to a token.`);
  const payout = x.payout.map((p, j) => {
    if (!isObj(p)) throw new SpecError(`${where}.payout[${j}] must be {token, ret}.`);
    strict(p, ['token', 'ret'], `${where}.payout[${j}]`);
    const token = p.token;
    const ret = p.ret;
    if (typeof token !== 'number' || !Number.isInteger(token) || token < 0 || token >= tokenCount) throw new SpecError(`${where}.payout[${j}].token is not a token index.`);
    if (typeof ret !== 'number' || !Number.isInteger(ret) || ret < 0 || ret >= returns.length || !isUint(returns[ret]!)) {
      throw new SpecError(`${where}.payout[${j}].ret must refer to an unsigned return value.`);
    }
    return { token, ret };
  });
  if (new Set(payout.map((p) => p.token)).size !== payout.length) throw new SpecError(`${where}.payout lists a token twice.`);
  return { fn: x.fn as string, args, recipient, self, paysCaller, returns, payout };
}

function parseKind(x: unknown, where: string): ExitKind {
  if (!isObj(x)) throw new SpecError(`${where} must be an object.`);
  strict(x, ['label', 'discover', 'tokens', 'exit'], where);
  if (typeof x.label !== 'string' || !x.label.trim() || x.label.length > 64) throw new SpecError(`${where}.label must be 1–64 characters.`);
  if (!Array.isArray(x.tokens) || x.tokens.length < 1 || x.tokens.length > 4) throw new SpecError(`${where}.tokens must list 1–4 view calls.`);
  const tokens = x.tokens.map((t, i) => parseCall(t, `${where}.tokens[${i}]`));
  return { label: x.label, discover: parseDiscovery(x.discover, `${where}.discover`), tokens, exit: parseExit(x.exit, tokens.length, `${where}.exit`) };
}

/** Validate a decoded object (from JSON or a config file). */
export function validateExitSpec(raw: unknown): ExitSpec {
  if (!isObj(raw)) throw new SpecError('The exit spec is not an object.');
  strict(raw, ['v', 'kinds'], 'The exit spec');
  if (raw.v !== EXIT_SPEC_VERSION) throw new SpecError(`The exit spec has an unsupported version (${String(raw.v)}).`);
  if (!isObj(raw.kinds) || Object.keys(raw.kinds).length === 0) throw new SpecError('The exit spec lists no kinds.');
  const kinds: Record<string, ExitKind> = {};
  for (const [name, k] of Object.entries(raw.kinds)) {
    if (!KIND_RE.test(name)) throw new SpecError(`"${name}" is not a valid kind name (letters, digits, - and _, up to 32).`);
    kinds[name] = parseKind(k, `kind ${name}`);
  }
  return { v: 1, kinds };
}

/** Parse the org.copeybara.exits text record. Empty → null (no spec published). */
export function parseExitSpec(text: string): ExitSpec | null {
  if (!text || !text.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SpecError('The exit spec record is not valid JSON.');
  }
  return validateExitSpec(raw);
}

const canonical = (x: unknown): unknown =>
  Array.isArray(x) ? x.map(canonical) : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;

/** Stable wire form (sorted keys), after validation. */
export function encodeExitSpec(s: ExitSpec): string {
  return JSON.stringify(canonical(validateExitSpec(s)));
}

export const specExitSelector = (k: ExitKind): Hex => toFunctionSelector(`function ${k.exit.fn}`);

/** ERC-4626 vault shares: redeem every share to the account, which is also the share owner. */
export function erc4626Kind(label: string): ExitKind {
  return {
    label,
    discover: { mode: 'balance', amount: { fn: 'balanceOf(address)', args: ['$account'] } },
    tokens: [{ fn: 'asset()', args: [] }],
    exit: {
      fn: 'redeem(uint256,address,address)',
      args: ['$amount', '$account', '$account'],
      recipient: [1],
      self: [2],
      paysCaller: false,
      returns: ['uint256'],
      payout: [{ token: 0, ret: 0 }],
    },
  };
}

/**
 * Cross-check spec ↔ manifest: every `spec` role on every chain needs a kind whose exit selector is the role's only
 * allowed selector. Returns plain problems; an empty list means consistent.
 */
export function checkSpecAgainstManifest(spec: ExitSpec | null, m: Manifest): string[] {
  const problems: string[] = [];
  for (const [chainId, cm] of Object.entries(m.chains)) {
    for (const [role, t] of Object.entries(cm.spec ?? {})) {
      const k = spec?.kinds[role];
      if (!k) {
        problems.push(`The manifest lists spec role "${role}" on chain ${chainId}, but the exit spec has no kind "${role}".`);
        continue;
      }
      const sel = specExitSelector(k);
      if (t.selectors.length !== 1 || t.selectors[0]!.toLowerCase() !== sel) {
        problems.push(`spec role "${role}" on chain ${chainId} must allow exactly ${sel} (${k.exit.fn}).`);
      }
    }
  }
  return problems;
}
