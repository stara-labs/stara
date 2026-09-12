import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../lib/process.mjs';
import { materializeIndex } from '../lib/snapshot.mjs';
import {
  cleanupFixtures,
  emptyWorkspace,
  git,
  passed,
  workspace,
  write,
  writeJson,
} from './fixtures.mjs';

let codeql;
let policy;
beforeAll(async () => {
  const moduleUrl = new URL('../lib/codeql.mjs', import.meta.url);
  ({ codeql } = await import(/* @vite-ignore */ moduleUrl.href));
  policy = JSON.parse(await readFile(new URL('../codeql/baseline.json', import.meta.url), 'utf8'));
});
afterEach(cleanupFixtures);

const cleanSarif = () => ({
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'CodeQL', semanticVersion: '2.27.0', rules: [] } },
      results: [],
    },
  ],
});

function option(args, name) {
  const explicit = args.find((arg) => arg.startsWith(`${name}=`));
  return explicit ? explicit.slice(name.length + 1) : args[args.indexOf(name) + 1];
}

async function fixture({ sourceRoot, mutate, failure, noReport = false } = {}) {
  const root = sourceRoot ?? (await workspace());
  await writeJson(root, 'tooling/codeql/baseline.json', { ...policy, findings: [] });
  const executable = await write(await emptyWorkspace(), 'codeql.exe', 'Synthetic executable');
  const observedSource = [];
  const run = vi.fn(async (_command, args, options) => {
    if (args[0] === 'version') {
      if (failure === 'version') throw new Error('Synthetic executable is missing');
      return passed(JSON.stringify({ version: failure === 'wrong-version' ? '2.0.0' : '2.27.0' }));
    }
    if (args[0] === 'database' && args[1] === 'create') {
      if (failure === 'create') throw new Error('Synthetic database creation failed');
      const src = option(args, '--source-root');
      observedSource.push({
        root: src,
        code: await readFile(join(src, 'backend/api/src/index.js'), 'utf8'),
        options,
      });
    }
    if (args[0] === 'database' && args[1] === 'analyze') {
      if (failure === 'analyze') throw new Error('Synthetic query execution failed');
      if (!noReport) {
        const sarif = cleanSarif();
        if (mutate) mutate(sarif);
        const output = option(args, '--output');
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, JSON.stringify(sarif));
      }
    }
    return passed();
  });
  const runtime = createRuntime({
    root,
    run,
    env: { STARA_CODEQL_CLI: executable },
    pnpmPath: join(root, 'pnpm.mjs'),
    output: vi.fn(),
    runId: 'codeql-runner-contract',
  });
  return { root, runtime, run, observedSource };
}

describe('local CodeQL runner: real command orchestration with synthetic process responses', () => {
  it.each(['schema', 'commit', 'cli', 'javascript-pack', 'actions-pack'])(
    'rejects baseline %s metadata drift before invoking the analyzer',
    async (mutation) => {
      const { root, runtime, run } = await fixture();
      const candidate = { ...structuredClone(policy), findings: [] };
      if (mutation === 'schema') candidate.version = 2;
      if (mutation === 'commit') candidate.sourceCommit = 'unverified';
      if (mutation === 'cli') candidate.cliVersion = '2.26.0';
      if (mutation === 'javascript-pack')
        candidate.queryPacks['codeql/javascript-queries'] = '2.4.4';
      if (mutation === 'actions-pack') candidate.queryPacks['codeql/actions-queries'] = '0.6.34';
      await writeJson(root, 'tooling/codeql/baseline.json', candidate);
      await expect(codeql(runtime)).rejects.toThrow(/baseline.*pinned analyzer/i);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('retains both SARIF files and summary in the gate evidence after temporary cleanup', async () => {
    const { root, runtime, observedSource } = await fixture();
    const summary = await codeql(runtime);
    const evidence = join(root, '.artifacts/gates', runtime.runId, 'codeql');
    for (const language of ['javascript-typescript', 'actions']) {
      const sarif = JSON.parse(await readFile(join(evidence, `${language}.sarif`), 'utf8'));
      expect(sarif.runs[0].tool.driver.name).toBe('CodeQL');
      expect(sarif.runs[0].results).toEqual([]);
    }
    const saved = JSON.parse(await readFile(join(evidence, 'summary.json'), 'utf8'));
    expect(saved).toMatchObject({
      ...summary,
      cliVersion: '2.27.0',
      baselineCommit: policy.sourceCommit,
    });
    await expect(stat(observedSource[0].root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('runs pinned extended analysis for JavaScript and Actions with both threat models', async () => {
    const { root, runtime, run, observedSource } = await fixture();
    await codeql(runtime);
    const creates = run.mock.calls.filter(([, args]) => args[1] === 'create');
    const analyses = run.mock.calls.filter(([, args]) => args[1] === 'analyze');
    expect(creates).toHaveLength(2);
    expect(analyses).toHaveLength(2);
    expect(creates.map(([, args]) => option(args, '--language')).sort()).toEqual([
      'actions',
      'javascript-typescript',
    ]);
    for (const [, args, options] of analyses) {
      expect(args.some((arg) => arg.includes('security-extended.qls'))).toBe(true);
      expect(args).toContain('--threat-model=remote');
      expect(args).toContain('--threat-model=local');
      expect(option(args, '--format')).toMatch(/^sarif/);
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(1_800_000);
    }
    const suites = analyses.flatMap(([, args]) => args).join(' ');
    for (const [pack, version] of Object.entries(policy.queryPacks))
      expect(suites).toContain(`${pack}@${version}:`);
    for (const source of observedSource) {
      expect(source.root).not.toBe(root);
      expect(isAbsolute(source.root)).toBe(true);
      expect(source.code).toContain('fixture = true');
    }
  });

  it.each(['version', 'wrong-version', 'create', 'analyze'])(
    'fails closed when the real CLI cannot complete %s',
    async (failure) => {
      const { runtime } = await fixture({ failure });
      await expect(codeql(runtime)).rejects.toThrow();
    },
  );

  it('requires fresh SARIF output even when the process returns success', async () => {
    const { runtime } = await fixture({ noReport: true });
    await expect(codeql(runtime)).rejects.toThrow();
  });

  it('rejects malformed SARIF after successful query execution', async () => {
    const { runtime } = await fixture({ mutate: (sarif) => delete sarif.runs });
    await expect(codeql(runtime)).rejects.toThrow();
  });

  it('rejects a successful analyzer report that omits actual results', async () => {
    const { runtime } = await fixture({ mutate: (sarif) => delete sarif.runs[0].results });
    await expect(codeql(runtime)).rejects.toThrow(/results.*missing/i);
  });

  it('rejects a newly detected security finding even when the process succeeds', async () => {
    const { root, runtime } = await fixture({
      mutate: (sarif) => {
        sarif.runs[0].tool.driver.rules = [{ id: 'js/request-forgery' }];
        sarif.runs[0].results = [
          {
            ruleId: 'js/request-forgery',
            ruleIndex: 0,
            level: 'warning',
            message: { text: 'Synthetic SSRF finding' },
            partialFingerprints: { primaryLocationLineHash: 'synthetic-new-finding:1' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'backend/api/src/index.js' },
                  region: { startLine: 1 },
                },
              },
            ],
          },
        ];
      },
    });
    await expect(codeql(runtime)).rejects.toThrow();
    const evidence = join(root, '.artifacts/gates', runtime.runId, 'codeql');
    const saved = JSON.parse(await readFile(join(evidence, 'summary.json'), 'utf8'));
    expect(saved.newFindings).toHaveLength(2);
    expect(saved.newFindings[0].ruleId).toBe('js/request-forgery');
  });

  it('extracts staged bytes even when an unstaged repair exists in the checkout', async () => {
    const repo = await workspace({ gitRepository: true });
    const path = 'backend/api/src/index.js';
    await write(repo, path, 'export const syntheticStagedFinding = true;\n');
    git(repo, 'add', path);
    await write(repo, path, 'export const syntheticUnstagedRepair = true;\n');
    const destination = join(await emptyWorkspace(), 'snapshot');
    await materializeIndex(repo, destination);
    const { runtime, observedSource } = await fixture({ sourceRoot: destination });
    await codeql(runtime);
    expect(observedSource).toHaveLength(2);
    for (const source of observedSource) {
      expect(source.code).toContain('syntheticStagedFinding');
      expect(source.code).not.toContain('syntheticUnstagedRepair');
      expect(relative(repo, source.root).startsWith('..')).toBe(true);
    }
    expect(await readFile(join(repo, path), 'utf8')).toContain('syntheticUnstagedRepair');
  });
});
