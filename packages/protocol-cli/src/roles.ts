import { BaseError, encodeFunctionData, parseAbi, type Hex } from 'viem';
import type { Address } from '@copeybara/core';
import { CallRevertedError, createQuorum } from '@copeybara/quorum';
import { ALL_KEYS } from './chain';
import { ensChainId, rpcsFor, type CopeybaraConfig, type LoadedConfig } from './config';
import { ROLE_SET_TEXT, WATCHER_KEYS, WEBSITE_KEYS, dnsName, resolverAbi } from './resolver';

const escalationAbi = parseAbi([
  'function grantRootRoles(uint256 roleBitmap, address account) returns (bool)',
  'function upgradeToAndCall(address newImplementation, bytes data) payable',
]);

export interface RoleCase {
  who: string;
  from: Address;
  action: string;
  data: Hex;
  expect: 'ok' | 'reverted';
}

/** Runs a call as `from` without sending it. 'reverted' only for a real EVM revert; anything else throws. */
export type Probe = (from: Address, data: Hex) => Promise<'ok' | 'reverted'>;

const setText = (cfg: CopeybaraConfig, key: string) =>
  encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsName(cfg.name), key, 'copeybara roles-check'] });

/**
 * For each scoped key: its own records must be writable, every other record and every escalation must revert. Each
 * forbidden setText is paired with the same call from the Safe, which must succeed: that proves the revert is about the
 * key's authority, not a broken call.
 */
export function roleCases(cfg: CopeybaraConfig): RoleCase[] {
  const cases: RoleCase[] = [];
  const keys: [string, Address, readonly string[]][] = [['website key', cfg.websiteKey, WEBSITE_KEYS]];
  if (cfg.watcher) keys.push(['watcher', cfg.watcher.key, WATCHER_KEYS]);
  for (const [who, from, mine] of keys) {
    for (const k of ALL_KEYS) {
      const data = setText(cfg, k);
      if (mine.includes(k)) cases.push({ who, from, action: `write ${k}`, data, expect: 'ok' });
      else {
        cases.push({ who, from, action: `write ${k}`, data, expect: 'reverted' });
        cases.push({ who: 'Safe (control)', from: cfg.safe, action: `write ${k}`, data, expect: 'ok' });
      }
    }
    const otherKey = mine.includes('org.copeybara.release') ? 'url' : 'org.copeybara.release';
    const setter = encodeFunctionData({ abi: resolverAbi, functionName: 'setText', args: [dnsName(cfg.name), otherKey, ''] });
    cases.push({ who, from, action: `grant itself ${otherKey}`, data: encodeFunctionData({ abi: resolverAbi, functionName: 'grantSetterRoles', args: [setter, from] }), expect: 'reverted' });
    cases.push({ who, from, action: 'grant itself root setText', data: encodeFunctionData({ abi: escalationAbi, functionName: 'grantRootRoles', args: [ROLE_SET_TEXT, from] }), expect: 'reverted' });
    cases.push({ who, from, action: 'upgrade the resolver', data: encodeFunctionData({ abi: escalationAbi, functionName: 'upgradeToAndCall', args: [from, '0x'] }), expect: 'reverted' });
  }
  return cases;
}

export async function runRoleCases(cases: RoleCase[], probe: Probe) {
  const out: (RoleCase & { got: 'ok' | 'reverted'; pass: boolean })[] = [];
  for (const c of cases) {
    const got = await probe(c.from, c.data);
    out.push({ ...c, got, pass: got === c.expect });
  }
  return out;
}

const isRevert = (e: unknown) => e instanceof BaseError && /revert/i.test(`${e.shortMessage} ${e.message}`);

export async function rolesCheckCmd(l: LoadedConfig, o: { live: boolean }) {
  const { cfg } = l;
  const chainId = ensChainId(cfg);
  let probe: Probe;
  let stop = async () => {};
  if (o.live) {
    const q = createQuorum({ urls: rpcsFor(cfg, chainId), expectedChainId: chainId, timeoutMs: 10_000 });
    const block = await q.pinBlock();
    probe = async (from, data) => {
      try {
        await q.call({ to: cfg.resolver, data, from }, block);
        return 'ok';
      } catch (e) {
        if (e instanceof CallRevertedError) return 'reverted';
        throw e;
      }
    };
    process.stdout.write(`roles-check (live) ${cfg.name} at block ${block}, eth_call through ${rpcsFor(cfg, chainId).length} RPCs:\n`);
  } else {
    if (chainId !== 1 && chainId !== 11155111) throw new Error(`roles-check forks chain 1 or 11155111 only (got ${chainId}); use --live`);
    const { startFork } = await import('@copeybara/testkit');
    const fork = await startFork({ chainId, forkUrl: cfg.rpcs?.[String(chainId)]?.[0] });
    stop = fork.stop;
    probe = async (from, data) => {
      try {
        await fork.publicClient.call({ account: from, to: cfg.resolver, data });
        return 'ok';
      } catch (e) {
        if (isRevert(e)) return 'reverted';
        throw e;
      }
    };
    process.stdout.write(`roles-check (anvil fork of chain ${chainId}) ${cfg.name}:\n`);
  }
  try {
    const res = await runRoleCases(roleCases(cfg), probe);
    for (const r of res) process.stdout.write(`${r.pass ? '✓' : '✗'} ${r.who.padEnd(15)} ${r.action.padEnd(36)} ${r.got === 'ok' ? 'allowed' : 'reverted'}\n`);
    if (res.some((r) => !r.pass)) {
      process.stderr.write('\nroles-check: FAILED\n');
      process.exitCode = 1;
    } else process.stdout.write(`\nroles-check: OK (${res.length} calls)\n`);
  } finally {
    await stop();
  }
}
