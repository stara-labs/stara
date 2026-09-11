import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { artifactPaths, reserveArtifactRun } from './artifact-run';

const baseURL = process.env.STARA_E2E_BASE_URL ?? 'http://127.0.0.1:8173';
const url = new URL(baseURL);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') {
  throw new Error('Release image verification requires its isolated loopback origin');
}
const run = artifactPaths(resolve('tests/e2e/.artifacts'), process.env.STARA_E2E_RUN_ID);
process.env.STARA_E2E_RUN_ID = run.runId;
if (!(process.send && process.env.TEST_WORKER_INDEX !== undefined)) {
  reserveArtifactRun(run, {
    baseURL,
    externalServers: true,
    arguments: process.argv.slice(2),
  });
}

export default defineConfig({
  testDir: '.',
  testMatch: [
    'shell.spec.ts',
    'accessibility.spec.ts',
    'tokens.spec.ts',
    'staging-runtime.spec.ts',
  ],
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  metadata: { runId: run.runId, scope: 'production-style images; synthetic data; no live IAM' },
  reporter: [
    ['list'],
    [resolve('tests/e2e/artifact-reporter.ts'), { metadataPath: run.metadata }],
    ['html', { outputFolder: run.report, open: 'never' }],
  ],
  outputDir: run.results,
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
