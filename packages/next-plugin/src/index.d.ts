import type { PluginOptions } from '@copeybara/fingerprint/build';
import { type CompilerLike } from '@copeybara/webpack-plugin';
interface NextConfigLike {
    distDir?: string;
    output?: string;
    webpack?: (config: WebpackConfigLike, ctx: {
        isServer: boolean;
        dir: string;
        dev: boolean;
    }) => WebpackConfigLike;
    [k: string]: unknown;
}
interface WebpackConfigLike {
    plugins?: {
        apply(c: CompilerLike): void;
    }[];
    [k: string]: unknown;
}
/**
 * Next.js: fingerprints the client bundles of a production build (.next/static) and fails the build on a problem.
 *
 * A site fingerprint lists every script a page may run. The App Router streams per-request inline scripts, which no
 * fixed list can cover, so the extension would show the site as unverifiable. Use `output: 'export'` and run
 * `copeybara fingerprint --dist out` after `next build` for a record that covers the HTML too.
 */
export declare function withCopeybara(next?: NextConfigLike, o?: PluginOptions): NextConfigLike;
export default withCopeybara;
