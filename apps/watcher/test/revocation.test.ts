import { describe, expect, test } from 'vitest';
import type { CopeybaraRecords } from '@copeybara/ens';
import { scriptHash } from '@copeybara/sitecheck';
import { createWatcher, isRoleRevoked, type WatcherDeps } from '../src/watcher';

const NAME = 'demoswap-blackout.eth';
const SITE = 'http://demoswap.localhost:8080/';
const APP = 'console.log("app")';
const OK_HTML = '<html><script src="/app.js"></script></html>';
const HIJACK_HTML = '<html><script src="/app.js"></script><script src="/inject.js"></script></html>';

/** What viem throws when eth_estimateGas hits the resolver's role check (shape trimmed to what matters). */
function eacError(): Error {
  const inner = Object.assign(new Error('The contract function "setText" reverted.\n\nError: EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account)'), {
    name: 'ContractFunctionRevertedError',
    data: { errorName: 'EACUnauthorizedAccountRoles', args: [1n, 16n, '0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8'] },
  });
  return Object.assign(new Error('Execution reverted for an unknown reason.'), { name: 'ContractFunctionExecutionError', cause: inner });
}

function world() {
  let html = OK_HTML;
  let granted = true;
  const writes: string[] = [];
  let attempts = 0;
  let roleChecks = 0;
  const logs: string[] = [];
  const deps: WatcherDeps = {
    names: [NAME],
    readRecords: async (name) =>
      ({ name, url: SITE, site: [await scriptHash(APP)], status: { state: 'ok' }, blocklist: [], resolver: '0x2222222222222222222222222222222222222222' }) as unknown as CopeybaraRecords,
    fetchText: async (url) => {
      if (url === SITE) return { ok: true, status: 200, text: async () => html };
      if (url.endsWith('/app.js')) return { ok: true, status: 200, text: async () => APP };
      if (url.endsWith('/inject.js')) return { ok: true, status: 200, text: async () => 'drain()' };
      return { ok: false, status: 404, text: async () => '' };
    },
    writeText: async (_n, _r, key, value) => {
      attempts++;
      if (!granted) throw eacError();
      writes.push(`${key}=${value}`);
      return '0xabc';
    },
    now: () => 1_793_965_507_000,
    log: (l) => logs.push(l),
  };
  return {
    deps,
    writes,
    logs,
    attempts: () => attempts,
    roleChecks: () => roleChecks,
    hijack: () => (html = HIJACK_HTML),
    revoke: () => (granted = false),
    regrant: () => (granted = true),
    withRoleCheck: (): WatcherDeps => ({
      ...deps,
      canWrite: async () => {
        roleChecks++;
        return granted;
      },
    }),
  };
}

describe('isRoleRevoked', () => {
  test('recognises the EAC error by name, through the cause chain', () => {
    expect(isRoleRevoked(eacError())).toBe(true);
  });
  test('recognises the raw selector when the ABI did not decode it', () => {
    expect(isRoleRevoked(new Error('execution reverted: 0x4b27a133000000000000000000000000'))).toBe(true);
  });
  test('ordinary failures are not revocations', () => {
    expect(isRoleRevoked(new Error('nonce too low'))).toBe(false);
    expect(isRoleRevoked(new Error('EACCannotGrantRoles'))).toBe(false);
    expect(isRoleRevoked(undefined)).toBe(false);
  });
});

describe('watcher: the Safe revokes its ENS role', () => {
  test('first EAC revert → stands down: logs it, revoked=true, stops attempting writes', async () => {
    const w = world();
    const watcher = createWatcher(w.deps);
    w.revoke();
    w.hijack();
    await watcher.tick();
    await watcher.tick(); // second mismatch → tries to raise → EAC revert
    expect(w.attempts()).toBe(1);
    const s = watcher.state()[NAME]!;
    expect(s.revoked).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ kind: 'revoked', detail: 'my ENS role was revoked by the Safe; standing down' });
    expect(w.logs).toContain('revoked: my ENS role was revoked by the Safe; standing down');
    for (let i = 0; i < 5; i++) await watcher.tick();
    expect(w.attempts()).toBe(1); // no retries
    expect(s.verdict).toBe('mismatch'); // still watching, still reporting in /status
    expect(watcher.revoked()).toBe(true);
  });
  test('a non-EAC failure is still retried (unchanged behaviour)', async () => {
    const w = world();
    let fail = 1;
    const watcher = createWatcher({
      ...w.deps,
      writeText: async () => {
        if (fail-- > 0) throw new Error('nonce too low');
        return '0x1';
      },
    });
    w.hijack();
    await watcher.tick();
    await watcher.tick();
    await watcher.tick();
    expect(watcher.state()[NAME]!.revoked).toBe(false);
    expect(watcher.state()[NAME]!.events.at(-1)).toMatchObject({ kind: 'raised' });
  });
  test('with a role check: a key that was never granted (or revoked before start) stands down without sending', async () => {
    const w = world();
    w.revoke();
    const watcher = createWatcher(w.withRoleCheck());
    w.hijack();
    for (let i = 0; i < 3; i++) await watcher.tick();
    expect(w.attempts()).toBe(0);
    expect(watcher.state()[NAME]!.revoked).toBe(true);
  });
  test('with a role check: after the Safe re-grants, the watcher resumes and raises the pending alarm', async () => {
    const w = world();
    const watcher = createWatcher(w.withRoleCheck());
    w.revoke();
    w.hijack();
    await watcher.tick();
    await watcher.tick();
    expect(watcher.state()[NAME]!.revoked).toBe(true);
    w.regrant();
    await watcher.tick();
    const s = watcher.state()[NAME]!;
    expect(s.revoked).toBe(false);
    expect(s.events.map((e) => e.kind)).toContain('restored');
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]).toMatch(/^org\.copeybara\.status=v=1;state=compromised/);
  });
  test('the role is checked only while revoked (no extra RPC reads in the normal case)', async () => {
    const w = world();
    const watcher = createWatcher(w.withRoleCheck());
    for (let i = 0; i < 4; i++) await watcher.tick();
    expect(w.roleChecks()).toBe(1); // once, on the first tick
  });
});
