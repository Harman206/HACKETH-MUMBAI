import type { Hex } from './types';

/**
 * The kit is one file smaller than one IPFS block (256 KiB), so its CIDv1 with raw leaves is just
 * multihash(sha2-256, kit bytes) — the same fingerprint as the ENS release record. Nothing new to trust.
 *   CID bytes  = 0x01 (CIDv1) 0x55 (raw) 0x12 (sha2-256) 0x20 (32 bytes) <digest>
 *   contenthash (ENSIP-7) = 0xe301 (ipfs-ns) <CID bytes>
 */
const PREFIX = '01551220';
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const check = (sha256: string) => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('expected a lowercase hex sha256');
};

/** CIDv1 (raw, base32 "b…") of a single-block file with this sha256. */
export function cidFromSha256(sha256: string): string {
  check(sha256);
  const hex = PREFIX + sha256;
  return `b${base32(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))))}`;
}

/** ENSIP-7 contenthash for that CID. */
export function contenthashFromSha256(sha256: string): Hex {
  check(sha256);
  return `0xe301${PREFIX}${sha256}`;
}

/** The sha256 inside a single-raw-block IPFS contenthash, or null for anything else. */
export function sha256FromContenthash(contenthash: string): string | null {
  const m = /^0xe301(01551220)([0-9a-f]{64})$/i.exec(contenthash);
  return m ? m[2]!.toLowerCase() : null;
}
