import { expect, test } from 'vitest';
import { mapLimit } from '../src/limit';

test('mapLimit keeps order and never exceeds the limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (x) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, x));
    inFlight--;
    return x * 10;
  });
  expect(out).toEqual([50, 10, 40, 20, 30]);
  expect(peak).toBe(2);
});
