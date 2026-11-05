import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateFixture, type Fixture } from '../fixtures/schema';

const DIR = join(__dirname, '..', 'fixtures');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

test('at least the R1 fixture exists', () => expect(files).toContain('R1.json'));
test.each(files)('%s is a valid fixture', (f) => {
  const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Fixture;
  expect(() => validateFixture(fx)).not.toThrow();
});
