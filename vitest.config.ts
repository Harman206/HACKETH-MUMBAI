import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'harness/test/**/*.test.ts', 'replay/ts/**/*.test.ts', 'scripts/**/*.test.ts'],
    environmentMatchGlobs: [['apps/site/test/**', 'jsdom']],
    exclude: ['**/*.fork.test.ts', '**/node_modules/**'],
  },
});
