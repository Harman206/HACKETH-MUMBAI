import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

process.env.NODE_ENV = 'production';
export default defineConfig({ plugins: [preact()], mode: 'production', base: './', build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, modulePreload: { polyfill: false } } });
