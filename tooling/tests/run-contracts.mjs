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

async function copySourceTree(source, destination, accept) {
  if (!(await exists(source))) return;
  if (!(await lstat(source)).isDirectory())
    throw new Error('Contract source directories must not be symbolic links');
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['node_modules', '.git', '.artifacts', '.terraform', 'evidence'].includes(entry.name))
      continue;
    if (entry.isSymbolicLink()) throw new Error('Contract source must not contain symbolic links');
    if (entry.isDirectory()) {
      await copySourceTree(join(source, entry.name), join(destination, entry.name), accept);
    } else if (entry.isFile() && accept(entry.name)) {
      await mkdir(destination, { recursive: true });
      await cp(join(source, entry.name), join(destination, entry.name));
    }
  }
}

async function assertSourceContained(root, source) {
  const child = relative(await realpath(root), await realpath(source));
  if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`))
    throw new Error('Contract input must stay inside its configured source root');
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
  const harness = await mkdtemp(join(await realpath(tmpdir()), 'stara-control-run-'));
  try {
    async function copyRecordedFile(root, path) {
      const source = join(root, path);
      if (!(await exists(source))) return;
      await assertSourceContained(root, source);
      if (!(await lstat(source)).isFile())
        throw new Error('Contract source files must not be symbolic links');
      await mkdir(dirname(join(harness, path)), { recursive: true });
      await cp(source, join(harness, path));
      record.production[path] = await digest(join(harness, path));
    }
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
    for (const [folder, accept] of [
      [
        'tooling/release',
        (name) => name.endsWith('.mjs') || ['Dockerfile', 'Dockerfile.dockerignore'].includes(name),
      ],
      [
        'infra/gcp',
        (name) =>
          /(?:\.tf|\.tftest\.hcl)$/.test(name) ||
          ['.terraform.lock.hcl', 'README.md', 'terraform.tfvars.example'].includes(name),
      ],
    ]) {
      const destination = join(harness, folder);
      if (await exists(join(sourceRoot, folder)))
        await assertSourceContained(sourceRoot, join(sourceRoot, folder));
      await copySourceTree(join(sourceRoot, folder), destination, accept);
      if (await exists(destination)) {
        for (const [name, hash] of Object.entries(await sourceHashes(destination)))
          record.production[`${folder}/${name}`] = hash;
      }
    }
    await symlink(
      modules,
      join(harness, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const toolingModules = resolve(values.dependencies, 'tooling/node_modules');
    if (await exists(toolingModules))
      await symlink(
        toolingModules,
        join(harness, 'tooling/node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    for (const name of ['checks', 'release', 'dispatch']) {
      const path = `.github/workflows/${name}.yml`;
      await copyRecordedFile(resolve(values['workflow-source'] ?? sourceRoot), path);
    }
    for (const name of [
      'eslint.config.mjs',
      '.npmrc',
      'pnpm-workspace.yaml',
      'package.json',
      'tooling/vitest.config.mjs',
    ]) {
      await copyRecordedFile(resolve(values['config-source'] ?? sourceRoot), name);
    }
    for (const path of [
      'compose.yaml',
      'tests/e2e/release.compose.yaml',
      'tests/e2e/release.config.ts',
      'tests/e2e/artifact-run.ts',
      'tests/e2e/release-nginx.conf',
      ...['UI/web', 'backend/api'].flatMap((owner) =>
        ['Dockerfile', 'release.Dockerfile', 'release.Dockerfile.dockerignore'].map(
          (name) => `${owner}/${name}`,
        ),
      ),
    ]) {
      await copyRecordedFile(sourceRoot, path);
    }
    if (!(await exists(join(harness, 'package.json'))))
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
