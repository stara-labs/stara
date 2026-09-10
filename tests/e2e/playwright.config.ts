import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { artifactPaths, reserveArtifactRun } from './artifact-run';

const baseURL = process.env.STARA_E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const run = artifactPaths(resolve('tests/e2e/.artifacts'), process.env.STARA_E2E_RUN_ID);
// Playwright workers reload this config and inherit the parent's invocation ID.
process.env.STARA_E2E_RUN_ID = run.runId;
if (!(process.send && process.env.TEST_WORKER_INDEX !== undefined)) {
  reserveArtifactRun(run, {
    baseURL,
    externalServers: process.env.STARA_EXTERNAL_SERVERS === '1',
    arguments: process.argv.slice(2),
  });
}

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  metadata: { runId: run.runId },
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    [resolve('tests/e2e/artifact-reporter.ts'), { metadataPath: run.metadata }],
    [
      'html',
      {
        outputFolder: run.report,
        open: 'never',
      },
    ],
  ],
  outputDir: run.results,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
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
  webServer:
    process.env.STARA_EXTERNAL_SERVERS === '1'
      ? undefined
      : [
          {
            command: 'node dist/index.js',
            cwd: resolve('backend/api'),
            env: { HOST: '127.0.0.1', PORT: '4174' },
            url: 'http://127.0.0.1:4174/api/health',
            reuseExistingServer: false,
          },
          {
            command:
              'node ../../node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort',
            cwd: resolve('UI/web'),
            env: { API_PROXY_TARGET: 'http://127.0.0.1:4174' },
            url: 'http://127.0.0.1:4173',
            reuseExistingServer: false,
          },
        ],
});
