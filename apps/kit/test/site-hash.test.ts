import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteHashCheck } from '../src/check';

const ROOT = join(__dirname, '..', '..', '..', 'harness');
const app = readFileSync(join(ROOT, 'site', 'app.js'), 'utf8');
const inject = readFileSync(join(ROOT, 'hijack', 'inject.js'), 'utf8');
const published = createHash('sha256').update(app, 'utf8').digest('hex');

describe('site bundle hash vs org.blackout.site', () => {
  test('the official DemoSwap bundle matches', async () => {
    expect(await siteHashCheck(app, published)).toEqual({ verdict: 'match', sha256: published });
  });
  test('the hijacked bundle does not', async () => {
    expect((await siteHashCheck(app + '\n' + inject, published)).verdict).toBe('mismatch');
  });
  test('no record published → unset', async () => {
    expect((await siteHashCheck(app, null)).verdict).toBe('unset');
  });
  test('record accepts an optional sha256: prefix and any case', async () => {
    expect((await siteHashCheck(app, `sha256:${published.toUpperCase()}`)).verdict).toBe('match');
  });
});
