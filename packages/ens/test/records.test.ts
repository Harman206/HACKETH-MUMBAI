import { describe, expect, test } from 'vitest';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, namehash, toHex, type Hex } from 'viem';
import { packetToBytes } from 'viem/ens';
import { textResolverAbi, universalResolverAbi, ManifestError, type Address } from '@blackout/core';
import { CallRevertedError, type Quorum } from '@blackout/quorum';
import { readBlackoutRecords, RecordsError, ENS_KEYS } from '../src';

const UR: Address = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const RESOLVER: Address = '0x1111111111111111111111111111111111111111';
const NAME = 'demoswap-blackout.eth';
const H = 'ab'.repeat(32);
const GOOD = {
  url: 'https://demoswap.example',
  'org.blackout.release': `sha256:${H};v=4`,
  'org.blackout.manifest': '{"v":1,"c":{}}',
  'org.blackout.site': '',
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

describe('readBlackoutRecords', () => {
  test('happy path', async () => {
    const { q } = stubQuorum(GOOD);
    const r = await readBlackoutRecords(NAME, q, { universalResolver: UR });
    expect(r.url).toBe('https://demoswap.example');
    expect(r.release).toEqual({ sha256: H, version: 4 });
    expect(r.manifest).toEqual({ v: 1, chains: {} });
    expect(r.site).toBeNull();
    expect(r.block).toBe(777n);
    expect(r.resolver).toBe(RESOLVER);
  });

  test('every record is read at the same pinned block', async () => {
    const { q, blocks } = stubQuorum(GOOD);
    await readBlackoutRecords(NAME, q, { universalResolver: UR });
    expect(blocks).toHaveLength(ENS_KEYS.length);
    expect(new Set(blocks)).toEqual(new Set([777n]));
  });

  test('name is normalised before hashing', async () => {
    const { q } = stubQuorum(GOOD);
    await expect(readBlackoutRecords('  DemoSwap-Blackout.ETH ', q, { universalResolver: UR })).resolves.toBeTruthy();
  });

  test('missing release → RecordsError naming the key', async () => {
    const { q } = stubQuorum({ ...GOOD, 'org.blackout.release': '' });
    const e = await readBlackoutRecords(NAME, q, { universalResolver: UR }).catch((x) => x);
    expect(e).toBeInstanceOf(RecordsError);
    expect(e.key).toBe('org.blackout.release');
    expect(e.message).toMatch(/no release record/);
  });

  test('malformed manifest → RecordsError wrapping ManifestError', async () => {
    const { q } = stubQuorum({ ...GOOD, 'org.blackout.manifest': '{' });
    const e = await readBlackoutRecords(NAME, q, { universalResolver: UR }).catch((x) => x);
    expect(e).toBeInstanceOf(RecordsError);
    expect(e.key).toBe('org.blackout.manifest');
    expect(e.cause).toBeInstanceOf(ManifestError);
  });

  test('name without a resolver → plain RecordsError', async () => {
    const { q } = stubQuorum(GOOD, { revert: true });
    await expect(readBlackoutRecords(NAME, q, { universalResolver: UR })).rejects.toThrow(/not set up|no resolver/);
  });

  test('not a valid name → RecordsError before any read', async () => {
    const { q, blocks } = stubQuorum(GOOD);
    await expect(readBlackoutRecords('no-tld', q, { universalResolver: UR })).rejects.toBeInstanceOf(RecordsError);
    expect(blocks).toHaveLength(0);
  });
});
