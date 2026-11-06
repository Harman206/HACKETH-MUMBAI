import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function repoRoot(from = process.cwd()): string {
  let d = resolve(from);
  while (!existsSync(join(d, 'pnpm-workspace.yaml'))) {
    const up = dirname(d);
    if (up === d) throw new Error('run copeybara adapter new inside the Copeybara monorepo (no pnpm-workspace.yaml found)');
    d = up;
  }
  return d;
}

export function adapterFiles(name: string): Record<string, string> {
  const v = camel(name);
  return {
    [`packages/adapters/src/${name}.ts`]: `import { encodeFunctionData } from 'viem';
import type { ExitPlan, Position } from '@copeybara/core';
import { applySlippage, target, type Ctx, type ExitAdapter } from './types';

// 1. Add '${name}' to AdapterId / ADAPTER_IDS (packages/core/src/types.ts) and its roles + exit selectors to
//    EXIT_SELECTORS (packages/core/src/sigs.ts).
// 2. Teach the Guard to decode those selectors and name every recipient (packages/guard/src/decode.ts). A call the
//    Guard cannot decode must stay a DECODE reject: never add a pass-through.
// 3. Add ${v} to ADAPTERS (packages/adapters/src/index.ts), then flip IMPLEMENTED in the generated tests.
// Addresses only ever come from target(ctx, '${name}', role); reads only through ctx.q at ctx.block.

export const ${v}: ExitAdapter = {
  id: '${name}' as ExitAdapter['id'],

  async discover(user, ctx): Promise<Position[]> {
    const t = target(ctx, '${name}' as ExitAdapter['id'], 'pool');
    if (!t) return [];
    void user;
    return [];
  },

  async buildExit(pos, ctx: Ctx): Promise<ExitPlan> {
    if (pos.manual) return { position: pos, calls: [], expected: [] };
    const t = target(ctx, '${name}' as ExitAdapter['id'], 'pool');
    if (!t) throw new Error('${name} is not listed in the manifest for chain ' + ctx.chainId);
    void encodeFunctionData;
    void applySlippage;
    // Simulate the exit through ctx.q.call (from ctx.account), read the payout, set min = applySlippage(payout).
    return { position: pos, calls: [], expected: [] };
  },
};
`,
    [`packages/adapters/test/${name}.fork.test.ts`]: `import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFork, ANVIL_ACCOUNTS, type Fork } from '@copeybara/testkit';
import { createQuorum } from '@copeybara/quorum';
import { runExit } from '@copeybara/exec';
import { ${v} } from '../src/${name}';

const IMPLEMENTED = false; // flip once ${name} discovers and exits real positions

describe.skipIf(!IMPLEMENTED)('${name} on a fork', () => {
  let fork: Fork;
  beforeAll(async () => {
    fork = await startFork({ chainId: 1 });
    // Seed: give ANVIL_ACCOUNTS[1] a ${name} position (deposit through the protocol, or setStorageAt).
  }, 120_000);
  afterAll(() => fork?.stop());

  test('discovers the seeded position and exits it: Recovered', async () => {
    const user = ANVIL_ACCOUNTS[1]!;
    const q = createQuorum({ urls: [fork.url, fork.url, fork.url], expectedChainId: 1 });
    const ctx = { q, chainId: 1, manifest: { v: 1 as const, chains: {} }, block: await q.pinBlock(), account: user, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
    const [pos] = await ${v}.discover(user, ctx);
    expect(pos).toBeDefined();
    const plan = await ${v}.buildExit(pos!, ctx);
    const r = await runExit(plan, { sendTransaction: (tx) => fork.wallet(tx.from).sendTransaction({ account: tx.from, chain: fork.chain, to: tx.to, data: tx.data }) }, ctx);
    expect(r.status).toBe('recovered');
  }, 120_000);
});
`,
    [`packages/guard/test/${name}.corpus.test.ts`]: `import { describe, expect, test } from 'vitest';
import type { TxRequest } from '@copeybara/core';
import { guard } from '../src';
import { USER } from './helpers';

const IMPLEMENTED = false; // flip once the Guard decodes ${name}

/** Fill these with real ${name} calldata: each must be rejected for the stated reason. */
const BANNED: { name: string; tx: TxRequest; code: string }[] = [
  // { name: 'pays someone else', tx: …, code: 'RECIPIENT' },
  // { name: 'extra approve', tx: …, code: 'BANNED' },
  // { name: 'value > 0', tx: …, code: 'VALUE' },
  // { name: 'unknown function on the ${name} contract', tx: …, code: 'DECODE' },
];

describe.skipIf(!IMPLEMENTED)('${name}: Guard corpus', () => {
  test.each(BANNED.map((c) => [c.name, c] as const))('rejects: %s', (_n, c) => {
    const r = guard(c.tx, { account: USER, chainId: 1, manifest: { v: 1, chains: {} } });
    expect(r.ok).toBe(false);
    expect(r.reasons.map((x) => x.code)).toContain(c.code);
  });
});
`,
    [`packages/guard/test/${name}.property.test.ts`]: `import { describe, test } from 'vitest';
import fc from 'fast-check';

const IMPLEMENTED = false;
const RUNS = 10_000;

describe.skipIf(!IMPLEMENTED)('${name}: Guard properties', () => {
  test('passes iff every recipient is the user and value is 0', () => {
    fc.assert(fc.property(fc.boolean(), () => true), { numRuns: RUNS });
  });
  test('random calldata to the ${name} contract never passes unless it decodes to a valid exit', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 256 }), () => true), { numRuns: RUNS });
  });
});
`,
  };
}

export async function adapterNew(name: string, root = repoRoot()) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(name)) throw new Error('adapter names are lowercase, e.g. morpho-blue');
  const files = adapterFiles(name);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    if (existsSync(p)) throw new Error(`${rel} already exists`);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
    process.stdout.write(`wrote ${rel}\n`);
  }
  process.stdout.write(`\nNext: follow the numbered steps at the top of packages/adapters/src/${name}.ts.\nPrefer the declarative spec (exits in copeybara.config.ts) when your exit is one call with address/uint/bool arguments.\n`);
}
