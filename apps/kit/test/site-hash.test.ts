import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normaliseBundle, siteHashCheck } from '../src/check';

const ROOT = join(__dirname, '..', '..', '..', 'harness');
const app = readFileSync(join(ROOT, 'site', 'app.js'), 'utf8');
const inject = readFileSync(join(ROOT, 'hijack', 'inject.js'), 'utf8');
const published = createHash('sha256').update(normaliseBundle(app), 'utf8').digest('hex');

describe('site bundle hash vs org.copeybara.site', () => {
  test('the official DemoSwap bundle matches', async () => {
    expect(await siteHashCheck(app, [published])).toEqual({ verdict: 'match', sha256: published });
  });
  test('the hijacked bundle does not', async () => {
    expect((await siteHashCheck(app + '\n' + inject, [published])).verdict).toBe('mismatch');
  });
  test('A6: CRLF and trailing whitespace do not change the verdict', async () => {
    const pub = createHash('sha256').update(normaliseBundle(app), 'utf8').digest('hex');
    expect((await siteHashCheck(app.replace(/\n/g, '\r\n'), [pub])).verdict).toBe('match');
    expect((await siteHashCheck(app.replace(/\n/g, '   \n') + '\n\n', [pub])).verdict).toBe('match');
  });

  test('no record published → unset', async () => {
    expect((await siteHashCheck(app, null)).verdict).toBe('unset');
  });
  test('any member of the published set matches', async () => {
    expect((await siteHashCheck(app, ['f'.repeat(64), published])).verdict).toBe('match');
  });
});
