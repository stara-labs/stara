import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { assertUnlinked, listFiles, ownedTemporary } from './files.mjs';
import { safeRelativePath } from './policy.mjs';

const version = '2.27.0';
const queryPacks = {
  'codeql/javascript-queries': '2.4.5',
  'codeql/actions-queries': '0.6.35',
};

function requireValue(condition, message) {
  if (!condition) throw new Error(`CodeQL: ${message}`);
}

function findingPath(uri) {
  requireValue(typeof uri === 'string', 'missing result path');
  const path = decodeURIComponent(uri).replaceAll('\\', '/');
  requireValue(safeRelativePath(path), 'result path is outside the source snapshot');
  return path;
}

const identity = (entry) => JSON.stringify([entry.ruleId, entry.path, entry.fingerprint]);

/** A baseline admits only the recorded number of occurrences of each exact finding. */
export function inspectSarif(report, baseline = []) {
  requireValue(Array.isArray(baseline), 'invalid finding baseline');
  const remaining = new Map();
  for (const entry of baseline) {
    requireValue(
      entry &&
        typeof entry.ruleId === 'string' &&
        entry.ruleId.length > 0 &&
        typeof entry.fingerprint === 'string' &&
        entry.fingerprint.length > 0 &&
        Number.isInteger(entry.count) &&
        entry.count > 0,
      'invalid baseline identity or count',
    );
    findingPath(entry.path);
    const key = identity(entry);
    requireValue(!remaining.has(key), 'duplicate baseline identity');
    remaining.set(key, entry.count);
  }
  requireValue(
    report?.version === '2.1.0' && Array.isArray(report.runs) && report.runs.length > 0,
    'missing or invalid SARIF runs',
  );
  const summary = { findings: 0, baselineFindings: 0, newFindings: [] };
  for (const run of report.runs) {
    requireValue(run.tool?.driver?.name === 'CodeQL', 'unexpected analysis tool');
    requireValue(Array.isArray(run.results), 'analysis results are missing');
    if (run.invocations !== undefined) {
      requireValue(
        Array.isArray(run.invocations) &&
          run.invocations.length > 0 &&
          run.invocations.every((invocation) => invocation.executionSuccessful === true),
        'analysis did not complete successfully',
      );
    }
    for (const result of run.results) {
      const componentIndex = result.rule?.toolComponent?.index;
      const component =
        componentIndex === undefined ? run.tool.driver : run.tool.extensions?.[componentIndex];
      const index = result.rule?.index ?? result.ruleIndex;
      const rule =
        index === undefined
          ? component?.rules?.find((candidate) => candidate.id === result.ruleId)
          : component?.rules?.[index];
      requireValue(
        rule && typeof result.ruleId === 'string' && rule.id === result.ruleId,
        'invalid finding rule reference',
      );
      const level = result.level ?? rule.defaultConfiguration?.level ?? 'warning';
      requireValue(['none', 'note', 'warning', 'error'].includes(level), 'invalid result severity');
      const location = result.locations?.[0]?.physicalLocation;
      const path = findingPath(location?.artifactLocation?.uri);
      requireValue(
        Number.isInteger(location.region?.startLine) && location.region.startLine > 0,
        'missing result line',
      );
      if (level === 'none' || level === 'note') continue;
      const finding = {
        ruleId: result.ruleId,
        path,
        fingerprint: result.partialFingerprints?.primaryLocationLineHash ?? '',
        line: location.region.startLine,
      };
      summary.findings++;
      const key = identity(finding);
      const allowance = remaining.get(key) ?? 0;
      if (allowance > 0) {
        remaining.set(key, allowance - 1);
        summary.baselineFindings++;
      } else {
        summary.newFindings.push(finding);
      }
    }
  }
  return summary;
}

/** Invoked inside the existing isolated index by check:commit. Never uploads results. */
export async function codeql(runtime) {
  const policy = JSON.parse(
    await readFile(join(runtime.root, 'tooling/codeql/baseline.json'), 'utf8'),
  );
  requireValue(
    policy.version === 1 &&
      /^[a-f0-9]{40}$/.test(policy.sourceCommit) &&
      policy.cliVersion === version &&
      JSON.stringify(policy.queryPacks) === JSON.stringify(queryPacks),
    'baseline does not match the pinned analyzer and suites',
  );
  const executable =
    runtime.env.STARA_CODEQL_CLI ??
    join(
      runtime.root,
      '.artifacts/tools/codeql-2.27.0/codeql',
      process.platform === 'win32' ? 'codeql.exe' : 'codeql',
    );
  requireValue(isAbsolute(executable), 'STARA_CODEQL_CLI must be an absolute executable path');
  let actual;
  try {
    actual = JSON.parse(
      (await runtime.run(executable, ['version', '--format=json'], { timeout: 30000 })).stdout,
    );
  } catch {
    throw new Error(
      'CodeQL 2.27.0 is required. See tooling/codeql/README.md for installation and STARA_CODEQL_CLI.',
    );
  }
  requireValue(actual.version === version, `expected CLI ${version}`);
  return ownedTemporary(async (temporary) => {
    const source = join(temporary, 'source');
    await mkdir(source);
    for (const path of await listFiles(runtime.root)) {
      const origin = join(runtime.root, path);
      requireValue((await lstat(origin)).isFile(), 'source must contain regular files only');
      const target = join(source, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(origin, target);
    }
    const evidence = resolve(runtime.root, '.artifacts/gates', basename(runtime.runId), 'codeql');
    await assertUnlinked(evidence);
    await mkdir(evidence, { recursive: true });
    const runs = [];
    for (const [language, pack, suite] of [
      ['javascript-typescript', 'codeql/javascript-queries', 'javascript'],
      ['actions', 'codeql/actions-queries', 'actions'],
    ]) {
      runtime.output(`CodeQL: analyzing ${language} with security-extended (${version})`);
      const database = join(temporary, language);
      const output = join(temporary, `${language}.sarif`);
      await runtime.run(
        executable,
        [
          'database',
          'create',
          database,
          `--language=${language}`,
          `--source-root=${source}`,
          '--build-mode=none',
          '--threads=4',
        ],
        { timeout: 300000 },
      );
      await runtime.run(
        executable,
        [
          'database',
          'analyze',
          database,
          `${pack}@${queryPacks[pack]}:codeql-suites/${suite}-security-extended.qls`,
          '--threat-model=remote',
          '--threat-model=local',
          '--format=sarif-latest',
          `--output=${output}`,
          '--threads=4',
          '--ram=4096',
        ],
        { timeout: 300000 },
      );
      const report = JSON.parse(await readFile(output, 'utf8'));
      inspectSarif(report);
      runs.push(...report.runs);
      const retainedReport = join(evidence, `${language}.sarif`);
      await assertUnlinked(retainedReport);
      await copyFile(output, retainedReport);
    }
    const summary = inspectSarif({ version: '2.1.0', runs }, policy.findings);
    await assertUnlinked(join(evidence, 'summary.json'));
    await writeFile(
      join(evidence, 'summary.json'),
      `${JSON.stringify(
        {
          cliVersion: version,
          baselineCommit: policy.sourceCommit,
          ...summary,
        },
        null,
        2,
      )}\n`,
    );
    requireValue(
      summary.newFindings.length === 0,
      `${summary.newFindings.length} new findings:\n${summary.newFindings
        .map((finding) => `${finding.ruleId} ${finding.path}:${finding.line}`)
        .join('\n')}`,
    );
    runtime.output(
      `CodeQL passed: ${summary.baselineFindings} inherited findings, no new findings.`,
    );
    return summary;
  });
}
