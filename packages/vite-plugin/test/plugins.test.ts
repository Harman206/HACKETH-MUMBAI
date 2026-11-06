import { describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { parseSiteRecord } from '@copeybara/core';
import { copeybara } from '../src';

function project(html: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'copeybara-vite-')));
  writeFileSync(join(root, 'index.html'), html);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'main.js'), 'document.body.dataset.ok = "1";\n');
  return root;
}
const quiet = { log: () => {} };

describe('@copeybara/vite-plugin', () => {
  test('a clean build writes dist/.well-known/copeybara-site.json with a valid record', async () => {
    const root = project('<!doctype html><script type="module" src="/src/main.js"></script>');
    await build({ root, logLevel: 'silent', plugins: [copeybara(quiet)] });
    const wk = JSON.parse(readFileSync(join(root, 'dist', '.well-known', 'copeybara-site.json'), 'utf8')) as { record: string; scripts: unknown[] };
    expect(parseSiteRecord(wk.record)!.length).toBeGreaterThan(0);
    expect(wk.scripts.length).toBeGreaterThan(0);
  }, 60_000);

  test('an unpinned third-party script fails the build and writes nothing', async () => {
    const root = project('<!doctype html><script src="https://cdn.example/tracker.js"></script><script type="module" src="/src/main.js"></script>');
    await expect(build({ root, logLevel: 'silent', plugins: [copeybara(quiet)] })).rejects.toThrow(/unpinned third-party script/);
    expect(existsSync(join(root, 'dist', '.well-known', 'copeybara-site.json'))).toBe(false);
  }, 60_000);
});
