/**
 * The fire drill a protocol runs before it publishes: fork the chain, put its records on the fork (written as the
 * Safe, by impersonation: no keys), seed a user position, switch the website and the primary RPC off, then let the
 * kit's own code (records → adapters → Exit Guard → simulate → send → receipt → balance delta) take the user out.
 */
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, getAddress, parseAbi, parseEther, type Abi, type Hex } from 'viem';
import { COPEYBARA_KEYS, erc4626Kind, type Address, type Position, type TxRequest } from '@copeybara/core';
import { readCopeybaraRecords } from '@copeybara/ens';
import { ADAPTERS, type Ctx } from '@copeybara/adapters';
import { runExit, type ExitResult } from '@copeybara/exec';
import { createQuorum } from '@copeybara/quorum';
import { ANVIL_ACCOUNTS, startFork, type Fork } from '@copeybara/testkit';
import { ensChainId, fromConfig, universalResolver, type CopeybaraConfig, type LoadedConfig } from './config';
import { buildManifest } from './manifest';
import { kitRelease } from './release';
import { resolverAbi, dnsName } from './resolver';

type ForkChain = 1 | 11155111;

export interface DrillReport {
  pass: boolean;
  at: string;
  name: string;
  chainId: number;
  kitSha256: string | null;
  siteOff: boolean;
  primaryRpcOff: boolean;
  positions: { id: string; label: string; manual?: string }[];
  results: { positionId: string; status: ExitResult['status']; reasons: string[]; txHashes: Hex[]; deltas: { token: Address; before: string; after: string; min: string }[] }[];
  /** Extra assertions a drill made (e.g. a paused vault is manual, never sent). */
  checks: { name: string; pass: boolean; detail: string }[];
}

/** A JSON-RPC pass-through that can be switched off, standing in for one RPC provider. */
async function rpcProxy(target: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try {
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks) });
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(await r.text());
    } catch {
      res.writeHead(502).end();
    }
  });
  return listen(server);
}

async function listen(server: Server): Promise<{ url: string; close: () => Promise<void> }> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

const reachable = (url: string) => fetch(url, { method: 'POST', body: '{}', signal: AbortSignal.timeout(1500) }).then(() => true, () => false);

/** Run calls as `from` on a fork without its key (anvil impersonation). Test forks only. */
async function sendAs(f: Fork, from: Address, to: Address, data: Hex) {
  await f.testClient.impersonateAccount({ address: from });
  await f.testClient.setBalance({ address: from, value: parseEther('10') });
  const hash = await f.wallet(from).sendTransaction({ account: from, chain: f.chain, to, data });
  const r = await f.publicClient.waitForTransactionReceipt({ hash });
  await f.testClient.stopImpersonatingAccount({ address: from });
  if (r.status !== 'success') throw new Error(`fork call from ${from} to ${to} reverted`);
}

export interface DrillInput {
  name: string;
  safe: Address;
  resolver: Address;
  universalResolver: Address;
  ensChainId: ForkChain;
  exitChainId: ForkChain;
  /** Record values to publish on the fork (manifest, exits, …), written by the Safe. */
  records: Record<string, string>;
  /** Make the user hold positions on the exit-chain fork. Returns extra checks to run after the exit. */
  seed: (f: Fork, user: Address) => Promise<((f: Fork, user: Address, ctx: Ctx) => Promise<DrillReport['checks']>) | void>;
  kitSha256: string | null;
  user?: Address;
  log?: (s: string) => void;
  /** What to fork, per chain (default: the public FORK_RPCS). A protocol's config `rpcs` go here. */
  forkUrls?: Partial<Record<ForkChain, string>>;
}

export async function runDrill(i: DrillInput): Promise<DrillReport> {
  const log = i.log ?? (() => {});
  const user = i.user ?? ANVIL_ACCOUNTS[1]!;
  const ensFork = await startFork({ chainId: i.ensChainId, forkUrl: i.forkUrls?.[i.ensChainId] });
  const exitFork = i.exitChainId === i.ensChainId ? ensFork : await startFork({ chainId: i.exitChainId, forkUrl: i.forkUrls?.[i.exitChainId] });
  const closers: (() => Promise<void>)[] = [];
  try {
    log(`forks up: ENS chain ${i.ensChainId}${exitFork !== ensFork ? `, exits chain ${i.exitChainId}` : ''}`);
    const after = await i.seed(exitFork, user);
    log(`seeded positions for ${user}`);

    const code = await ensFork.publicClient.getCode({ address: i.resolver });
    if (!code || code === '0x') throw new Error(`the resolver ${i.resolver} has no code on the forked chain: set rpcs["${i.ensChainId}"] in the config to a node that has ${i.name}.`);
    const site = await listen(createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>protocol site</title>')));
    closers.push(site.close);
    for (const [key, value] of Object.entries({ ...i.records, url: site.url })) {
      await sendAs(ensFork, i.safe, i.resolver, encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsName(i.name), key, value] }));
    }
    log(`records written on the fork by the Safe ${i.safe} (impersonated): ${Object.keys(i.records).join(', ')}, url`);

    const proxies = async (f: Fork) => Promise.all([rpcProxy(f.url), rpcProxy(f.url), rpcProxy(f.url)]);
    const ensRpcs = await proxies(ensFork);
    const exitRpcs = exitFork === ensFork ? ensRpcs : await proxies(exitFork);
    closers.push(...ensRpcs.map((p) => p.close), ...(exitRpcs === ensRpcs ? [] : exitRpcs.map((p) => p.close)));

    await site.close();
    await ensRpcs[0]!.close();
    if (exitRpcs !== ensRpcs) await exitRpcs[0]!.close();
    const siteOff = !(await reachable(site.url));
    const primaryRpcOff = !(await reachable(ensRpcs[0]!.url)) && !(await reachable(exitRpcs[0]!.url));
    log(`website ${siteOff ? 'OFF' : 'still up!'} · primary RPC ${primaryRpcOff ? 'OFF' : 'still up!'}`);

    const ensQ = createQuorum({ urls: ensRpcs.map((p) => p.url), expectedChainId: i.ensChainId, timeoutMs: 5000 });
    const records = await readCopeybaraRecords(i.name, ensQ, { universalResolver: i.universalResolver });
    if (records.problems.length) throw new Error(`the kit reads problems in the records: ${records.problems.map((p) => p.message).join('; ')}`);
    const q = exitFork === ensFork ? ensQ : createQuorum({ urls: exitRpcs.map((p) => p.url), expectedChainId: i.exitChainId, timeoutMs: 5000 });
    const block = await q.pinBlock();
    const ctx: Ctx = { q, chainId: i.exitChainId, manifest: records.manifest, exitSpec: records.exitSpec ?? null, block, account: user, slippageBps: 50, nowSec: () => Math.floor(Date.now() / 1000) };
    const positions: Position[] = (await Promise.all(ADAPTERS.map((a) => a.discover(user, ctx)))).flat();
    log(`kit found ${positions.length} position(s): ${positions.map((p) => p.label).join(', ')}`);

    const sender = {
      sendTransaction: async (tx: TxRequest) => {
        await exitFork.testClient.impersonateAccount({ address: tx.from });
        return exitFork.wallet(tx.from).sendTransaction({ account: tx.from, chain: exitFork.chain, to: tx.to, data: tx.data, value: tx.value });
      },
    };
    const results: DrillReport['results'] = [];
    for (const p of positions.filter((p) => !p.manual)) {
      const a = ADAPTERS.find((x) => x.id === p.adapter)!;
      const fresh = { ...ctx, block: await q.pinBlock() };
      const plan = await a.buildExit(p, fresh);
      const r = await runExit(plan, sender, { ...fresh, pollMs: 100, timeoutMs: 30_000 });
      log(`exit ${p.label}: ${r.status}${r.reasons.length ? ` (${r.reasons.join('; ')})` : ''}`);
      results.push({
        positionId: r.positionId,
        status: r.status,
        reasons: r.reasons,
        txHashes: r.txHashes,
        deltas: r.deltas.map((d) => ({ token: d.token, before: d.before.toString(), after: d.after.toString(), min: d.min.toString() })),
      });
    }
    const checks = after ? await after(exitFork, user, { ...ctx, block: await q.pinBlock() }) : [];
    for (const c of checks) log(`${c.pass ? '✓' : '✗'} ${c.name}: ${c.detail}`);
    const pass = siteOff && primaryRpcOff && results.length > 0 && results.every((r) => r.status === 'recovered') && checks.every((c) => c.pass);
    return {
      pass,
      at: new Date().toISOString(),
      name: i.name,
      chainId: i.exitChainId,
      kitSha256: i.kitSha256,
      siteOff,
      primaryRpcOff,
      positions: positions.map((p) => ({ id: p.id, label: p.label, ...(p.manual ? { manual: p.manual } : {}) })),
      results,
      checks,
    };
  } finally {
    for (const c of closers) await c().catch(() => {});
    await ensFork.stop();
    if (exitFork !== ensFork) await exitFork.stop();
  }
}

const fixture = (n: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/sample/${n}.json`, import.meta.url)), 'utf8')) as { abi: Abi; bytecode: Hex };
const SAMPLE_DEPLOYMENT = JSON.parse(readFileSync(fileURLToPath(new URL('../../../contracts/deployments/sepolia.json', import.meta.url)), 'utf8')) as { name: string; safe: Address; resolver: Address; webKey: Address };

async function deploy(f: Fork, from: Address, n: string, args: unknown[]): Promise<Address> {
  const { abi, bytecode } = fixture(n);
  const hash = await f.wallet(from).deployContract({ account: from, chain: f.chain, abi, bytecode, args });
  const r = await f.publicClient.waitForTransactionReceipt({ hash });
  return getAddress(r.contractAddress!);
}

const erc20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)']);
const vaultAbi = parseAbi(['function deposit(uint256,address) returns (uint256)', 'function setPaused(bool)', 'function asset() view returns (address)']);

/** `copeybara drill`: the sample protocol with --sample, otherwise the config's own chain and seed hook. */
export async function drillCmd(l: LoadedConfig | null, o: { write?: (f: string, b: string) => Promise<string>; sample?: boolean }) {
  const log = (s: string) => process.stdout.write(`  ${s}\n`);
  let report: DrillReport;
  if (o.sample || !l) {
    process.stdout.write('copeybara drill --sample: ERC-4626 vault described only by the declarative exit spec\n');
    report = await sampleDrillReport(erc4626Kind('Sample vault'), log);
  } else {
    report = await configDrill(l, log);
  }
  const body = JSON.stringify(report, null, 2);
  if (o.write) process.stdout.write(`report → ${await o.write('drill.json', body)}\n`);
  process.stdout.write(report.pass ? 'drill: RECOVERED with the website and primary RPC off\n' : 'drill: FAILED\n');
  if (!report.pass) process.exitCode = 1;
  return report;
}

/**
 * The sample protocol: an ERC-4626 vault on a Sepolia fork, described to the kit ONLY by an exit spec under the demo
 * name, with its records built by the same manifest builder protocols use. Two users: one exits (must be Recovered),
 * one hits a paused vault (must be manual, nothing sent).
 */
export async function sampleDrillReport(kind = erc4626Kind('Sample vault'), log?: (s: string) => void, kitSha256: string | null = null): Promise<DrillReport> {
  const deployer = ANVIL_ACCOUNTS[0]!;
  const second = ANVIL_ACCOUNTS[2]!;
  let vault: Address | null = null;
  const base: Omit<DrillInput, 'records' | 'seed'> = {
    name: SAMPLE_DEPLOYMENT.name,
    safe: SAMPLE_DEPLOYMENT.safe,
    resolver: SAMPLE_DEPLOYMENT.resolver,
    universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',
    ensChainId: 11155111,
    exitChainId: 11155111,
    kitSha256,
    log,
  };
  const records: Record<string, string> = {};
  return runDrill({
    ...base,
    records,
    seed: async (f, user) => {
      const send = async (from: Address, to: Address, data: Hex) => {
        const h = await f.wallet(from).sendTransaction({ account: from, chain: f.chain, to, data });
        const r = await f.publicClient.waitForTransactionReceipt({ hash: h });
        if (r.status !== 'success') throw new Error('seed tx reverted');
      };
      const token = await deploy(f, deployer, 'DemoToken', ['Sample USD', 'sUSD', parseEther('1000000'), deployer]);
      vault = await deploy(f, deployer, 'SampleVault', [token]);
      for (const holder of [user, second]) {
        await send(deployer, token, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [holder, parseEther('1000')] }));
        await send(holder, token, encodeFunctionData({ abi: erc20, functionName: 'approve', args: [vault, parseEther('1000')] }));
        await send(holder, vault, encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [parseEther('1000'), holder] }));
      }
      await send(deployer, token, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [vault, parseEther('100')] }));
      const b = await buildManifest({
        dir: process.cwd(),
        cfg: {
          name: SAMPLE_DEPLOYMENT.name,
          safe: SAMPLE_DEPLOYMENT.safe,
          resolver: SAMPLE_DEPLOYMENT.resolver,
          websiteKey: SAMPLE_DEPLOYMENT.webKey,
          kit: { file: 'unused', version: 1 },
          chains: { '11155111': { spec: { vault: { address: vault, functions: ['redeem(uint256,address,address)'], abi: fileURLToPath(new URL('../fixtures/sample/SampleVault.json', import.meta.url)) } } } },
          exits: { vault: kind },
        },
      });
      if (b.problems.length) throw new Error(`sample manifest: ${b.problems.join('; ')}`);
      records[COPEYBARA_KEYS.manifest] = b.text;
      records[COPEYBARA_KEYS.exits] = b.specText;
      return async (_fork, _user, ctx) => {
        await send(deployer, vault!, encodeFunctionData({ abi: vaultAbi, functionName: 'setPaused', args: [true] }));
        const c2: Ctx = { ...ctx, account: second, block: await ctx.q.pinBlock() };
        const spec = ADAPTERS.find((a) => a.id === 'spec')!;
        const [pos] = await spec.discover(second, c2);
        const plan = pos ? await spec.buildExit(pos, c2) : null;
        return [{ name: 'a paused vault is manual, never sent', pass: !!plan && plan.calls.length === 0 && !!plan.position.manual, detail: plan?.position.manual ?? 'no position found' }];
      };
    },
  });
}

/** Drill for a protocol's own config: needs `drill.seed` to give the user a position on a fork. */
async function configDrill(l: LoadedConfig, log: (s: string) => void): Promise<DrillReport> {
  const { cfg } = l;
  const d = cfg.drill;
  if (!d?.seed) throw new Error('copeybara drill needs drill: { chainId, seed } in the config (or run copeybara drill --sample).');
  const chainIds = Object.keys(cfg.chains).map(Number);
  const exitChainId = (d.chainId ?? chainIds[0]) as ForkChain;
  const ens = ensChainId(cfg) as ForkChain;
  if (![1, 11155111].includes(exitChainId) || ![1, 11155111].includes(ens)) throw new Error('drill forks chain 1 or 11155111');
  const b = await buildManifest(l);
  if (b.problems.length) throw new Error(`manifest: ${b.problems.join('; ')}`);
  let kitSha256: string | null = null;
  try {
    kitSha256 = (await kitRelease(fromConfig(l, cfg.kit.file), cfg.kit.version)).sha256;
  } catch {
    kitSha256 = null;
  }
  return runDrill({
    name: cfg.name,
    safe: cfg.safe,
    resolver: cfg.resolver,
    universalResolver: universalResolver(cfg),
    ensChainId: ens,
    exitChainId,
    kitSha256,
    log,
    records: { [COPEYBARA_KEYS.manifest]: b.text, ...(b.specText ? { [COPEYBARA_KEYS.exits]: b.specText } : {}) },
    seed: async (f, user) => {
      await d.seed!({ fork: f, user });
    },
    user: d.user,
    forkUrls: Object.fromEntries([ens, exitChainId].flatMap((c) => (cfg.rpcs?.[String(c)]?.[0] ? [[c, cfg.rpcs[String(c)]![0]]] : []))),
  });
}

export type DrillSeed = (o: { fork: Fork; user: Address }) => Promise<void>;
export type { CopeybaraConfig };
