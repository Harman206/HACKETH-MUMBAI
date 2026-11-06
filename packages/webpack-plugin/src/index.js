import { loadFingerprintBuild } from '@copeybara/fingerprint/load';

/**
 * After webpack emits: fingerprint output.path (or `dist`), write .well-known/copeybara-site.json, print / append the
 * CI summary, and add a compilation error on an unpinned third-party script so the build fails. Never publishes.
 * Plain JS: webpack and Next.js load their config with plain Node.
 */
export class CopeybaraWebpackPlugin {
  /** @param {import('@copeybara/fingerprint/build').PluginOptions & { dist?: string }} [o] */
  constructor(o = {}) {
    this.o = o;
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise('CopeybaraWebpackPlugin', async (compilation) => {
      const dist = this.o.dist ?? compiler.options.output.path;
      if (!dist) {
        compilation.errors.push(new Error('copeybara: no output.path to fingerprint'));
        return;
      }
      try {
        const { fingerprintBuild } = await loadFingerprintBuild();
        await fingerprintBuild(dist, this.o);
      } catch (e) {
        compilation.errors.push(e);
      }
    });
  }
}

export default CopeybaraWebpackPlugin;
