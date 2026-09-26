import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run through one seam: the Supabase JS client against the local stack
// (`supabase start`). Nothing mocks the database.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
