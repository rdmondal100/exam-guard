import { defineConfig } from 'vitest/config';

// Runs every package's tests from the root. Each package also has its own
// `test` script, so `pnpm --filter <pkg> test -- <file>` works.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*', 'tools/*'],
  },
});
