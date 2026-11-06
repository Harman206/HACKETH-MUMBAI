import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { cidFromSha256, contenthashFromSha256, sha256FromContenthash } from '../src/cid';

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

describe('kit sha256 ⇄ IPFS CID ⇄ ENS contenthash (single raw block, CIDv1)', () => {
  test('the well-known CID of empty content', () => {
    expect(cidFromSha256(sha(''))).toBe('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku');
  });

  test('ENSIP-7 contenthash = 0xe301 (ipfs-ns) + CID bytes (0x01 raw 0x55, sha2-256 0x12 0x20, digest)', () => {
    const h = sha('blackout');
    expect(contenthashFromSha256(h)).toBe(`0xe30101551220${h}`);
    expect(sha256FromContenthash(`0xe30101551220${h}`)).toBe(h);
  });

  test('anything else is not a single-block kit address', () => {
    expect(sha256FromContenthash('0x')).toBeNull();
    expect(sha256FromContenthash(`0xe301017012200${'0'.repeat(63)}`)).toBeNull(); // dag-pb, not raw
    expect(() => cidFromSha256('xyz')).toThrow(/sha256/);
  });
});
