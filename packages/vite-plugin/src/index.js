import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFingerprintBuild } from '@copeybara/fingerprint/load';

/**
 * After `vite build`: write dist/.well-known/copeybara-site.json, print / append the CI summary (diff against the live
 * org.copeybara.site when `ens` is set) and fail the build on an unpinned third-party script. Never publishes.
 * Plain JS: Vite imports this from vite.config.ts with plain Node.
 *
 * @param {import('@copeybara/fingerprint/build').PluginOptions} [o]
 */
export function copeybara(o = {}) {
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
      const { fingerprintBuild } = await loadFingerprintBuild();
      await fingerprintBuild(outDir, o);
    },
  };
}

export default copeybara;
