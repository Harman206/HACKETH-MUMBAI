import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, 'verify-extension.sh');
const BUILD = join(__dirname, '..', 'apps/extension/scripts/build.mjs');
const out = mkdtempSync(join(tmpdir(), 've-'));
let TREE = '';
let ZIP = '';
const DIR = join(out, 'chrome');
const ZIPFILE = join(out, 'copeybara-extension-chrome.zip');

beforeAll(() => {
  // a separate output dir: the extension's own build test rebuilds apps/extension/dist in parallel
  execFileSync('node', [BUILD], { env: { ...process.env, EXTENSION_OUT_DIR: out }, stdio: 'pipe' });
  TREE = readFileSync(join(out, 'copeybara-extension-chrome.tree.sha256'), 'utf8').split(' ')[0]!;
  ZIP = readFileSync(join(out, 'copeybara-extension-chrome.zip.sha256'), 'utf8').split(' ')[0]!;
}, 120_000);

const records = (a: string, b = a, c = a) => ({ COPEYBARA_EXTENSION_OVERRIDE_1: a, COPEYBARA_EXTENSION_OVERRIDE_2: b, COPEYBARA_EXTENSION_OVERRIDE_3: c });
const run = (args: string[], env: Record<string, string> = {}) => spawnSync('bash', [SCRIPT, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

describe('verify-extension.sh: an installed folder or the zip vs org.copeybara.extension (3 RPCs)', () => {
  test('--tree-only prints the same tree hash the build wrote (shell = node = worker algorithm)', () => {
    const r = run(['--tree-only', DIR]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(TREE);
  });
  test('unpacked folder, record with tree → MATCH', () => {
    const r = run([DIR, 'demoswap-blackout.eth'], records(`sha256:${ZIP};v=3;tree=${TREE}`));
    expect(r.stdout).toMatch(new RegExp(`MATCH v=3 tree=${TREE}`));
    expect(r.status).toBe(0);
  });
  test('Finder .DS_Store files are ignored', () => {
    const d = join(mkdtempSync(join(tmpdir(), 've-ds-')), 'chrome');
    cpSync(DIR, d, { recursive: true });
    writeFileSync(join(d, '.DS_Store'), 'x');
    writeFileSync(join(d, 'assets', '.DS_Store'), 'x');
    expect(run([d], records(`sha256:${ZIP};v=3;tree=${TREE}`)).status).toBe(0);
  });
  test('zip, record with tree → MATCH on both the zip bytes and the tree', () => {
    const r = run([ZIPFILE], records(`sha256:${ZIP};v=3;tree=${TREE}`));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`MATCH v=3 tree=${TREE} zip=${ZIP}`));
  });
  test('zip, old record (zip hash only) → MATCH on the zip', () => {
    const r = run([ZIPFILE], records(`sha256:${ZIP};v=2`));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`MATCH v=2 zip=${ZIP}`));
  });
  test('folder, old record → exit 2 (a folder can only be checked against a tree hash)', () => {
    const r = run([DIR], records(`sha256:${ZIP};v=2`));
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/OLD RECORD/);
  });
  test('one changed file → MISMATCH, exit 1', () => {
    const d = join(mkdtempSync(join(tmpdir(), 've-t-')), 'chrome');
    cpSync(DIR, d, { recursive: true });
    writeFileSync(join(d, 'background.js'), readFileSync(join(d, 'background.js'), 'utf8') + '\n// drain()');
    const r = run([d], records(`sha256:${ZIP};v=3;tree=${TREE}`));
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`MISMATCH tree expected ${TREE} got [0-9a-f]{64}`));
  });
  test('an added file → MISMATCH', () => {
    const d = join(mkdtempSync(join(tmpdir(), 've-a-')), 'chrome');
    cpSync(DIR, d, { recursive: true });
    writeFileSync(join(d, 'extra.js'), 'x');
    expect(run([d], records(`sha256:${ZIP};v=3;tree=${TREE}`)).status).toBe(1);
  });
  test('RPCs disagree → exit 3; only one answers → exit 3', () => {
    const r = run([DIR], records(`sha256:${ZIP};v=3;tree=${TREE}`, `sha256:${ZIP};v=3;tree=${'ee'.repeat(32)}`));
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/RPCS DISAGREE/);
    const r2 = run([DIR], records(`sha256:${ZIP};v=3;tree=${TREE}`, 'UNREACHABLE', 'UNREACHABLE'));
    expect(r2.status).toBe(3);
    expect(r2.stdout).toMatch(/TOO FEW RPCS/);
  });
  test('no record / malformed record → exit 2', () => {
    const none = run([DIR], records(''));
    expect(none.status).toBe(2);
    expect(none.stdout).toMatch(/NO EXTENSION RECORD/);
    const r = run([DIR], records('sha256:zz;v=1'));
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/BAD EXTENSION RECORD/);
  });
});

describe('verify-extension.sh --rebuild: the current checkout rebuilds to the same bytes', () => {
  test('zip → REBUILD MATCH (zip bytes and tree)', () => {
    const r = run(['--rebuild', ZIPFILE]);
    expect(r.stdout).toMatch(new RegExp(`REBUILD MATCH tree=${TREE} zip=${ZIP}`));
    expect(r.status).toBe(0);
  }, 120_000);
  test('changed folder → REBUILD MISMATCH, exit 4; with an ENS name it also checks the record', () => {
    const d = join(mkdtempSync(join(tmpdir(), 've-r-')), 'chrome');
    cpSync(DIR, d, { recursive: true });
    writeFileSync(join(d, 'content.js'), 'x');
    const r = run(['--rebuild', d]);
    expect(r.status).toBe(4);
    expect(r.stdout).toMatch(/REBUILD MISMATCH/);
    const ok = run(['--rebuild', DIR, 'demoswap-blackout.eth'], records(`sha256:${ZIP};v=3;tree=${TREE}`));
    expect(ok.stdout).toMatch(/REBUILD MATCH[\s\S]*MATCH v=3/);
    expect(ok.status).toBe(0);
  }, 120_000);
});
