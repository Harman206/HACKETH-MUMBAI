import { join } from 'node:path';
import type { PluginOptions } from '@copeybara/fingerprint/build';
import { CopeybaraWebpackPlugin, type CompilerLike } from '@copeybara/webpack-plugin';

interface NextConfigLike {
  distDir?: string;
  output?: string;
  webpack?: (config: WebpackConfigLike, ctx: { isServer: boolean; dir: string; dev: boolean }) => WebpackConfigLike;
  [k: string]: unknown;
}
interface WebpackConfigLike {
  plugins?: { apply(c: CompilerLike): void }[];
  [k: string]: unknown;
}

/**
 * Next.js: fingerprints the client bundles of a production build (.next/static) and fails the build on a problem.
 *
 * A site fingerprint lists every script a page may run. The App Router streams per-request inline scripts, which no
 * fixed list can cover, so the extension would show the site as unverifiable. Use `output: 'export'` and run
 * `copeybara fingerprint --dist out` after `next build` for a record that covers the HTML too.
 */
export function withCopeybara(next: NextConfigLike = {}, o: PluginOptions = {}): NextConfigLike {
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
