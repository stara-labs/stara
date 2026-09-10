export default {
  test: {
    name: 'independent-control-contracts',
    environment: 'node',
    include: ['tooling/tests/**/*.contract.test.mjs'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 1,
    isolate: true,
    cache: false,
    coverage: {
      provider: 'v8',
      include: ['tooling/lib/**/*.mjs', 'tooling/scripts/**/*.mjs'],
      exclude: [],
      thresholds: { lines: 90, branches: 85 },
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: '.coverage',
      reportOnFailure: true,
    },
  },
};
