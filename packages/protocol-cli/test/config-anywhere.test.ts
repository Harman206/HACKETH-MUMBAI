import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VAULT_ABI } from './helpers';

const BIN = fileURLToPath(new URL('../bin/copeybara.mjs', import.meta.url));
const cli = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });

// A protocol team's config lives in its own repository (or the repo root), not in a workspace package: it must still
// be able to import @copeybara/protocol-cli and @copeybara/core, with or without "type": "module".
test.each([[false], [true]])('init + manifest from a directory outside the workspace (type module: %s)', (esm) => {
  const dir = mkdtempSync(join(tmpdir(), 'copeybara-anywhere-'));
  if (esm) writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  expect(cli(dir, 'init').status).toBe(0);
  const cfg = readFileSync(join(dir, 'copeybara.config.ts'), 'utf8')
    .replace("safe: '0x0000000000000000000000000000000000000000'", "safe: '0x1111111111111111111111111111111111111111'")
    .replace("resolver: '0x0000000000000000000000000000000000000000'", "resolver: '0x2222222222222222222222222222222222222222'")
    .replace("websiteKey: '0x0000000000000000000000000000000000000000'", "websiteKey: '0x3333333333333333333333333333333333333333'")
    .replace("key: '0x0000000000000000000000000000000000000000'", "key: '0x4444444444444444444444444444444444444444'")
    .replace("address: '0x0000000000000000000000000000000000000000'", "address: '0x5555555555555555555555555555555555555555'")
    .replace("abi: 'out/Vault.sol/Vault.json'", "abi: 'Vault.json'");
  writeFileSync(join(dir, 'copeybara.config.ts'), cfg);
  writeFileSync(join(dir, 'Vault.json'), JSON.stringify({ abi: VAULT_ABI }));
  const r = cli(dir, 'manifest');
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  expect(readFileSync(join(dir, '.copeybara', 'exits.txt'), 'utf8')).toContain('redeem(uint256,address,address)');
}, 60_000);
