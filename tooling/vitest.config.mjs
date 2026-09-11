import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.mjs', 'scripts/**/*.mjs', 'release/**/*.mjs'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: '../.artifacts/coverage/tooling',
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
