import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Code that branches on the app kind (M52) sees the student app under test.
  define: { __EG_APP__: JSON.stringify('student') },
  test: {
    name: 'desktop',
    include: ['src/**/*.test.ts'],
  },
});
