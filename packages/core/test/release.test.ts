import { describe, expect, test } from 'vitest';
import { formatRelease, parseRelease, ReleaseError } from '../src';

const H = 'ab'.repeat(32);
const T = 'cd'.repeat(32);

describe('release codec', () => {
  test('parses', () => {
    expect(parseRelease(`sha256:${H};v=3`)).toEqual({ sha256: H, version: 3 });
  });
  test('formats and round trips', () => {
    expect(formatRelease({ sha256: H, version: 7 })).toBe(`sha256:${H};v=7`);
    expect(parseRelease(formatRelease({ sha256: H, version: 7 }))).toEqual({ sha256: H, version: 7 });
  });
  test('optional tree hash (extension build proof): parses, formats, round trips', () => {
    expect(parseRelease(`sha256:${H};v=3;tree=${T}`)).toEqual({ sha256: H, version: 3, tree: T });
    expect(formatRelease({ sha256: H, version: 3, tree: T })).toBe(`sha256:${H};v=3;tree=${T}`);
    expect(parseRelease(formatRelease({ sha256: H, version: 9, tree: T }))).toEqual({ sha256: H, version: 9, tree: T });
  });
  test('an old record without a tree still parses, and has no tree field', () => {
    expect(parseRelease(`sha256:${H};v=1`)).not.toHaveProperty('tree');
  });
  test('formatRelease refuses a malformed tree hash', () => {
    expect(() => formatRelease({ sha256: H, version: 1, tree: 'xyz' })).toThrow(ReleaseError);
  });
  test.each([
    `sha256:${H.toUpperCase()};v=3`,
    `sha256:${H}`,
    `sha256:${H};v=0`,
    `sha256:${H.slice(1)};v=1`,
    `sha256:${H};v=1.5`,
    `md5:${H};v=1`,
    '',
    `sha256:${H};v=1;tree=`,
    `sha256:${H};v=1;tree=${T.slice(1)}`,
    `sha256:${H};v=1;tree=${T.toUpperCase()}`,
    `sha256:${H};tree=${T};v=1`,
    `sha256:${H};v=1;tree=${T};tree=${T}`,
    `sha256:${H};v=1;tree=${T};x=1`,
  ])('rejects %j', (text) => {
    expect(() => parseRelease(text)).toThrow(ReleaseError);
  });
});
