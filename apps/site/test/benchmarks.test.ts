import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BENCH_STATS, BENCHMARKS, GAPS } from '../src/benchmarks';

const DIR = join(__dirname, '..', '..', '..', 'docs', 'benchmarks');
const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
const all = ['README.md', 'b1-drainer-requests.md', 'b2-lookalike-domains.md', 'b3-frontend-hijacks.md'].map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n').replace(/,(\d{3})/g, '$1');
const plain = (s: string) => s.replace(/,(\d{3})/g, '$1');

describe('landing-page benchmarks match docs/benchmarks', () => {
  test('every headline figure, fraction and "was" value is in the README', () => {
    for (const s of BENCH_STATS) {
      expect(plain(readme), s.figure).toContain(plain(s.figure));
      if (/\d+\/\d+/.test(s.detail)) expect(readme, s.detail).toContain(s.detail);
      if (s.before) expect(readme, s.before).toContain(s.before);
    }
  });
  test('every count quoted in the benchmark cards appears in a report', () => {
    const text = BENCHMARKS.flatMap((b) => [b.ran, ...b.worked, ...b.missed]).join(' ');
    for (const n of text.match(/\d[\d,]*\/\d[\d,]*|\d+(?:\.\d+)?%|\d[\d,]{2,}/g) ?? []) expect(all, n).toContain(plain(n));
  });
  test('gap table: eight gaps, numbers backed by the README', () => {
    expect(GAPS).toHaveLength(8);
    for (const n of GAPS.flatMap((g) => [g.before, g.after]).join(' ').match(/\d+\/\d+/g) ?? []) expect(readme, n).toContain(n);
  });
  test('every linked report exists', () => {
    for (const b of BENCHMARKS) expect(existsSync(join(DIR, b.report)), b.report).toBe(true);
  });
});
