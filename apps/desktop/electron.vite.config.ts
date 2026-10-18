import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@examguard/shared'] })],
  },
  preload: {
    // A sandboxed preload can only require electron, so shared and zod are bundled in.
    plugins: [externalizeDepsPlugin({ exclude: ['@examguard/shared', 'zod'] })],
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer') } },
    plugins: [react(), tailwindcss()],
  },
});
