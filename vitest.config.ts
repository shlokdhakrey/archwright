import { defineConfig } from 'vitest/config';

/**
 * The suite runs in Node's runtime, which — like the Workers runtime — provides
 * the Web Streams API, `DecompressionStream('deflate-raw')`, `fetch`, Web Crypto
 * and `TextEncoder`/`TextDecoder` as globals. The application code depends only
 * on these standards and takes its side-effecting collaborators (the origin
 * fetcher, the cache, the clock) through explicit dependency injection, so the
 * real handler code is exercised end-to-end without the `workerd` pool.
 *
 * An optional `workerd`-backed configuration is provided in
 * `vitest.workers.config.ts` for teams that want to additionally assert behavior
 * inside the production runtime; see `docs/troubleshooting.md`.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // Worker entry shell (exercised in the deployed runtime)
        'src/types/**', // type-only declarations
        'src/**/index.ts', // re-export barrels (no logic)
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
