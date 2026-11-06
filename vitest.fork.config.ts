import { defineConfig } from 'vitest/config';

/** Fork tests: spawn anvil against MAINNET_RPC / SEPOLIA_RPC. Run with `pnpm test:fork`. */
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.fork.test.ts', 'replay/ts/**/*.fork.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
