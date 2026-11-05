import { describe, expect, test } from 'vitest';
import { formatRelease, parseRelease, ReleaseError } from '../src';

const H = 'ab'.repeat(32);

describe('release codec', () => {
  test('parses', () => {
    expect(parseRelease(`sha256:${H};v=3`)).toEqual({ sha256: H, version: 3 });
  });
  test('formats and round trips', () => {
    expect(formatRelease({ sha256: H, version: 7 })).toBe(`sha256:${H};v=7`);
    expect(parseRelease(formatRelease({ sha256: H, version: 7 }))).toEqual({ sha256: H, version: 7 });
  });
  test.each([
    `sha256:${H.toUpperCase()};v=3`,
    `sha256:${H}`,
    `sha256:${H};v=0`,
    `sha256:${H.slice(1)};v=1`,
    `sha256:${H};v=1.5`,
    `md5:${H};v=1`,
    '',
  ])('rejects %j', (text) => {
    expect(() => parseRelease(text)).toThrow(ReleaseError);
  });
});
