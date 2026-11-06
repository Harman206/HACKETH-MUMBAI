import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, 'verify-kit.sh');
const file = join(mkdtempSync(join(tmpdir(), 'vk-')), 'blackout-kit.html');
writeFileSync(file, '<html>kit</html>');
const hex = createHash('sha256').update('<html>kit</html>').digest('hex');
const run = (env: Record<string, string>, name = 'demoswap-blackout.eth') =>
  spawnSync('bash', [SCRIPT, file, name], { env: { ...process.env, ...env }, encoding: 'utf8' });

describe('verify-kit.sh reads the release from 3 RPCs', () => {
  test('three matching records → MATCH', () => {
    const r = run({ BLACKOUT_RELEASE_OVERRIDE_1: `sha256:${hex};v=3`, BLACKOUT_RELEASE_OVERRIDE_2: `sha256:${hex};v=3`, BLACKOUT_RELEASE_OVERRIDE_3: `sha256:${hex};v=3` });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/MATCH v=3/);
  });
  test('one RPC disagrees → exit 3, RPCS DISAGREE', () => {
    const r = run({ BLACKOUT_RELEASE_OVERRIDE_1: `sha256:${hex};v=3`, BLACKOUT_RELEASE_OVERRIDE_2: `sha256:${'ab'.repeat(32)};v=3`, BLACKOUT_RELEASE_OVERRIDE_3: `sha256:${hex};v=3` });
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/RPCS DISAGREE/);
  });
  test('DNS encoding: lowercases the name and counts label length in bytes', () => {
    const r = spawnSync('bash', [SCRIPT, '--dns-only', 'Ünï.ETH'], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe(`0x05${Buffer.from('ünï').toString('hex')}0365746800`);
  });
});
