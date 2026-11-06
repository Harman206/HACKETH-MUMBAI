import { fingerprintBuild, type PluginOptions } from '@copeybara/fingerprint/build';

/** The parts of webpack's Compiler this plugin touches (structural, so no webpack dependency). */
export interface CompilerLike {
  options: { output: { path?: string } };
  hooks: { afterEmit: { tapPromise(name: string, fn: (compilation: { errors: unknown[] }) => Promise<void>): void } };
}

/**
 * After webpack emits: fingerprint output.path (or `dist`), write .well-known/copeybara-site.json, print / append the
 * CI summary, and add a compilation error on an unpinned third-party script so the build fails. Never publishes.
 */
export class CopeybaraWebpackPlugin {
  constructor(private readonly o: PluginOptions & { dist?: string } = {}) {}

  apply(compiler: CompilerLike) {
    compiler.hooks.afterEmit.tapPromise('CopeybaraWebpackPlugin', async (compilation) => {
      const dist = this.o.dist ?? compiler.options.output.path;
      if (!dist) {
        compilation.errors.push(new Error('copeybara: no output.path to fingerprint'));
        return;
      }
      try {
        await fingerprintBuild(dist, this.o);
      } catch (e) {
        compilation.errors.push(e);
      }
    });
  }
}

export default CopeybaraWebpackPlugin;
