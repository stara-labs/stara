import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@stara/ui/styles': fileURLToPath(new URL('../shared/src/styles.css', import.meta.url)),
      '@stara/ui': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      reportsDirectory: '../../.artifacts/coverage/web',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
