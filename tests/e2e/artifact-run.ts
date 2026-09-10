import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function artifactPaths(root: string, runId = `run-${randomUUID()}`) {
  if (!/^run-[a-z0-9][a-z0-9_-]{0,79}$/.test(runId)) {
    throw new Error(
      'STARA_E2E_RUN_ID must be run- followed by 1-80 lowercase letters, digits, underscores or hyphens.',
    );
  }
  const directory = resolve(root, runId);
  return {
    runId,
    directory,
    results: join(directory, 'results'),
    report: join(directory, 'report'),
    metadata: join(directory, 'run.json'),
  };
}

export type ArtifactRun = ReturnType<typeof artifactPaths>;

export function reserveArtifactRun(
  run: ArtifactRun,
  details: {
    baseURL: string;
    externalServers: boolean;
    arguments: string[];
  },
) {
  mkdirSync(resolve(run.directory, '..'), { recursive: true });
  // Exclusive creation rejects a reused ID before Playwright cleans outputDir.
  mkdirSync(run.directory);
  writeFileSync(
    run.metadata,
    JSON.stringify(
      {
        runId: run.runId,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        lifecycle: 'configured',
        serverMode: details.externalServers ? 'external' : 'compiled-api-and-preview',
        baseURL: details.baseURL,
        arguments: details.arguments,
        results: 'results',
        report: 'report',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
}
