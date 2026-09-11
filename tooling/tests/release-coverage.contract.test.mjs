import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

let coverageReport;
beforeAll(async () => {
  ({ coverageReport } = await import(
    /* @vite-ignore */ new URL('../lib/gates.mjs', import.meta.url).href
  ));
});
const owned = [];
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});
const sourceFiles = [
  'lib/control.mjs',
  'scripts/check.mjs',
  'release/contract.mjs',
  'release/nested/helper.mjs',
];
const metric = { total: 1, covered: 1, skipped: 0, pct: 100 };
const total = { lines: metric, statements: metric, functions: metric, branches: metric };

async function fixture({ files = sourceFiles, omitted } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'stara-release-coverage-author-'));
  owned.push(root);
  const pkg = { name: '@stara/tooling', path: join(root, 'tooling') };
  const report = { total };
  for (const file of files) {
    const path = join(pkg.path, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'export const synthetic = true;\n');
    if (file !== omitted) report[path] = total;
  }
  const reportPath = join(root, '.artifacts/coverage/tooling/coverage-summary.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report)}\n`);
  return { runtime: { root }, pkg, reportPath };
}

describe('REL-03 tooling coverage source completeness includes release controls', () => {
  it.each(sourceFiles)(
    'rejects an omitted eligible %s despite complete-looking totals',
    async (omitted) => {
      const f = await fixture({ omitted });
      await expect(coverageReport(f.runtime, f.pkg)).rejects.toThrow(
        `Coverage omitted eligible source: @stara/tooling/${omitted}`,
      );
    },
  );

  it('accepts a complete lib, scripts and nested release inventory without changing totals', async () => {
    const f = await fixture();
    expect(await coverageReport(f.runtime, f.pkg)).toEqual({ target: '@stara/tooling', total });
  });

  it('recognizes release-only tooling source as eligible', async () => {
    const f = await fixture({ files: ['release/nested/helper.mjs'] });
    expect(await coverageReport(f.runtime, f.pkg)).toEqual({ target: '@stara/tooling', total });
  });

  it('retains rejection of a stale complete report', async () => {
    const f = await fixture();
    const previous = await stat(f.reportPath);
    await expect(coverageReport(f.runtime, f.pkg, previous)).rejects.toThrow(
      'Coverage report was not regenerated: @stara/tooling',
    );
  });
});
