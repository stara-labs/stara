import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  test: {
    projects: ['unit', 'integration'].map((name) => ({
      test: {
        name,
        root,
        environment: 'node',
        include: [`tests/${name}/**/*.test.ts`],
        restoreMocks: true,
        testTimeout: 10_000,
        hookTimeout: 10_000,
      },
    })),
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [],
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      reportsDirectory: fileURLToPath(new URL('../../.artifacts/coverage/api/', import.meta.url)),
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
