import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const testRoot = dirname(fileURLToPath(import.meta.url));
const authorRoot = resolve(testRoot, '../..');
const { values } = parseArgs({
  options: {
    source: { type: 'string', default: authorRoot },
    dependencies: { type: 'string', default: authorRoot },
    label: { type: 'string', default: 'contract-run' },
    coverage: { type: 'boolean', default: false },
    'workflow-source': { type: 'string' },
    'config-source': { type: 'string' },
    'test-file': { type: 'string' },
    'test-name': { type: 'string' },
  },
});
if (!/^[a-z0-9-]+$/.test(values.label))
  throw new Error('Evidence label must use lowercase letters, digits, and hyphens');
if (values['test-file'] && !/^[a-z-]+\.contract\.test\.mjs$/.test(values['test-file']))
  throw new Error('Test filter must name one owned contract test file');
const sourceRoot = resolve(values.source);
const modules = resolve(values.dependencies, 'node_modules');
const vitestCli = join(modules, 'vitest/vitest.mjs');
const timestamp = new Date().toISOString();
const evidenceRoot = join(
  testRoot,
  'evidence',
  `${timestamp.replaceAll(':', '-')}-${values.label}`,
);

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function sourceHashes(root, prefix = '') {
  const hashes = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (['evidence', 'node_modules', '.git'].includes(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(hashes, await sourceHashes(root, path));
    else if (entry.isFile()) hashes[path] = await digest(join(root, path));
  }
  return hashes;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function cleanupHarness(harness) {
  const actualTemp = await realpath(tmpdir());
  const actualHarness = await realpath(harness);
  const child = relative(actualTemp, actualHarness);
  if (
    !child ||
    isAbsolute(child) ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    !actualHarness.split(sep).at(-1).startsWith('stara-control-run-')
  ) {
    throw new Error(`Refusing cleanup outside the owned temporary harness: ${actualHarness}`);
  }
  await rm(actualHarness, { recursive: true, force: true });
}

await mkdir(evidenceRoot, { recursive: true });
const record = {
  timestamp,
  authorRoot,
  sourceRoot,
  dependencyRoot: resolve(values.dependencies),
  platform: process.platform,
  node: process.version,
  tests: await sourceHashes(testRoot),
  production: {},
  status: 'harness-blocked',
};

// Version preflight distinguishes missing test infrastructure from red controls.
const preflight = spawnSync(process.execPath, [vitestCli, '--version'], {
  encoding: 'utf8',
  timeout: 15_000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
});
record.vitestVersion = preflight.stdout?.trim() || null;
if (
  preflight.error ||
  preflight.status !== 0 ||
  !/vitest\/5\.0\./.test(record.vitestVersion ?? '')
) {
  record.harnessError = preflight.error?.message ?? preflight.stderr ?? 'Vitest 5.0 unavailable';
  await writeFile(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
  process.stderr.write(
    `HARNESS BLOCKED: Vitest 5.0 must run before red evidence is valid.\n${record.harnessError}\n`,
  );
  process.exitCode = 2;
} else {
  const harness = await mkdtemp(join(tmpdir(), 'stara-control-run-'));
  try {
    await mkdir(join(harness, 'tooling'), { recursive: true });
    await cp(testRoot, join(harness, 'tooling/tests'), {
      recursive: true,
      filter: (path) =>
        !relative(testRoot, path)
          .split(sep)
          .some((part) => ['evidence', 'node_modules'].includes(part)),
    });
    for (const folder of ['lib', 'scripts']) {
      const source = join(sourceRoot, 'tooling', folder);
      if (await exists(source)) {
        await cp(source, join(harness, 'tooling', folder), { recursive: true });
        const hashes = await sourceHashes(join(harness, 'tooling', folder));
        for (const [name, hash] of Object.entries(hashes))
          record.production[`tooling/${folder}/${name}`] = hash;
      }
    }
    await symlink(
      modules,
      join(harness, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const workflowSource = join(
      resolve(values['workflow-source'] ?? sourceRoot),
      '.github/workflows/checks.yml',
    );
    if (await exists(workflowSource)) {
      await mkdir(join(harness, '.github/workflows'), { recursive: true });
      await cp(workflowSource, join(harness, '.github/workflows/checks.yml'));
      record.production['.github/workflows/checks.yml'] = await digest(
        join(harness, '.github/workflows/checks.yml'),
      );
    }
    for (const name of ['eslint.config.mjs', '.npmrc', 'pnpm-workspace.yaml']) {
      const source = join(resolve(values['config-source'] ?? sourceRoot), name);
      if (await exists(source)) {
        await cp(source, join(harness, name));
        record.production[name] = await digest(join(harness, name));
      }
    }
    await writeFile(join(harness, 'package.json'), '{"private":true,"type":"module"}\n');
    record.status = 'running';
    record.command = [
      process.execPath,
      vitestCli,
      'run',
      '--root',
      harness,
      '--config',
      join(harness, 'tooling/tests/vitest.contract.config.mjs'),
      '--reporter=verbose',
      '--reporter=json',
      `--outputFile.json=${join(harness, 'report.json')}`,
      ...(values.coverage ? ['--coverage'] : []),
      ...(values['test-file'] ? [`tooling/tests/${values['test-file']}`] : []),
      ...(values['test-name'] ? ['--testNamePattern', values['test-name']] : []),
    ];
    await writeFile(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
    const run = spawnSync(record.command[0], record.command.slice(1), {
      cwd: harness,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const rawLog = `${run.stdout ?? ''}\n${run.stderr ?? ''}${run.error ? `\nPROCESS ERROR: ${run.error.message}\n` : ''}`;
    await writeFile(join(evidenceRoot, 'vitest.log'), rawLog);
    if (await exists(join(harness, '.coverage'))) {
      await cp(join(harness, '.coverage'), join(evidenceRoot, 'coverage'), { recursive: true });
    }
    if (await exists(join(harness, 'report.json'))) {
      await cp(join(harness, 'report.json'), join(evidenceRoot, 'vitest.json'));
      const report = JSON.parse(await readFile(join(harness, 'report.json'), 'utf8'));
      record.counts = {
        tests: report.numTotalTests,
        passed: report.numPassedTests,
        failed: report.numFailedTests,
        pending: report.numPendingTests,
        suites: report.numTotalTestSuites,
        failedSuites: report.numFailedTestSuites,
      };
    }
    record.exitCode = run.status;
    record.signal = run.signal;
    record.processError = run.error?.message ?? null;
    record.status =
      run.error || !record.counts?.tests ? 'harness-error' : run.status === 0 ? 'green' : 'red';
    record.redScope =
      record.status === 'red'
        ? record.counts.failed
          ? 'test-failures'
          : 'suite-setup-failures-no-behavior-exercised'
        : null;
    record.completedAt = new Date().toISOString();
    record.logSha256 = await digest(join(evidenceRoot, 'vitest.log'));
    await writeFile(join(evidenceRoot, 'manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
    process.stdout.write(
      `${JSON.stringify({ evidenceRoot, status: record.status, counts: record.counts }, null, 2)}\n`,
    );
    process.exitCode = record.status === 'green' ? 0 : record.status === 'red' ? 1 : 2;
  } finally {
    await cleanupHarness(harness);
  }
}
