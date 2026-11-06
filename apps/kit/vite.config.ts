import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Always a production build, whoever calls it (vitest sets NODE_ENV=test, which makes the Preact preset
// emit dev JSX with absolute source paths — machine-dependent bytes, so a different sha256 than published).
process.env.NODE_ENV = 'production';

/** One self-contained HTML file: no chunks, no preload polyfill, no external assets. */
export default defineConfig({
  mode: 'production',
  plugins: [preact(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: false,
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
