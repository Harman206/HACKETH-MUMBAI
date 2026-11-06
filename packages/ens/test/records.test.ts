import { describe, expect, test } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, namehash, toHex, type Hex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { textResolverAbi, universalResolverAbi, ManifestError, type Address } from '@copeybara/core';
import { CallRevertedError, type Quorum } from '@copeybara/quorum';
import { readCopeybaraRecords, RecordsError, ENS_KEYS } from '../src';

const UR: Address = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const RESOLVER: Address = '0x1111111111111111111111111111111111111111';
const NAME = 'demoswap-blackout.eth';
const H = 'ab'.repeat(32);
const GOOD = {
  url: 'https://demoswap.example',
  'org.copeybara.release': `sha256:${H};v=4`,
  'org.copeybara.manifest': '{"v":1,"c":{}}',
  'org.copeybara.site': '',
};

/** Stub quorum that answers UniversalResolver.resolve(name, text(node,key)) from a record map. */
function stubQuorum(records: Record<string, string>, opts: { revert?: boolean } = {}) {
  const blocks: bigint[] = [];
  const q: Partial<Quorum> = {
    pinBlock: async () => 777n,
    call: async ({ to, data }, block) => {
      blocks.push(block);
      expect(to).toBe(UR);
      if (opts.revert) throw new CallRevertedError('execution reverted');
      const { args } = decodeFunctionData({ abi: universalResolverAbi, data });
      const [dns, inner] = args as [Hex, Hex];
      expect(dns).toBe(toHex(packetToBytes(NAME)));
      const t = decodeFunctionData({ abi: textResolverAbi, data: inner });
      const [node, key] = t.args as [Hex, string];
      expect(node).toBe(namehash(NAME));
      const text = encodeFunctionResult({ abi: textResolverAbi, functionName: 'text', result: records[key] ?? '' });
      return encodeAbiParameters([{ type: 'bytes' }, { type: 'address' }], [text, RESOLVER]);
    },
  };
  return { q: q as Quorum, blocks };
}

describe('readCopeybaraRecords', () => {
  test('happy path', async () => {
    const { q } = stubQuorum(GOOD);
    const r = await readCopeybaraRecords(NAME, q, { universalResolver: UR });
    expect(r.url).toBe('https://demoswap.example');
    expect(r.release).toEqual({ sha256: H, version: 4 });
    expect(r.manifest).toEqual({ v: 1, chains: {} });
    expect(r.site).toBeNull();
    expect(r.status).toEqual({ state: 'ok' });
    expect(r.blocklist).toEqual([]);
    expect(r.extension).toBeNull();
    expect(r.problems).toEqual([]);
    expect(r.block).toBe(777n);
    expect(r.resolver).toBe(RESOLVER);
  });

  test('every record is read at the same pinned block', async () => {
    const { q, blocks } = stubQuorum(GOOD);
    await readCopeybaraRecords(NAME, q, { universalResolver: UR });
    expect(blocks).toHaveLength(ENS_KEYS.length);
    expect(new Set(blocks)).toEqual(new Set([777n]));
  });

  test('name is normalised before hashing', async () => {
    const { q } = stubQuorum(GOOD);
    await expect(readCopeybaraRecords('  DemoSwap-Blackout.ETH ', q, { universalResolver: UR })).resolves.toBeTruthy();
  });

  test('missing release → RecordsError naming the key', async () => {
    const { q } = stubQuorum({ ...GOOD, 'org.copeybara.release': '' });
    const e = await readCopeybaraRecords(NAME, q, { universalResolver: UR }).catch((x) => x);
    expect(e).toBeInstanceOf(RecordsError);
    expect(e.key).toBe('org.copeybara.release');
    expect(e.message).toMatch(/no release record/);
  });

  test('malformed manifest → RecordsError wrapping ManifestError', async () => {
    const { q } = stubQuorum({ ...GOOD, 'org.copeybara.manifest': '{' });
    const e = await readCopeybaraRecords(NAME, q, { universalResolver: UR }).catch((x) => x);
    expect(e).toBeInstanceOf(RecordsError);
    expect(e.key).toBe('org.copeybara.manifest');
    expect(e.cause).toBeInstanceOf(ManifestError);
  });

  test('name without a resolver → plain RecordsError', async () => {
    const { q } = stubQuorum(GOOD, { revert: true });
    await expect(readCopeybaraRecords(NAME, q, { universalResolver: UR })).rejects.toThrow(/not set up|no resolver/);
  });

  test('not a valid name → RecordsError before any read', async () => {
    const { q, blocks } = stubQuorum(GOOD);
    await expect(readCopeybaraRecords('no-tld', q, { universalResolver: UR })).rejects.toBeInstanceOf(RecordsError);
    expect(blocks).toHaveLength(0);
  });

  test('legacy org.blackout.* records are not read', async () => {
    const { q } = stubQuorum({ url: GOOD.url, 'org.blackout.release': `sha256:${H};v=4`, 'org.blackout.manifest': '{"v":1,"c":{}}' });
    await expect(readCopeybaraRecords(NAME, q, { universalResolver: UR })).rejects.toMatchObject({ key: 'org.copeybara.release' });
  });

  test('no manifest → stops', async () => {
    const { q } = stubQuorum({ ...GOOD, 'org.copeybara.manifest': '' });
    await expect(readCopeybaraRecords(NAME, q, { universalResolver: UR })).rejects.toThrow(/no exit manifest/);
  });

  test('optional records are parsed', async () => {
    const S = 'cd'.repeat(32);
    const { q } = stubQuorum({
      ...GOOD,
      'org.copeybara.site': `v=2;sha256=${S},${H}`,
      'org.copeybara.extension': `sha256:${S};v=1`,
      'org.copeybara.status': 'v=1;state=compromised;at=10;note=hijacked',
      'org.copeybara.blocklist': '{"v":1,"domains":["rewards-demoswap.localhost"]}',
    });
    const r = await readCopeybaraRecords(NAME, q, { universalResolver: UR });
    expect(r.site).toEqual([S, H]);
    expect(r.extension).toEqual({ sha256: S, version: 1 });
    expect(r.status).toEqual({ state: 'compromised', at: 10, note: 'hijacked' });
    expect(r.blocklist).toEqual(['rewards-demoswap.localhost']);
  });

  test('malformed optional records never stop the exit: reported as problems, never shown as fine', async () => {
    const { q } = stubQuorum({ ...GOOD, 'org.copeybara.site': 'junk', 'org.copeybara.status': 'state=ok', 'org.copeybara.blocklist': '[', 'org.copeybara.extension': 'x' });
    const r = await readCopeybaraRecords(NAME, q, { universalResolver: UR });
    expect(r.site).toBeNull();
    expect(r.status).toBeNull();
    expect(r.blocklist).toEqual([]);
    expect(r.extension).toBeNull();
    expect(r.problems.map((p) => p.key).sort()).toEqual(['org.copeybara.blocklist', 'org.copeybara.extension', 'org.copeybara.site', 'org.copeybara.status']);
  });
});
