import { join } from 'node:path';
import { CopeybaraWebpackPlugin } from '@copeybara/webpack-plugin';

/**
 * Next.js: fingerprints the client bundles of a production build (.next/static) and fails the build on a problem.
 * Plain JS: Next.js loads next.config.{js,mjs} with plain Node.
 *
 * A site fingerprint lists every script a page may run. The App Router streams per-request inline scripts, which no
 * fixed list can cover, so the extension would show the site as unverifiable. Use `output: 'export'` and run
 * `copeybara fingerprint --dist out` after `next build` for a record that covers the HTML too.
 */
export function withCopeybara(next = {}, o = {}) {
  return {
    ...next,
    webpack(config, ctx) {
      const c = next.webpack ? next.webpack(config, ctx) : config;
      if (!ctx.isServer && !ctx.dev) {
        const dist = join(ctx.dir, next.distDir ?? '.next', 'static');
        c.plugins = [...(c.plugins ?? []), new CopeybaraWebpackPlugin({ ...o, dist, writeWellKnown: false })];
      }
      return c;
    },
  };
}

export default withCopeybara;
