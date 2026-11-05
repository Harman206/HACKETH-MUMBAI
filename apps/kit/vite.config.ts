import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** One self-contained HTML file: no chunks, no preload polyfill, no external assets. */
export default defineConfig({
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
