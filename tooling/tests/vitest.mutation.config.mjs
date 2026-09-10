import { fileURLToPath } from 'node:url';
export default {
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    name: 'protected-policy-mutations',
    environment: 'node',
    cache: false,
    include: ['tooling/tests/policy.contract.test.mjs'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: { enabled: false },
  },
};
