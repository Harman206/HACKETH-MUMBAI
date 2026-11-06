import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// webpack.config.js and next.config.mjs are loaded by plain Node (no TypeScript loader): the plugins must be too.
const run = (script: string) => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
const entry = (pkg: string) => new URL(`../../${pkg}/src/index.js`, import.meta.url).href;
const fake = `
  let hook;
  const compiler = (path) => ({ options: { output: { path } }, hooks: { afterEmit: { tapPromise: (_n, fn) => (hook = fn) } } });
  const emit = async () => { const c = { errors: [] }; await hook(c); return c.errors.map(String); };`;

test('webpack-plugin: loads and fingerprints from plain Node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'copeybara-wp-node-'));
  writeFileSync(join(dir, 'main.js'), 'x()');
  const r = run(`import { CopeybaraWebpackPlugin } from ${JSON.stringify(entry('webpack-plugin'))};${fake}
    new CopeybaraWebpackPlugin({ log: () => {} }).apply(compiler(${JSON.stringify(dir)}));
    console.log(JSON.stringify(await emit()));`);
  expect(r.stderr).toBe('');
  expect(JSON.parse(r.stdout)).toEqual([]);
  expect(existsSync(join(dir, '.well-known', 'copeybara-site.json'))).toBe(true);
}, 60_000);

test('next-plugin: withCopeybara loads from plain Node and its client plugin fails on an unpinned script', () => {
  const app = mkdtempSync(join(tmpdir(), 'copeybara-next-node-'));
  const statics = join(app, '.next', 'static');
  spawnSync('mkdir', ['-p', statics]);
  writeFileSync(join(statics, 'page.html'), '<script src="https://cdn.example/x.js"></script>');
  const r = run(`import { withCopeybara } from ${JSON.stringify(entry('next-plugin'))};${fake}
    const cfg = withCopeybara({}, { log: () => {} });
    const c = cfg.webpack({ plugins: [] }, { isServer: false, dev: false, dir: ${JSON.stringify(app)} });
    c.plugins[0].apply(compiler(undefined));
    console.log(JSON.stringify(await emit()));`);
  expect(r.stderr).toBe('');
  expect(JSON.parse(r.stdout).join()).toMatch(/unpinned third-party script/);
}, 60_000);

test('the plugin entries are plain JavaScript (no TypeScript syntax Node would have to strip)', () => {
  for (const p of ['vite-plugin', 'webpack-plugin', 'next-plugin']) expect(existsSync(fileURLToPath(entry(p)))).toBe(true);
});
