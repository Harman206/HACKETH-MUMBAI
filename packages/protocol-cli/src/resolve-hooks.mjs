/**
 * Node module hooks for loading copeybara.config.ts from anywhere (a protocol's own repo, the repo root, a temp dir):
 * `@copeybara/protocol-cli` and the other `@copeybara/*` packages resolve to this CLI's own copies when the config's
 * directory cannot resolve them itself.
 */
const SELF = new URL('./index.ts', import.meta.url).href;
const PARENT = new URL('./main.ts', import.meta.url).href;

export async function resolve(specifier, context, next) {
  // The config is always ESM, even in a directory whose package.json does not say "type": "module".
  if (specifier.includes('?copeybara-config')) return { ...(await next(specifier, context)), format: 'module' };
  if (!specifier.startsWith('@copeybara/')) return next(specifier, context);
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    if (specifier === '@copeybara/protocol-cli') return next(SELF, { ...context, parentURL: PARENT });
    return next(specifier, { ...context, parentURL: PARENT });
  }
}
