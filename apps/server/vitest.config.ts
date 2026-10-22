import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // One server and database per file; keep files sequential so they don't fight over ports or Postgres.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
