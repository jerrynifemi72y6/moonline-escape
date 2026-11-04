import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { target: 'es2019', outDir: 'dist', assetsInlineLimit: 0 } });
