import { describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CopeybaraWebpackPlugin, type CompilerLike } from '../src';

const quiet = { log: () => {} };

function fakeCompiler(path: string) {
  let hook: ((c: { errors: unknown[] }) => Promise<void>) | undefined;
  const compiler: CompilerLike = { options: { output: { path } }, hooks: { afterEmit: { tapPromise: (_n, fn) => void (hook = fn) } } };
  return { compiler, emit: async () => { const c = { errors: [] as unknown[] }; await hook!(c); return c; } };
}

describe('@copeybara/webpack-plugin', () => {
  test('adds a compilation error for an unpinned third-party script; passes a clean output', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'copeybara-wp-'));
    writeFileSync(join(bad, 'index.html'), '<script src="https://cdn.example/x.js"></script>');
    const b = fakeCompiler(bad);
    new CopeybaraWebpackPlugin(quiet).apply(b.compiler);
    expect(String((await b.emit()).errors[0])).toMatch(/unpinned third-party script/);

    const good = mkdtempSync(join(tmpdir(), 'copeybara-wp-'));
    writeFileSync(join(good, 'main.js'), 'x()');
    const g = fakeCompiler(good);
    new CopeybaraWebpackPlugin(quiet).apply(g.compiler);
    expect((await g.emit()).errors).toEqual([]);
    expect(existsSync(join(good, '.well-known', 'copeybara-site.json'))).toBe(true);
  });
});
