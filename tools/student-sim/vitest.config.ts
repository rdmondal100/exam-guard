import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'student-sim',
    include: ['src/**/*.test.ts'],
  },
});
