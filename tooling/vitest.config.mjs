import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { defineConfig } from 'vitest/config';

// macOS exposes its temporary directory through the system `/var` symlink.
// Give control tests the canonical root so symlink-safety checks evaluate test
// fixtures rather than rejecting the operating system's trusted path alias.
process.env.TMPDIR = realpathSync(tmpdir());

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.mjs', 'scripts/**/*.mjs'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: '../.artifacts/coverage/tooling',
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
