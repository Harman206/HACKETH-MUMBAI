import { expect, test } from 'vitest';
import { watcherCompose } from '../src/watcher';
import { loaded, WATCHER } from './helpers';

test('compose from the config: names, watcher address pin, 3 RPCs, hardened container, no key inside', () => {
  const l = loaded({ watcher: { key: WATCHER, candidates: ['https://demoswap-rewards.example'], intervalMs: 20_000 } });
  const { compose, envExample } = watcherCompose(l, l.dir);
  expect(compose).toContain('WATCH_NAMES: "demoswap-blackout.eth"');
  expect(compose).toContain(`WATCHER_ADDRESS: "${WATCHER}"`);
  expect(compose).toContain('CANDIDATES: "demoswap-blackout.eth=https://demoswap-rewards.example"');
  expect(compose).toMatch(/RPCS: "https:[^"]+,https:[^"]+,https:[^"]+"/);
  expect(compose).toContain('dockerfile: apps/watcher/Dockerfile');
  expect(compose).toMatch(/read_only: true[\s\S]*no-new-privileges/);
  expect(compose).not.toMatch(/WATCHER_KEY/);
  expect(envExample).toMatch(/^WATCHER_KEY=$/m);
  expect(() => watcherCompose(loaded({ watcher: undefined }), l.dir)).toThrow(/add watcher/);
});
