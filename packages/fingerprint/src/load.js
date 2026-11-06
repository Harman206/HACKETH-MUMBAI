/**
 * Plain-JS door into the build-time fingerprint, for bundler plugins. Vite, webpack and Next.js load their config (and
 * so the plugin) with plain Node, which cannot run this repository's TypeScript sources; tsx loads them here, once.
 */
let pending;

/** @returns {Promise<typeof import('./build')>} */
export function loadFingerprintBuild() {
  pending ??= import('tsx/esm/api').then(({ tsImport }) => tsImport('./build.ts', import.meta.url));
  return pending;
}
