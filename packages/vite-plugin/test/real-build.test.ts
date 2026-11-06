import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintDist } from '@copeybara/fingerprint';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const VITE = dirname(createRequire(join(PKG, 'package.json')).resolve('vite/package.json'));

// Vite loads vite.config.ts by bundling it and importing every package with plain Node, without a TypeScript
// loader. The plugin must load that way, not only through vitest's own transform.
test('`vite build` with a vite.config.ts that imports @copeybara/vite-plugin writes the fingerprint', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'copeybara-vite-real-')));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'site', private: true, type: 'module' }));
  mkdirSync(join(root, 'node_modules', '@copeybara'), { recursive: true });
  symlinkSync(PKG, join(root, 'node_modules', '@copeybara', 'vite-plugin'));
  symlinkSync(VITE, join(root, 'node_modules', 'vite'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title><script type="module" src="/src/main.js"></script>');
  writeFileSync(join(root, 'src', 'main.js'), 'document.title = "ok";\n');
  writeFileSync(join(root, 'vite.config.ts'), "import { defineConfig } from 'vite';\nimport { copeybara } from '@copeybara/vite-plugin';\nexport default defineConfig({ plugins: [copeybara({ log: () => {} })] });\n");
  const r = spawnSync(process.execPath, [join(VITE, 'bin', 'vite.js'), 'build', '--logLevel', 'error'], { cwd: root, encoding: 'utf8' });
  expect(r.stderr + r.stdout).not.toMatch(/error/i);
  expect(r.status).toBe(0);
  const wk = JSON.parse(readFileSync(join(root, 'dist', '.well-known', 'copeybara-site.json'), 'utf8')) as { record: string };
  return fingerprintDist(join(root, 'dist')).then((fp) => expect(wk.record).toBe(fp.record));
}, 120_000);
