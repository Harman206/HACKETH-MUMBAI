import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KIT = join(__dirname, '..');
const REPO = join(KIT, '..', '..');
const FILE = join(KIT, 'dist', 'blackout-kit.html');
const CSP_PREFIX = "default-src 'none'; script-src 'sha256-";
const CSP_SUFFIX = "'; style-src 'unsafe-inline'; connect-src https: wss: http://127.0.0.1:* http://localhost:*; img-src data:";

let html = '';
beforeAll(() => {
  execFileSync('pnpm', ['build'], { cwd: KIT, env: { ...process.env, SOURCE_DATE_EPOCH: '0' }, stdio: 'pipe' });
  html = readFileSync(FILE, 'utf8');
}, 120_000);

describe('single-file kit build', () => {
  test('exactly one inline script, no external script/link/img sources', () => {
    expect(html.match(/<script\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/);
    expect(html).not.toMatch(/<link[^>]*href=["']?https?:/);
    expect(html).not.toMatch(/<img[^>]*src=["']?https?:/);
  });

  test('CSP meta is the first element in <head> and pins the script hash', () => {
    const m = html.match(/<head>\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    expect(m).not.toBeNull();
    const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]!;
    const hash = createHash('sha256').update(script, 'utf8').digest('base64');
    expect(m![1]).toBe(`${CSP_PREFIX}${hash}${CSP_SUFFIX}`);
  });

  test('size under 1 MB', () => {
    expect(Buffer.byteLength(html)).toBeLessThan(1_000_000);
  });

  test('sha256 file matches the build', () => {
    const line = readFileSync(`${FILE}.sha256`, 'utf8');
    const hex = createHash('sha256').update(readFileSync(FILE)).digest('hex');
    expect(line).toBe(`${hex}  blackout-kit.html\n`);
  });

  test('two builds give the same sha256', () => {
    const out = execFileSync('node', ['scripts/check-repro.mjs'], { cwd: KIT, encoding: 'utf8' });
    expect(out).toMatch(/^REPRODUCIBLE [0-9a-f]{64}/m);
  }, 240_000);

  test('verify-kit.sh: MATCH on the real file, MISMATCH after one flipped byte', () => {
    const hex = createHash('sha256').update(readFileSync(FILE)).digest('hex');
    const env = { ...process.env, BLACKOUT_RELEASE_OVERRIDE: `sha256:${hex};v=7` };
    const ok = spawnSync('bash', [join(REPO, 'scripts/verify-kit.sh'), FILE, 'demoswap-blackout.eth'], { env, encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/MATCH v=7/);

    const tampered = join(mkdtempSync(join(tmpdir(), 'kit-')), 'blackout-kit.html');
    const buf = readFileSync(FILE);
    buf[Math.floor(buf.length / 2)] ^= 0x01;
    writeFileSync(tampered, buf);
    const bad = spawnSync('bash', [join(REPO, 'scripts/verify-kit.sh'), tampered, 'demoswap-blackout.eth'], { env, encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/MISMATCH expected [0-9a-f]{64} got [0-9a-f]{64}/);
  });
});
