import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const path = 'tooling/lib/policy.mjs';
const source = ts.createSourceFile(
  path,
  readFileSync(path, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const names = new Set(['classifyChanges', 'assertCoverage', 'assertRequiredResults']);
const mutate = source.statements
  .filter((statement) => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text))
  .map((statement) => {
    const start = source.getLineAndCharacterOfPosition(statement.getStart(source));
    const end = source.getLineAndCharacterOfPosition(statement.getEnd());
    return `${path}:${start.line + 1}-${end.line + 1}`;
  });
if (mutate.length !== names.size)
  throw new Error('All three required policy mutation targets must exist');

export default {
  // Stryker 10's Vitest plugin uses pre-Vitest-5 test-name separators.
  testRunner: 'command',
  plugins: [],
  commandRunner: {
    command: `"${process.execPath}" "${vitest}" run --config tooling/tests/vitest.mutation.config.mjs`,
  },
  mutate,
  // Run the bounded policy suite for every mutant; avoid Vitest per-test ID filtering.
  coverageAnalysis: 'off',
  concurrency: 2,
  timeoutMS: 5000,
  dryRunTimeoutMinutes: 2,
  inPlace: false,
  tempDirName: '.artifacts/stryker',
  reporters: ['clear-text', 'json', 'html'],
  jsonReporter: { fileName: '.artifacts/mutation/mutation.json' },
  htmlReporter: { fileName: '.artifacts/mutation/index.html' },
  thresholds: { break: 0 },
  ignorePatterns: [
    '**/*',
    '!package.json',
    '!tooling/lib/policy.mjs',
    '!tooling/tests/policy.contract.test.mjs',
    '!tooling/tests/vitest.mutation.config.mjs',
    '!tooling/tests/stryker.config.mjs',
  ],
};
