import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
let eslint;
beforeAll(() => {
  eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.mjs') });
});

describe('ESLint artifact isolation: retained reports do not become authored source', () => {
  it.each([
    '.artifacts/synthetic-failed-run/report/trace/assets/trace.js',
    'tests/e2e/.artifacts/synthetic-failed-run/report/trace/assets/trace.js',
  ])('ignores generated report assets at %s', async (path) => {
    expect(await eslint.isPathIgnored(join(root, path))).toBe(true);
  });

  it.each([
    'UI/web/src/main.tsx',
    'tooling/lib/policy.mjs',
    'tooling/tests/eslint.contract.test.mjs',
    'tests/e2e/application.spec.ts',
  ])('continues to lint authored source and tests at %s', async (path) => {
    expect(await eslint.isPathIgnored(join(root, path))).toBe(false);
  });
});
