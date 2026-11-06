// Generates public/icon-{16,32,48,128}.png: a capybara head (rounded brown snout, small ears, eyes) on a warm tile.
// Pure Node (zlib), deterministic bytes. Run once: node scripts/icons.mjs
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};

function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const TILE = [247, 236, 222];
const FUR = [160, 103, 58];
const DARK = [92, 58, 33];
const EYE = [32, 22, 14];

/** colour at unit coords (u,v in 0..1) or null for transparent */
function shade(u, v) {
  const rr = 0.2; // tile corner radius
  const cx = Math.min(Math.max(u, rr), 1 - rr), cy = Math.min(Math.max(v, rr), 1 - rr);
  if ((u - cx) ** 2 + (v - cy) ** 2 > rr * rr) return null;
  const inEll = (x, y, a, b) => ((u - x) / a) ** 2 + ((v - y) / b) ** 2 <= 1;
  if (inEll(0.5 - 0.1, 0.62 - 0.02, 0.035, 0.03) || inEll(0.5 + 0.1, 0.62 - 0.02, 0.035, 0.03)) return DARK; // nostrils
  if (inEll(0.33, 0.42, 0.045, 0.055) || inEll(0.67, 0.42, 0.045, 0.055)) return EYE;
  if (inEll(0.24, 0.24, 0.07, 0.07) || inEll(0.76, 0.24, 0.07, 0.07)) return DARK; // ears
  if (inEll(0.5, 0.56, 0.34, 0.3)) return FUR; // head
  if (inEll(0.5, 0.72, 0.22, 0.14)) return FUR;
  return TILE;
}

for (const size of [16, 32, 48, 128]) {
  const S = 4; // supersampling
  const buf = png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < S; i++)
      for (let j = 0; j < S; j++) {
        const c = shade((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
      }
    return a ? [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (S * S))] : [0, 0, 0, 0];
  });
  writeFileSync(join(OUT, `icon-${size}.png`), buf);
}
console.log('icons written to', OUT);
