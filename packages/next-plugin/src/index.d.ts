import type { PluginOptions } from '@copeybara/fingerprint/build';
import type { CompilerLike } from '@copeybara/webpack-plugin';

export interface NextConfigLike {
  distDir?: string;
  output?: string;
  webpack?: (config: WebpackConfigLike, ctx: { isServer: boolean; dir: string; dev: boolean }) => WebpackConfigLike;
  [k: string]: unknown;
}
export interface WebpackConfigLike {
  plugins?: { apply(c: CompilerLike): void }[];
  [k: string]: unknown;
}

/**
 * Next.js: fingerprints the client bundles of a production build (.next/static) and fails the build on a problem.
 * Use `output: 'export'` and `copeybara fingerprint --dist out` for a record that also covers the HTML.
 */
export declare function withCopeybara(next?: NextConfigLike, o?: PluginOptions): NextConfigLike;
export default withCopeybara;
