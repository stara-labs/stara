import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const testRoot = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    dependencies: { type: 'string' },
    label: { type: 'string', default: 'stryker-policy' },
  },
});
if (!values.source || !values.dependencies || !/^[a-z0-9-]+$/.test(values.label))
  throw new Error('Provide --source, --dependencies, and a safe evidence label');
const source = resolve(values.source);
const dependencies = resolve(values.dependencies);
const evidence = join(
  testRoot,
  'evidence',
  `${new Date().toISOString().replaceAll(':', '-')}-${values.label}`,
);
const harness = await mkdtemp(join(await realpath(tmpdir()), 'stara-control-stryker-'));
const hash = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');

async function cleanup() {
  const parent = await realpath(tmpdir());
  const target = await realpath(harness);
  const child = relative(parent, target);
  if (
    !child ||
    isAbsolute(child) ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    !target.split(sep).at(-1).startsWith('stara-control-stryker-')
  )
    throw new Error('Refusing unsafe mutation-harness cleanup');
  await rm(target, { recursive: true, force: true });
}

try {
  await mkdir(evidence, { recursive: true });
  await mkdir(join(harness, 'tooling/lib'), { recursive: true });
  await mkdir(join(harness, 'tooling/tests'), { recursive: true });
  await cp(join(source, 'tooling/lib/policy.mjs'), join(harness, 'tooling/lib/policy.mjs'));
  await cp(join(dependencies, 'package.json'), join(harness, 'package.json'));
  for (const file of [
    'policy.contract.test.mjs',
    'stryker.config.mjs',
    'vitest.mutation.config.mjs',
  ])
    await cp(join(testRoot, file), join(harness, 'tooling/tests', file));
  await symlink(
    join(dependencies, 'node_modules'),
    join(harness, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const manifest = {
    tool: 'StrykerJS',
    version: JSON.parse(
      await readFile(join(dependencies, 'node_modules/@stryker-mutator/core/package.json'), 'utf8'),
    ).version,
    runnerVersion: JSON.parse(
      await readFile(
        join(dependencies, 'node_modules/@stryker-mutator/vitest-runner/package.json'),
        'utf8',
      ),
    ).version,
    node: process.version,
    platform: process.platform,
    startedAt: new Date().toISOString(),
    sourceHashes: { 'tooling/lib/policy.mjs': await hash(join(harness, 'tooling/lib/policy.mjs')) },
    testHashes: Object.fromEntries(
      await Promise.all(
        ['policy.contract.test.mjs', 'stryker.config.mjs', 'vitest.mutation.config.mjs'].map(
          async (file) => [file, await hash(join(harness, 'tooling/tests', file))],
        ),
      ),
    ),
  };
  await writeFile(join(evidence, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const cli = join(dependencies, 'node_modules/@stryker-mutator/core/bin/stryker.js');
  const result = spawnSync(process.execPath, [cli, 'run', 'tooling/tests/stryker.config.mjs'], {
    cwd: harness,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 600_000,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
  await writeFile(join(evidence, 'stryker.log'), log);
  manifest.exitCode = result.status;
  manifest.processError = result.error?.message ?? null;
  manifest.logSha256 = await hash(join(evidence, 'stryker.log'));
  try {
    const reportPath = join(harness, '.artifacts/mutation/mutation.json');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    await cp(join(harness, '.artifacts/mutation'), join(evidence, 'mutation'), { recursive: true });
    const mutants = Object.values(report.files).flatMap((file) => file.mutants);
    manifest.counts = mutants.reduce(
      (counts, mutant) => ({ ...counts, [mutant.status]: (counts[mutant.status] ?? 0) + 1 }),
      {},
    );
    manifest.survivors = mutants
      .filter((mutant) => ['Survived', 'NoCoverage'].includes(mutant.status))
      .map(({ id, mutatorName, location, replacement, status }) => ({
        id,
        mutatorName,
        location,
        replacement,
        status,
      }));
    manifest.reportSha256 = await hash(reportPath);
  } catch (error) {
    manifest.reportError = error.message;
  }
  manifest.completedAt = new Date().toISOString();
  await writeFile(join(evidence, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ evidence: evidence.split(sep).at(-1), exitCode: manifest.exitCode, counts: manifest.counts, reportError: manifest.reportError }, null, 2)}\n`,
  );
  process.exitCode = result.status === 0 && manifest.counts ? 0 : 1;
} finally {
  await cleanup();
}
