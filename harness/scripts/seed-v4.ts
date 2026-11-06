/**
 * Seeds Uniswap v4 positions on Sepolia for the demo wallet (testnet only).
 *   pnpm --filter @copeybara/harness exec tsx scripts/seed-v4.ts          # dry run: prints what it would do
 *   pnpm --filter @copeybara/harness exec tsx scripts/seed-v4.ts --send     # sends (DEPLOYER_KEY from contracts/.env pays and supplies DUSD/DETH)
 * Env: DEPLOYER_KEY, DEMO_WALLET (receives the position NFTs), SEPOLIA_RPC (optional).
 * Writes contracts/deployments/sepolia-v4-positions.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, fallback, http, maxUint128, maxUint160, maxUint256, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { V4_ACTIONS, v4PosmAbi, v4StateViewAbi } from '../../packages/core/src/index';
import { poolIdOf, type PoolKey } from '../../packages/adapters/src/v4-math';

const REPO = new URL('../../', import.meta.url);
const env: Record<string, string> = { ...Object.fromEntries(readFileSync(new URL('contracts/.env', REPO), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])), ...(process.env as Record<string, string>) };
const SEND = process.argv.includes('--send');
const POSM: Address = '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4';
const POOL_MANAGER: Address = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';
const STATE_VIEW: Address = '0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C';
const PERMIT2: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const attack = JSON.parse(readFileSync(new URL('contracts/deployments/sepolia-attack.json', REPO), 'utf8')) as { DUSD: Address; DETH: Address };
const user = (env.DEMO_WALLET ?? '') as Address;
if (!/^0x[0-9a-fA-F]{40}$/.test(user)) throw new Error('Set DEMO_WALLET to the address that should own the positions.');
const deployer = privateKeyToAccount(env.DEPLOYER_KEY as Hex);

const [c0, c1] = attack.DETH.toLowerCase() < attack.DUSD.toLowerCase() ? [attack.DETH, attack.DUSD] : [attack.DUSD, attack.DETH];
const key: PoolKey = { currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' };
const abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24)',
]);
const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

const rpcs = [env.SEPOLIA_RPC, 'https://sepolia.gateway.tenderly.co', 'https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.ethpandaops.io'].filter(Boolean) as string[];
const transport = fallback(rpcs.map((u) => http(u)));
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account: deployer });
const txs: Record<string, Hex> = {};

async function send(label: string, to: Address, data: Hex): Promise<Hex | null> {
  const gas = await pub.estimateGas({ account: deployer, to, data });
  console.log(`${SEND ? 'send' : 'would send'}: ${label} (gas ≈ ${gas})`);
  if (!SEND) return null;
  const hash = await wallet.sendTransaction({ to, data, gas: (gas * 13n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted: ${hash}`);
  txs[label] = hash;
  console.log(`  ✓ ${hash}`);
  return hash;
}

async function mint(label: string, tickLower: number, tickUpper: number, liquidity: bigint): Promise<string | null> {
  const mintParams = encodeAbiParameters(parseAbiParameters('(address,address,uint24,int24,address), int24, int24, uint256, uint128, uint128, address, bytes'), [
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], tickLower, tickUpper, liquidity, maxUint128, maxUint128, user, '0x',
  ]);
  const settle = encodeAbiParameters(parseAbiParameters('address, address'), [key.currency0, key.currency1]);
  const unlock = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [toHex(Uint8Array.from([V4_ACTIONS.MINT_POSITION, V4_ACTIONS.SETTLE_PAIR])), [mintParams, settle]]);
  const data = encodeFunctionData({ abi: v4PosmAbi, functionName: 'modifyLiquidities', args: [unlock, BigInt(Math.floor(Date.now() / 1000) + 3600)] });
  const hash = await send(label, POSM, data);
  if (!hash) return null;
  const r = await pub.getTransactionReceipt({ hash });
  const t = r.logs.find((l) => l.address.toLowerCase() === POSM.toLowerCase() && l.topics.length === 4);
  return BigInt(t!.topics[3]!).toString();
}

console.log(`deployer ${deployer.address} → positions for ${user}; pool ${key.currency0}/${key.currency1} 0.3%`);
for (const t of [key.currency0, key.currency1]) {
  if ((await pub.readContract({ address: t, abi, functionName: 'allowance', args: [deployer.address, PERMIT2] })) < 10n ** 30n) {
    await send(`approve Permit2 for ${t}`, t, encodeFunctionData({ abi, functionName: 'approve', args: [PERMIT2, maxUint256] }));
  }
  const [amt] = await pub.readContract({ address: PERMIT2, abi: permit2Abi, functionName: 'allowance', args: [deployer.address, t, POSM] });
  if (amt < 10n ** 30n) await send(`Permit2 allow PositionManager for ${t}`, PERMIT2, encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [t, POSM, maxUint160, 2 ** 48 - 1] }));
}
const poolId = poolIdOf(key);
const [sqrt] = await pub.readContract({ address: STATE_VIEW, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolId] });
if (sqrt === 0n) await send('initialize pool at price 1', POOL_MANAGER, encodeFunctionData({ abi, functionName: 'initialize', args: [key, 2n ** 96n] }));
if (!SEND && sqrt === 0n) {
  console.log('dry run stops here: minting needs the pool to exist. Re-run with --send.');
  process.exit(0);
}
const [, tick] = await pub.readContract({ address: STATE_VIEW, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolId] });
const base = Math.floor(tick / 60) * 60;
const inRange = await mint('mint in-range position', base - 600, base + 600, 10n ** 21n);
const outOfRange = await mint('mint out-of-range position', base + 1200, base + 2400, 10n ** 21n);

if (SEND) {
  const out = new URL('contracts/deployments/sepolia-v4-positions.json', REPO);
  writeFileSync(out, JSON.stringify({ chainId: 11155111, wallet: user, positionManager: POSM, poolKey: key, poolId, positions: { inRange, outOfRange }, txs }, null, 2) + '\n');
  console.log(`wrote ${out.pathname}`);
}
