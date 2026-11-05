import { expect, test } from 'vitest';
import { guard } from '../src';
import { BANNED_CORPUS } from './corpus';
import { ctx1 } from './manifest-fixture';

test.each(BANNED_CORPUS.map((c) => [c.name, c] as const))('rejects: %s', (_n, c) => {
  expect(guard(c.tx, ctx1).ok).toBe(false);
});

test('zero accepts across the whole banned corpus', () => {
  const accepts = BANNED_CORPUS.filter((c) => guard(c.tx, ctx1).ok).map((c) => c.name);
  expect(accepts).toEqual([]);
  expect(BANNED_CORPUS.length).toBeGreaterThanOrEqual(25);
});
