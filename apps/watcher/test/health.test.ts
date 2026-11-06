import { expect, test } from 'vitest';
import { health } from '../src/health';

test('healthy while checks complete; unhealthy before the first and after 4 missed intervals', () => {
  expect(health(null, 1000, 15_000).ok).toBe(false);
  expect(health(0, 59_000, 15_000).ok).toBe(true);
  expect(health(0, 61_000, 15_000)).toEqual({ ok: false, detail: 'no completed check for 61 s' });
});
