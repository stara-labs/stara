import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FullConfig, Suite } from '@playwright/test/reporter';
import { artifactPaths, reserveArtifactRun } from '../../../../tests/e2e/artifact-run';
import ArtifactReporter from '../../../../tests/e2e/artifact-reporter';

const root = resolve('.artifacts/retention-unit');
mkdirSync(root, { recursive: true });
const directory = () => mkdtempSync(join(root, 'proof-'));
const details = { baseURL: 'http://127.0.0.1:4173', externalServers: false, arguments: ['test'] };

describe('UI-EVIDENCE-01 isolated invocation artifacts', () => {
  it('allocates two different runs and preserves earlier evidence', () => {
    const root = directory();
    const first = artifactPaths(root);
    reserveArtifactRun(first, details);
    mkdirSync(first.results);
    writeFileSync(join(first.results, 'trace-proof.txt'), 'earlier evidence');
    const second = artifactPaths(root);
    reserveArtifactRun(second, details);
    expect(first.runId).not.toBe(second.runId);
    expect(first.results).not.toBe(second.results);
    expect(first.report).not.toBe(second.report);
    expect(readFileSync(join(first.results, 'trace-proof.txt'), 'utf8')).toBe('earlier evidence');
    expect(JSON.parse(readFileSync(first.metadata, 'utf8'))).toMatchObject({
      runId: first.runId,
      lifecycle: 'configured',
      serverMode: 'compiled-api-and-preview',
    });
  });

  it('rejects reused IDs before touching existing results or metadata', () => {
    const run = artifactPaths(directory(), 'run-functional');
    reserveArtifactRun(run, details);
    const before = readFileSync(run.metadata, 'utf8');
    expect(() => reserveArtifactRun(run, details)).toThrow();
    expect(readFileSync(run.metadata, 'utf8')).toBe(before);
  });

  it('rejects traversal, absolute paths, reserved names and ambiguous IDs', () => {
    for (const id of [
      '../run-escape',
      'run-../escape',
      'run-..\\escape',
      'C:\\run-escape',
      '/run-escape',
      'CON',
      'run-',
      'run-upperCase',
      'run-id ',
      'run-' + 'a'.repeat(81),
    ]) {
      expect(() => artifactPaths(directory(), id)).toThrow(/STARA_E2E_RUN_ID/);
    }
  });

  it('records the configured, running and finished lifecycle without changing run identity', () => {
    const run = artifactPaths(directory(), 'run-accessibility');
    reserveArtifactRun(run, {
      ...details,
      externalServers: true,
      arguments: ['test', '--grep', '@accessibility'],
    });
    const reporter = new ArtifactReporter({ metadataPath: run.metadata });
    reporter.onBegin(
      { projects: [{ name: 'chromium' }] } as FullConfig,
      { allTests: () => [{}, {}] } as Suite,
    );
    expect(JSON.parse(readFileSync(run.metadata, 'utf8'))).toMatchObject({
      runId: run.runId,
      lifecycle: 'running',
      tests: 2,
      serverMode: 'external',
    });
    reporter.onEnd({ status: 'failed', startTime: new Date(), duration: 10 });
    expect(JSON.parse(readFileSync(run.metadata, 'utf8'))).toMatchObject({
      runId: run.runId,
      lifecycle: 'finished',
      status: 'failed',
      configuredProjects: ['chromium'],
    });
  });
});
