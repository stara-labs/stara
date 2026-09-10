import { readFileSync, writeFileSync } from 'node:fs';
import type { FullConfig, FullResult, Reporter, Suite } from '@playwright/test/reporter';

export default class ArtifactReporter implements Reporter {
  constructor(private readonly options: { metadataPath: string }) {}

  private update(fields: Record<string, unknown>) {
    const metadata = JSON.parse(readFileSync(this.options.metadataPath, 'utf8'));
    writeFileSync(
      this.options.metadataPath,
      JSON.stringify({ ...metadata, ...fields }, null, 2) + '\n',
    );
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.update({
      lifecycle: 'running',
      startedAt: new Date().toISOString(),
      tests: suite.allTests().length,
      configuredProjects: config.projects.map((project) => project.name),
    });
  }

  onEnd(result: FullResult) {
    this.update({
      lifecycle: 'finished',
      status: result.status,
      finishedAt: new Date().toISOString(),
    });
  }
}
