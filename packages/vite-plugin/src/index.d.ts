import type { PluginOptions } from '@copeybara/fingerprint/build';

/** Minimal slice of Vite's Plugin type, so this package needs no vite dependency. */
export interface VitePluginLike {
  name: string;
  apply: 'build';
  enforce: 'post';
  configResolved(c: { root: string; build: { outDir: string } }): void;
  closeBundle(): Promise<void>;
}

/**
 * After `vite build`: write dist/.well-known/copeybara-site.json, print / append the CI summary (diff against the live
 * org.copeybara.site when `ens` is set) and fail the build on an unpinned third-party script. Never publishes.
 */
export declare function copeybara(o?: PluginOptions): VitePluginLike;
export default copeybara;
