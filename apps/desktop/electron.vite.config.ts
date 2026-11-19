import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Two apps from one codebase (M52): `--mode teacher` or `--mode student` picks the app.
 * `__EG_APP__` is a compile-time constant, so the other app's code is dropped from every bundle.
 */
export default defineConfig(({ mode }) => {
  if (mode !== 'teacher' && mode !== 'student') {
    throw new Error(`Build with --mode teacher or --mode student (got "${mode}").`);
  }
  const student = mode === 'student';
  const define = { __EG_APP__: JSON.stringify(mode) };
  return {
    main: {
      define,
      plugins: [externalizeDepsPlugin({ exclude: ['@examguard/shared'] })],
      // Split chunks sit next to index.js: main code finds files relative to its own folder.
      build: { rollupOptions: { output: { chunkFileNames: '[name]-[hash].js' } } },
    },
    preload: {
      define,
      // A sandboxed preload can only require electron, so shared and zod are bundled in.
      plugins: [externalizeDepsPlugin({ exclude: ['@examguard/shared', 'zod'] })],
      build: {
        rollupOptions: {
          // The app's preload, and (student) the hidden live view capture page's own (M34).
          input: {
            index: resolve(__dirname, 'src/preload/index.ts'),
            ...(student ? { live: resolve(__dirname, 'src/preload/live.ts') } : {}),
          },
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    },
    renderer: {
      define,
      root: resolve(__dirname, 'src/renderer'),
      resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
      plugins: [react(), tailwindcss()],
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            ...(student ? { live: resolve(__dirname, 'src/renderer/live.html') } : {}),
          },
        },
      },
    },
  };
});
