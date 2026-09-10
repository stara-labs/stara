import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('UI-EVIDENCE-02 invocation and worker use the same retained evidence directory', async ({
  browserName,
}, testInfo) => {
  expect(testInfo.project.name).toBe(browserName);
  const runId = testInfo.config.metadata.runId as string;
  expect(runId).toBe(process.env.STARA_E2E_RUN_ID);
  expect(testInfo.outputDir.split(/[\\/]/)).toContain(runId);
  const path = testInfo.outputPath('invocation-proof.txt');
  writeFileSync(path, `${runId}\n`);
  await testInfo.attach('invocation proof', { path, contentType: 'text/plain' });
});
