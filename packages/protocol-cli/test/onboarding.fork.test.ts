/**
 * The whole protocol onboarding of docs/protocol-integration.md, on an anvil fork of Sepolia, as a new team runs it:
 * a fresh SampleVault + a user deposit, a fresh ENSv2 name owned by a 2-of-3 Safe (contracts/script/SetupName.s.sol),
 * then the real `copeybara` CLI in the team's own directory (outside the workspace):
 *   init → manifest --onchain → release → fingerprint (a real `vite build` with @copeybara/vite-plugin) → propose →
 *   2-of-3 Safe executes the batch → verify → roles-check → drill → certify → incident (+ blocklist) → watcher.
 * Then the platform consumes it: the kit's own flow finds and exits the vault position, and the Guard classifies
 * the kit's redeem as an exit the way the extension does (manifest + exit spec of a followed name).
 *
 * Needs anvil + forge (~/.foundry/bin) and network access to fork Sepolia. Anvil default keys only, fork only.
 */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, getAddress, parseAbi, parseEther, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Position, TxRequest } from '@copeybara/core';
import { ADAPTERS } from '@copeybara/adapters';
import { readCopeybaraRecords } from '@copeybara/ens';
import { classifyRequest } from '@copeybara/guard';
import { createQuorum } from '@copeybara/quorum';
import { startFork, type Fork } from '@copeybara/testkit';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BIN = join(REPO, 'packages/protocol-cli/bin/copeybara.mjs');
const CONTRACTS = join(REPO, 'contracts');
const FORGE = existsSync(`${homedir()}/.foundry/bin/forge`) ? `${homedir()}/.foundry/bin/forge` : 'forge';
const UR: Address = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const REGISTRAR: Address = '0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3';

// anvil default keys (public test keys): 0 deployer + Safe owner, 1-2 Safe owners, 3 website key, 5 user, 9 watcher
const K = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  owner1: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  owner2: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  web: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  user: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  watcher: '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
} as const;
const addr = (k: Hex) => privateKeyToAccount(k).address;
const USER = addr(K.user);

/** The parts of apps/kit/src/flow.ts this test drives (imported at run time: the kit is another TS project). */
interface KitFlowDeps {
  quorumFor(chainId: number): ReturnType<typeof createQuorum>;
  ens: { chainId: number; universalResolver: Address };
  adapters: typeof ADAPTERS;
  wallet: { connect(): Promise<{ account: Address; chainId: number }>; ensureChain(c: number): Promise<void>; sender(a: Address): { sendTransaction(tx: TxRequest): Promise<Hex> } };
  now(): number;
}
type KitState = { step: 'positions'; positions: Position[]; results: Record<string, { status: string }> } | { step: string };
interface KitFlow {
  state: { get(): KitState };
  start(s: { ensName: string; targetChainId: number; userRpcs: Record<string, string[]>; slippageBps: number; useDefaultRpcs: boolean; drillUrl: string }): Promise<void>;
  exit(id: string): Promise<void>;
}

let fork: Fork;
let dir: string;
let rpcs: string[];
let name: string;
let safe: Address;
let resolver: Address;
let vault: Address;
let token: Address;

/** The real CLI, in the protocol's directory. */
function cli(...args: string[]): Promise<{ status: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN, ...args], { cwd: dir });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (status) => resolve({ status: status ?? 1, out }));
  });
}

const fixture = (n: string) => JSON.parse(readFileSync(join(REPO, `packages/protocol-cli/fixtures/sample/${n}.json`), 'utf8')) as { abi: Abi; bytecode: Hex };

async function send(from: Address, to: Address, data: Hex) {
  const hash = await fork.wallet(from).sendTransaction({ account: from, chain: fork.chain, to, data });
  const r = await fork.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`reverted: ${to} ${data.slice(0, 10)}`);
  return r;
}

async function deploy(n: string, args: unknown[]): Promise<Address> {
  const from = addr(K.deployer);
  const { abi, bytecode } = fixture(n);
  const hash = await fork.wallet(from).deployContract({ account: from, chain: fork.chain, abi, bytecode, args });
  return getAddress((await fork.publicClient.waitForTransactionReceipt({ hash })).contractAddress!);
}

const safeAbi = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)',
]);
const ZERO = '0x0000000000000000000000000000000000000000';

/** What two Safe owners do with the CLI's safe-tx.json: check the hash on chain, sign it on their own devices, execute. */
async function executeAsSafe(file: string) {
  const t = JSON.parse(readFileSync(join(dir, '.copeybara', file), 'utf8')) as { safe: Address; to: Address; data: Hex; operation: number; nonce: string; safeTxHash: Hex };
  const onchain = await fork.publicClient.readContract({ address: t.safe, abi: safeAbi, functionName: 'getTransactionHash', args: [t.to, 0n, t.data, t.operation, 0n, 0n, 0n, ZERO, ZERO, BigInt(t.nonce)] });
  expect(onchain).toBe(t.safeTxHash);
  const signers = [K.owner1, K.owner2].map((k) => privateKeyToAccount(k)).sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));
  const sigs = (await Promise.all(signers.map((s) => s.sign({ hash: t.safeTxHash })))).map((s) => s.slice(2)).join('');
  await send(addr(K.owner1), t.safe, encodeFunctionData({ abi: safeAbi, functionName: 'execTransaction', args: [t.to, 0n, t.data, t.operation, 0n, 0n, 0n, ZERO, ZERO, `0x${sigs}`] }));
}

beforeAll(async () => {
  fork = await startFork({ chainId: 11155111 });
  const port = new URL(fork.url).port;
  rpcs = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://127.0.0.1:${port}/`];

  // The protocol's contracts and a user who deposited.
  token = await deploy('DemoToken', ['Sample USD', 'sUSD', parseEther('1000000'), addr(K.deployer)]);
  vault = await deploy('SampleVault', [token]);
  const erc20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function approve(address,uint256) returns (bool)']);
  await send(addr(K.deployer), token, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [USER, parseEther('1000')] }));
  await fork.testClient.setBalance({ address: USER, value: parseEther('10') });
  await send(USER, token, encodeFunctionData({ abi: erc20, functionName: 'approve', args: [vault, parseEther('1000')] }));
  await send(USER, vault, encodeFunctionData({ abi: parseAbi(['function deposit(uint256,address) returns (uint256)']), functionName: 'deposit', args: [parseEther('1000'), USER] }));
  await send(addr(K.deployer), token, encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [vault, parseEther('50')] })); // yield

  // "You need: an ENSv2 name on Sepolia owned by your Safe (2-of-3) with a PermissionedResolver (SetupName.s.sol)."
  const available = (label: string) => fork.publicClient.readContract({ address: REGISTRAR, abi: parseAbi(['function isAvailable(string) view returns (bool)']), functionName: 'isAvailable', args: [label] });
  const label = (await available('samplevault')) ? 'samplevault' : `samplevault-${Date.now()}`;
  name = `${label}.eth`;
  const deployments = `deployments/rehearsal-onboarding-${Date.now()}.json`;
  writeFileSync(join(CONTRACTS, 'deployments', 'rehearsal-onboarding-placeholder-manifest.json'), '{"v":1,"c":{}}');
  const env = {
    ...process.env,
    DEPLOYER_KEY: K.deployer,
    OWNER_KEY_1: K.owner1,
    OWNER_KEY_2: K.owner2,
    OWNER_KEY_3: K.deployer,
    WEB_KEY_ADDR: addr(K.web),
    LABEL: label,
    SITE_URL: 'http://samplevault.localhost',
    RELEASE: `sha256:${'0'.repeat(64)};v=1`,
    MANIFEST_FILE: 'deployments/rehearsal-onboarding-placeholder-manifest.json',
    DEPLOYMENTS_FILE: deployments,
  };
  const forge = (sig: string) => execFileSync(FORGE, ['script', 'script/SetupName.s.sol', '--sig', sig, '--rpc-url', fork.url, '--broadcast'], { cwd: CONTRACTS, env, stdio: 'pipe' });
  forge('commit()');
  await fork.testClient.increaseTime({ seconds: 61 });
  await fork.testClient.mine({ blocks: 1 });
  forge('finish()');
  const setup = JSON.parse(readFileSync(join(CONTRACTS, deployments), 'utf8')) as { safe: Address; resolver: Address };
  rmSync(join(CONTRACTS, deployments));
  ({ safe, resolver } = setup);

  // The protocol's own directory, outside the workspace: kit, ABI, a tiny Vite site.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'samplevault-')));
  const kit = join(REPO, 'apps/kit/dist/copeybara-kit.html');
  if (!existsSync(kit)) execFileSync('pnpm', ['--filter', '@copeybara/kit', 'build'], { cwd: REPO, env: { ...process.env, SOURCE_DATE_EPOCH: '0' }, stdio: 'pipe' });
  copyFileSync(kit, join(dir, 'copeybara-kit.html'));
  writeFileSync(join(dir, 'SampleVault.json'), JSON.stringify({ abi: fixture('SampleVault').abi }));
}, 600_000);

afterAll(async () => {
  await fork?.stop();
  rmSync(join(CONTRACTS, 'deployments', 'rehearsal-onboarding-placeholder-manifest.json'), { force: true });
});

test('a new protocol onboards on a Sepolia fork with the documented commands, and the kit exits its vault', async () => {
  // 0. init writes a config to fill in.
  expect((await cli('init')).status).toBe(0);
  const template = readFileSync(join(dir, 'copeybara.config.ts'), 'utf8');
  expect(template).toContain("erc4626Kind('Your vault')");

  // 1. Describe the protocol.
  writeFileSync(
    join(dir, 'copeybara.config.ts'),
    `import { defineConfig } from '@copeybara/protocol-cli';
import { erc4626Kind } from '@copeybara/core';

export default defineConfig({
  name: '${name}',
  safe: '${safe}',
  resolver: '${resolver}',
  websiteKey: '${addr(K.web)}',
  watcher: { key: '${addr(K.watcher)}', candidates: ['http://samplevault-rewards.localhost'] },
  rpcs: { '11155111': ${JSON.stringify(rpcs)} },
  kit: { file: 'copeybara-kit.html', version: 1 },
  site: { url: 'http://samplevault.localhost', dist: 'site/dist' },
  chains: {
    '11155111': { spec: { vault: { address: '${vault}', functions: ['redeem(uint256,address,address)'], abi: 'SampleVault.json' } } },
  },
  exits: { vault: erc4626Kind('Sample vault') },
  drill: { chainId: 11155111, user: '${USER}', seed: async () => {} },
});
`,
  );

  // 2. Build the records.
  let r = await cli('manifest', '--onchain');
  expect(r.out).toContain('org.copeybara.exits →');
  expect(r.status).toBe(0);
  r = await cli('release');
  expect(r.status).toBe(0);
  const kitSha = /sha256:([0-9a-f]{64})/.exec(r.out)![1]!;

  // A real `vite build` with @copeybara/vite-plugin and the widget, then copeybara fingerprint.
  const site = join(dir, 'site');
  mkdirSync(join(site, 'node_modules', '@copeybara'), { recursive: true });
  mkdirSync(join(site, 'src'));
  mkdirSync(join(site, 'public'));
  const vitePkg = dirname(createRequire(join(REPO, 'packages/vite-plugin/package.json')).resolve('vite/package.json'));
  symlinkSync(join(REPO, 'packages/vite-plugin'), join(site, 'node_modules', '@copeybara', 'vite-plugin'));
  symlinkSync(vitePkg, join(site, 'node_modules', 'vite'));
  writeFileSync(join(site, 'package.json'), '{"name":"samplevault-site","private":true,"type":"module"}');
  copyFileSync(join(REPO, 'packages/widget/copeybara-exit.js'), join(site, 'public', 'copeybara-exit.js'));
  writeFileSync(join(site, 'src', 'main.js'), 'document.getElementById("out").textContent = "deposit / redeem";\n');
  writeFileSync(
    join(site, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>SampleVault</title></head><body><p id="out"></p>
<script src="/copeybara-exit.js"></script>
<copeybara-exit ens="${name}" kit="/copeybara-kit.html" sha256="${kitSha}" certified></copeybara-exit>
<script type="module" src="/src/main.js"></script></body></html>`,
  );
  writeFileSync(join(site, 'vite.config.ts'), `import { defineConfig } from 'vite';\nimport { copeybara } from '@copeybara/vite-plugin';\nexport default defineConfig({ logLevel: 'error', plugins: [copeybara({ ens: '${name}', rpcs: ${JSON.stringify(rpcs)}, log: () => {} })] });\n`);
  execFileSync(process.execPath, [join(vitePkg, 'bin', 'vite.js'), 'build'], { cwd: site, stdio: 'pipe' });
  const wellKnown = JSON.parse(readFileSync(join(site, 'dist', '.well-known', 'copeybara-site.json'), 'utf8')) as { record: string };
  r = await cli('fingerprint', '--dist', 'site/dist');
  expect(r.status).toBe(0);
  const siteRecord = readFileSync(join(dir, '.copeybara', 'site.txt'), 'utf8');
  expect(siteRecord).toBe(wellKnown.record); // the plugin and the CLI agree
  expect(siteRecord).toContain(readFileSync(join(REPO, 'packages/widget/copeybara-exit.js.sha256'), 'utf8').split(/\s/)[0]!); // the widget is fingerprinted

  // 3. One Safe batch: the records + the watcher grants (SetupName already granted the website key `url`).
  r = await cli('propose');
  expect(r.status).toBe(0);
  expect(r.out).toContain('skip  website key → url: already granted');
  expect(r.out).toMatch(/6 call\(s\), one batch/);
  const batch = JSON.parse(readFileSync(join(dir, '.copeybara', 'safe-batch.json'), 'utf8')) as { transactions: unknown[]; meta: { checksum?: string } };
  expect(batch.transactions).toHaveLength(6);
  expect(batch.meta.checksum).toMatch(/^0x[0-9a-f]{64}$/);
  await executeAsSafe('safe-tx.json');
  r = await cli('propose');
  expect(r.out).toContain('Nothing to propose');

  // 4. Prove it.
  r = await cli('verify');
  expect(r.out).toContain(`✓ release      MATCH v=1 ${kitSha}`);
  for (const line of ['✓ manifest     MATCH', '✓ exits        MATCH', '✓ site         MATCH', '✓ owner        the Safe owns', 'may write url only', 'may write status + blocklist only', '✓ safe         2 of 3 signers']) expect(r.out).toContain(line);
  expect(r.status).toBe(0);
  for (const mode of [['--live'], []]) {
    r = await cli('roles-check', ...mode);
    expect(r.out).toContain('roles-check: OK (35 calls)');
    expect(r.status).toBe(0);
  }
  r = await cli('drill');
  expect(r.out).toContain('drill: RECOVERED with the website and primary RPC off');
  expect(r.status).toBe(0);
  r = await cli('certify');
  expect(r.out).toContain('certify: PASS');
  expect(r.status).toBe(0);

  // Incident: compromised + blocklist, one Safe batch (status and blocklist only), then cleared.
  r = await cli('incident', '--state', 'compromised', '--note', 'Site hijacked. Use your saved exit kit.', '--block', 'samplevault-rewards.localhost');
  expect(r.status).toBe(0);
  const inc = JSON.parse(readFileSync(join(dir, '.copeybara', 'incident-batch.json'), 'utf8')) as { transactions: unknown[] };
  expect(inc.transactions).toHaveLength(2);
  await executeAsSafe('incident-tx.json');
  r = await cli('verify');
  expect(r.out).toContain('! status       COMPROMISED');
  r = await cli('certify');
  expect(r.out).toContain('✗ certify: status            compromised');
  expect(r.status).toBe(1);

  // The extension's view of the followed name: blocklist + status, and the vault's exit classified as an exit.
  const q = createQuorum({ urls: rpcs, expectedChainId: 11155111, timeoutMs: 20_000 });
  const records = await readCopeybaraRecords(name, q, { universalResolver: UR });
  expect(records.blocklist).toEqual(['samplevault-rewards.localhost']);
  expect(records.status?.state).toBe('compromised');
  expect(Object.keys(records.exitSpec?.kinds ?? {})).toEqual(['vault']);

  // The kit's own flow (apps/kit/src/flow.ts) with the shipped adapters finds and exits the vault position.
  const flowPath = join(REPO, 'apps/kit/src/flow.ts');
  const { createFlow } = (await import(/* @vite-ignore */ flowPath)) as { createFlow: (deps: KitFlowDeps) => KitFlow };
  const sent: Hex[] = [];
  const flow = createFlow({
    quorumFor: () => createQuorum({ urls: rpcs, expectedChainId: 11155111, timeoutMs: 20_000 }),
    ens: { chainId: 11155111, universalResolver: UR },
    adapters: ADAPTERS,
    wallet: {
      connect: async () => ({ account: USER, chainId: 11155111 }),
      ensureChain: async () => {},
      sender: () => ({
        sendTransaction: async (tx) => {
          // What the extension sees when the user's wallet is asked to send the kit's exit.
          const c = classifyRequest({ method: 'eth_sendTransaction', params: [{ from: tx.from, to: tx.to, data: tx.data, value: '0x0' }] }, { account: USER, chainId: 11155111, manifests: [{ name, manifest: records.manifest, exitSpec: records.exitSpec }] });
          expect(c.verdict).toBe('exit');
          sent.push(tx.data);
          return fork.wallet(tx.from).sendTransaction({ account: tx.from, chain: fork.chain, to: tx.to, data: tx.data, value: tx.value });
        },
      }),
    },
    now: () => Date.now(),
  });
  await flow.start({ ensName: name, targetChainId: 11155111, userRpcs: { '11155111': rpcs }, slippageBps: 50, useDefaultRpcs: false, drillUrl: '' });
  const s = flow.state.get();
  if (!('positions' in s)) throw new Error(`kit stopped: ${JSON.stringify(s)}`);
  expect(s.positions.map((p) => p.id)).toEqual(['spec:vault']);
  await flow.exit('spec:vault');
  const after = flow.state.get();
  if (!('results' in after)) throw new Error('kit left the positions screen');
  expect(after.results['spec:vault']?.status).toBe('recovered');
  expect(sent).toHaveLength(1);
  const bal = await fork.publicClient.readContract({ address: token, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [USER] });
  expect(bal).toBe(parseEther('1050'));

  r = await cli('incident', '--state', 'ok', '--unblock', 'samplevault-rewards.localhost');
  expect(r.status).toBe(0);
  await executeAsSafe('incident-tx.json');
  expect((await cli('verify')).out).toMatch(/✓ status +v=1;state=ok/);

  // 5. The watcher: compose file + env example, the key never in the compose file.
  r = await cli('watcher');
  expect(r.status).toBe(0);
  const compose = readFileSync(join(dir, '.copeybara', 'watcher', 'compose.yml'), 'utf8');
  expect(compose).toContain(`WATCH_NAMES: "${name}"`);
  expect(compose).toContain(`WATCHER_ADDRESS: "${addr(K.watcher)}"`);
  expect(compose).toContain('read_only: true');
  expect(compose).not.toContain(K.watcher.slice(2));
  expect(readFileSync(join(dir, '.copeybara', 'watcher', '.gitignore'), 'utf8')).toContain('watcher.env');
}, 900_000);
