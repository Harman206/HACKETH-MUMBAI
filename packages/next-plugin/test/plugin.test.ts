import { describe, expect, test } from 'vitest';
import { withCopeybara } from '../src';

const quiet = { log: () => {} };

describe('@copeybara/next-plugin', () => {
  test('adds the plugin to the client production compiler only, and keeps the user webpack hook', () => {
    const user = (c: { plugins?: unknown[] }) => ({ ...c, marked: true });
    const cfg = withCopeybara({ webpack: user as never }, quiet);
    const client = cfg.webpack!({ plugins: [] }, { isServer: false, dev: false, dir: '/app' });
    const server = cfg.webpack!({ plugins: [] }, { isServer: true, dev: false, dir: '/app' });
    const dev = cfg.webpack!({ plugins: [] }, { isServer: false, dev: true, dir: '/app' });
    expect(client.marked).toBe(true);
    expect(client.plugins).toHaveLength(1);
    expect(server.plugins).toHaveLength(0);
    expect(dev.plugins).toHaveLength(0);
  });
});
