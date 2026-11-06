import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fingerprintBuild, type PluginOptions } from '@copeybara/fingerprint/build';

/** Minimal slice of Vite's Plugin type, so this package needs no vite dependency. */
interface VitePluginLike {
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
export function copeybara(o: PluginOptions = {}): VitePluginLike {
  let outDir = 'dist';
  return {
    name: 'copeybara-site-fingerprint',
    apply: 'build',
    enforce: 'post',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    async closeBundle() {
      if (!existsSync(outDir)) return; // the build itself failed; nothing to fingerprint
      await fingerprintBuild(outDir, o);
    },
  };
}

export default copeybara;
