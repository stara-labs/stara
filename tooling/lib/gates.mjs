import { mkdir, readFile, stat } from 'node:fs/promises';
import { delimiter, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntime } from './process.mjs';
import {
  assertUnlinked,
  candidateSourceFiles,
  exists,
  listFiles,
  ownedTemporary,
  readJson,
  within,
} from './files.mjs';
import {
  assertCoverage,
  assertRequiredResults,
  classifyChanges,
  safeRelativePath,
  validateDependencies,
  validateLayout,
} from './policy.mjs';
import { bootstrap } from './bootstrap.mjs';
import { artifact } from './build.mjs';
import {
  fileHashes,
  hashIdentity,
  preserveStagedEvidence,
  sanitize,
  writeEvidence,
} from './evidence.mjs';
import { hashBytes } from './integrity.mjs';

export { artifact } from './build.mjs';

const requiredPackages = ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'];
const coverageDirectories = {
  '@stara/web': 'web',
  '@stara/ui': 'ui',
  '@stara/api': 'api',
  '@stara/tooling': 'tooling',
};

export async function packageInventory(runtime, filters = []) {
  const data = JSON.parse(
    (await runtime.pnpm(['-r', ...filters, 'list', '--depth', '-1', '--json'])).stdout,
  );
  if (!Array.isArray(data) || !data.length) throw new Error('Workspace target inventory is empty');
  const rootManifest = await readJson(join(runtime.root, 'package.json'));
  let rootSeen = false;
  const targets = data.filter((pkg) => {
    if (typeof pkg.path === 'string' && resolve(pkg.path) === runtime.root) {
      if (rootSeen || pkg.name !== rootManifest.name)
        throw new Error('Invalid or duplicate workspace root record');
      rootSeen = true;
      return false;
    }
    return true;
  });
  if (!targets.length) throw new Error('Workspace package inventory is empty');
  const packages = targets.map((pkg) => {
    const relativePath = relative(runtime.root, pkg.path).replaceAll('\\', '/');
    if (
      !pkg.name ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(pkg.name) ||
      !safeRelativePath(relativePath) ||
      !within(runtime.root, pkg.path)
    )
      throw new Error('Invalid workspace target');
    return { ...pkg, relativePath };
  });
  if (new Set(packages.map((pkg) => pkg.name)).size !== packages.length)
    throw new Error('Duplicate workspace target');
  return packages;
}

export async function layout(runtime) {
  const files = await listFiles(runtime.root);
  const packages = await packageInventory(runtime);
  const manifests = [
    { ...(await readJson(join(runtime.root, 'package.json'))), relativePath: '.' },
  ];
  for (const pkg of packages)
    manifests.push({
      ...(await readJson(join(pkg.path, 'package.json'))),
      relativePath: pkg.relativePath,
    });
  const errors = [...validateLayout(files), ...validateDependencies(manifests)];
  if (errors.length) throw new Error(errors.join('\n'));
  return true;
}

export async function selectProposal(runtime, stage) {
  if (!['commit', 'push', 'pr'].includes(stage)) throw new Error('Unknown gate stage');
  const knownPackages = await packageInventory(runtime);
  let baselineAvailable = true;
  let files;
  if (stage === 'commit') {
    files = (await runtime.git(['diff', '--cached', '--name-only', '--no-renames', '-z'])).stdout
      .split('\0')
      .filter(Boolean);
  } else {
    try {
      const base = (await runtime.git(['merge-base', 'origin/main', 'HEAD'])).stdout.trim();
      if (!/^[a-f0-9]{40,64}$/i.test(base)) throw new Error('Invalid merge base');
      files = (
        await runtime.git(['diff', '--name-only', '--no-renames', '-z', base, 'HEAD'])
      ).stdout
        .split('\0')
        .filter(Boolean);
    } catch {
      baselineAvailable = false;
      files = [];
    }
  }
  return {
    ...classifyChanges({ files, knownPackages, baselineAvailable }),
    files,
    baselineAvailable,
    knownPackages,
  };
}

export async function coverageReport(runtime, pkg, previous) {
  const directory =
    coverageDirectories[pkg.name] ?? pkg.name.replace(/^@/, '').replaceAll('/', '-');
  const path = join(runtime.root, '.artifacts/coverage', directory, 'coverage-summary.json');
  await assertUnlinked(path);
  const current = await stat(path);
  if (previous && current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs) {
    throw new Error(`Coverage report was not regenerated: ${pkg.name}`);
  }
  const report = await readJson(path);
  const files = (await listFiles(pkg.path)).filter(
    (file) =>
      (pkg.name === '@stara/tooling'
        ? /^(?:lib|scripts)\/.*\.mjs$/
        : /^src\/.*\.[cm]?[jt]sx?$/
      ).test(file) && !/\.d\.[cm]?ts$/.test(file),
  );
  if (!files.length) throw new Error(`No eligible coverage source files: ${pkg.name}`);
  const keys = new Set(Object.keys(report).map((key) => key.replaceAll('\\', '/')));
  for (const file of files) {
    const absolute = join(pkg.path, file).replaceAll('\\', '/');
    if (!keys.has(absolute))
      throw new Error(`Coverage omitted eligible source: ${pkg.name}/${file}`);
  }
  return { target: pkg.name, total: report.total };
}

export async function mutationReport(runtime, previous) {
  const path = join(runtime.root, '.artifacts/mutation/mutation.json');
  try {
    await assertUnlinked(path);
    const current = await stat(path);
    if (previous && current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs)
      throw new Error('Mutation report was not regenerated');
    const bytes = await readFile(path);
    const report = JSON.parse(bytes.toString());
    if (
      typeof report.schemaVersion !== 'string' ||
      !report.schemaVersion ||
      !report.files ||
      Array.isArray(report.files) ||
      typeof report.files !== 'object'
    )
      throw new Error('Malformed mutation report');
    const files = Object.values(report.files);
    if (!files.length || files.some((file) => !Array.isArray(file?.mutants)))
      throw new Error('Missing mutation inventory');
    const mutants = files.flatMap((file) => file.mutants);
    const completed = new Set([
      'Killed',
      'Survived',
      'Timeout',
      'NoCoverage',
      'CompileError',
      'RuntimeError',
      'Ignored',
    ]);
    if (!mutants.length || mutants.some((mutant) => !completed.has(mutant?.status)))
      throw new Error('Missing or incomplete mutation results');
    return {
      path: '.artifacts/mutation/mutation.json',
      sha256: hashBytes(bytes),
      mutants: mutants.length,
    };
  } catch (cause) {
    throw new Error('Mutation report is missing, stale, malformed, or incomplete', { cause });
  }
}

export async function runGates(runtime, selection, stage = 'pr') {
  if (
    !['commit', 'push', 'pr'].includes(stage) ||
    !['docs', 'affected', 'all'].includes(selection?.mode)
  )
    throw new Error('Unknown gate stage or selection');
  const directory = `.artifacts/gates/${runtime.runId}`;
  await writeEvidence(runtime.root, `${directory}/selection.json`, { stage, ...selection });
  const results = [];
  const recorded = {
    ...runtime,
    pnpm: (args, options) => runtime.pnpm(args, { ...options, record: true }),
  };
  try {
    await executeGates(recorded, selection, stage, results);
    await writeEvidence(runtime.root, `${directory}/results.json`, {
      stage,
      actor: runtime.actor,
      runId: runtime.runId,
      ...(selection.candidate
        ? { candidate: selection.candidate, updates: selection.updates }
        : {}),
      status: 'pass',
      results,
    });
    return results;
  } catch (error) {
    await writeEvidence(runtime.root, `${directory}/results.json`, {
      stage,
      actor: runtime.actor,
      runId: runtime.runId,
      ...(selection.candidate
        ? { candidate: selection.candidate, updates: selection.updates }
        : {}),
      status: 'fail',
      results,
      error: sanitize(error.message, runtime.env, 4096),
    });
    throw error;
  }
}

async function executeGates(runtime, selection, stage, results) {
  const check = async (name, action) => {
    const result = { name, required: true, status: 'pending', durationMs: 0 };
    results.push(result);
    const started = Date.now();
    try {
      const value = await action();
      result.status = 'pass';
      return value;
    } catch (error) {
      result.status = 'fail';
      throw error;
    } finally {
      result.durationMs = Date.now() - started;
    }
  };
  const rootCheck = (name) => check(name, () => runtime.pnpm(['run', name], { timeout: 600000 }));
  await rootCheck('format:check');
  await rootCheck('security:secrets');
  await check('layout', () => layout(runtime));
  if (selection.mode === 'docs' && stage !== 'pr') {
    assertRequiredResults(results);
    return results;
  }
  await rootCheck('tokens:check');
  await rootCheck('lint');
  const inventory = await packageInventory(runtime);
  if (requiredPackages.some((name) => !inventory.some((pkg) => pkg.name === name)))
    throw new Error('Required workspace target is missing');
  let targets;
  if (selection.mode === 'docs') targets = inventory.filter((pkg) => pkg.name === '@stara/tooling');
  else if (selection.mode === 'all') targets = inventory;
  else {
    if (
      !Array.isArray(selection.targets) ||
      !selection.targets.length ||
      selection.targets.some((name) => !inventory.some((pkg) => pkg.name === name))
    )
      throw new Error('Selected workspace target is missing');
    const filters = selection.targets.flatMap((name) => [
      '--filter',
      stage === 'commit' ? name : `...${name}`,
    ]);
    targets = await packageInventory(runtime, [...filters, '--fail-if-no-match']);
    if (selection.targets.some((name) => !targets.some((pkg) => pkg.name === name)))
      throw new Error('Native pnpm selection omitted a required target');
  }
  if (stage === 'pr' && !targets.some((pkg) => pkg.name === '@stara/tooling'))
    targets.push(inventory.find((pkg) => pkg.name === '@stara/tooling'));
  const runTarget = async (pkg, script) => {
    const manifest = await readJson(join(pkg.path, 'package.json'));
    if (!manifest.scripts?.[script]) throw new Error(`${pkg.name} is missing required ${script}`);
    await check(`${pkg.name}:${script}`, () =>
      runtime.pnpm(['--filter', pkg.name, '--fail-if-no-match', 'run', script], {
        timeout: 600000,
      }),
    );
  };
  for (const pkg of targets) {
    if (pkg.name !== '@stara/tooling') await runTarget(pkg, 'typecheck');
    await runTarget(pkg, 'test:unit');
  }
  if (stage === 'commit') {
    assertRequiredResults(results);
    return results;
  }
  const buildTargets = targets.filter((pkg) => ['@stara/web', '@stara/api'].includes(pkg.name));
  if (
    targets.some((pkg) => pkg.name === '@stara/ui') &&
    !buildTargets.some((pkg) => pkg.name === '@stara/web')
  ) {
    buildTargets.push(inventory.find((pkg) => pkg.name === '@stara/web'));
  }
  const browserRequired =
    stage === 'pr' &&
    targets.some((pkg) => ['@stara/web', '@stara/ui', '@stara/api'].includes(pkg.name));
  if (browserRequired) {
    for (const name of ['@stara/web', '@stara/api']) {
      if (!buildTargets.some((pkg) => pkg.name === name))
        buildTargets.push(inventory.find((pkg) => pkg.name === name));
    }
  }
  const buildStarted = Date.now() - 1000;
  for (const pkg of buildTargets) await runTarget(pkg, 'build');
  if (buildTargets.length)
    await check('artifact', () =>
      artifact(
        runtime,
        buildTargets.map((pkg) => pkg.name),
        buildStarted,
      ),
    );
  if (stage === 'push') {
    assertRequiredResults(results);
    return results;
  }
  await rootCheck('security:dependencies');
  const reports = [];
  for (const pkg of targets) {
    if (['@stara/web', '@stara/api', '@stara/tooling'].includes(pkg.name))
      await runTarget(pkg, 'test:integration');
    const directory =
      coverageDirectories[pkg.name] ?? pkg.name.replace(/^@/, '').replaceAll('/', '-');
    const path = join(runtime.root, '.artifacts/coverage', directory, 'coverage-summary.json');
    const previous = (await exists(path)) ? await stat(path) : null;
    await runTarget(pkg, 'test:coverage');
    reports.push(await coverageReport(runtime, pkg, previous));
  }
  await check('coverage', () => assertCoverage(reports));
  if (selection.mode === 'all') {
    const path = join(runtime.root, '.artifacts/mutation/mutation.json');
    const previous = (await exists(path)) ? await stat(path) : null;
    await rootCheck('test:mutation');
    const report = await check('mutation-report', () => mutationReport(runtime, previous));
    results.at(-1).report = report;
  }
  if (browserRequired) {
    await rootCheck('test:e2e');
    await rootCheck('test:a11y');
  }
  assertRequiredResults(results);
  return results;
}

const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const sameCandidate = (left, right) =>
  left && ['commit', 'tree', 'base'].every((key) => left[key] === right[key]);

export function parsePushInput(input) {
  if (typeof input !== 'string' || !input || Buffer.byteLength(input) > 1024 * 1024)
    throw new Error('Missing or oversized pre-push input; no candidate was validated');
  const lines = input.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const destinations = new Set();
  return lines.map((line) => {
    const fields = line.split(/[ \t]+/);
    if (
      fields.length !== 4 ||
      fields.some(
        (field) =>
          !field ||
          /\s/.test(field) ||
          [...field].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
      )
    )
      throw new Error('Malformed pre-push record');
    const [localRef, localOid, remoteRef, remoteOid] = fields;
    if (
      !objectId.test(localOid) ||
      !objectId.test(remoteOid) ||
      localOid.length !== remoteOid.length ||
      !remoteRef.startsWith('refs/')
    )
      throw new Error('Malformed pre-push object or reference');
    if (/^0+$/.test(localOid) || localRef === '(delete)')
      throw new Error('Unsupported pre-push deletion; no candidate was validated');
    if (destinations.has(remoteRef)) throw new Error('Duplicate pre-push destination');
    destinations.add(remoteRef);
    return {
      localRef,
      localOid: localOid.toLowerCase(),
      remoteRef,
      remoteOid: remoteOid.toLowerCase(),
    };
  });
}

async function pushGate(runtime, hookInput) {
  const env = Object.fromEntries(
    Object.entries(runtime.env).filter(([key]) => !/^GIT_/i.test(key)),
  );
  const git = (args) => runtime.git(args, { env: { ...env, GIT_NO_REPLACE_OBJECTS: '1' } });
  const updates =
    hookInput === undefined
      ? [
          {
            localRef: 'HEAD',
            localOid: (await git(['rev-parse', '--verify', 'HEAD'])).stdout.trim(),
          },
        ]
      : parsePushInput(hookInput);
  const commits = [...new Set(updates.map((update) => update.localOid))];
  // Validate the entire outgoing proposal before any materialization, installation, or gate.
  for (const commit of commits) {
    if (
      !objectId.test(commit) ||
      (await git(['cat-file', '-t', commit])).stdout.trim() !== 'commit'
    )
      throw new Error('Unsupported pre-push object; an existing commit object is required');
  }
  let baseline;
  try {
    baseline = (await git(['rev-parse', '--verify', 'refs/remotes/origin/main'])).stdout.trim();
    if (
      !objectId.test(baseline) ||
      (await git(['cat-file', '-t', baseline])).stdout.trim() !== 'commit'
    )
      throw new Error('Unusable proposal baseline');
  } catch {
    baseline = null;
  }
  const proposals = [];
  for (const commit of commits) {
    const tree = (await git(['rev-parse', `${commit}^{tree}`])).stdout.trim();
    if (!objectId.test(tree)) throw new Error('Outgoing commit tree is invalid');
    let base = null;
    let files = [];
    if (baseline) {
      try {
        base = (await git(['merge-base', baseline, commit])).stdout.trim();
        if (!objectId.test(base)) throw new Error('Invalid proposal merge base');
        files = (await git(['diff', '--name-only', '--no-renames', '-z', base, commit])).stdout
          .split('\0')
          .filter(Boolean);
      } catch {
        base = null;
        files = [];
      }
    }
    proposals.push({
      candidate: { commit, tree, base },
      baseline,
      baselineAvailable: base !== null,
      files,
      updates: updates.filter((update) => update.localOid === commit),
    });
  }
  const results = [];
  let failure;
  const directory = `.artifacts/gates/${runtime.runId}`;
  if (proposals.length > 1)
    await writeEvidence(runtime.root, `${directory}/selection.json`, {
      stage: 'push',
      candidates: proposals.map((proposal) => proposal.candidate),
      updates,
    });
  for (const proposal of proposals) {
    const runId =
      proposals.length === 1
        ? runtime.runId
        : `${runtime.runId.slice(0, 55)}-${proposal.candidate.commit}`;
    const child = { ...runtime, runId };
    const childDirectory = `.artifacts/gates/${runId}`;
    const result = {
      name: proposal.candidate.commit,
      required: true,
      status: 'pending',
      candidate: proposal.candidate,
      runId,
      durationMs: 0,
    };
    results.push(result);
    const started = Date.now();
    await writeEvidence(runtime.root, `${childDirectory}/selection.json`, {
      stage: 'push',
      ...proposal,
    });
    runtime.output(`push: validating ${proposal.candidate.commit}`);
    try {
      await isolatedGate(child, 'push', proposal);
      result.status = 'pass';
    } catch (error) {
      result.status = 'fail';
      failure ??= error;
      const path = join(runtime.root, childDirectory, 'results.json');
      const evidence = (await exists(path)) ? await readJson(path) : {};
      await writeEvidence(runtime.root, `${childDirectory}/results.json`, {
        ...evidence,
        stage: 'push',
        candidate: proposal.candidate,
        updates: proposal.updates,
        runId,
        actor: runtime.actor,
        status: 'fail',
        results: evidence.results ?? [],
        error: sanitize(error.message, runtime.env, 4096),
      });
    } finally {
      result.durationMs = Date.now() - started;
    }
  }
  if (proposals.length > 1)
    await writeEvidence(runtime.root, `${directory}/results.json`, {
      stage: 'push',
      candidates: proposals.map((proposal) => proposal.candidate),
      updates,
      runId: runtime.runId,
      actor: runtime.actor,
      status: failure ? 'fail' : 'pass',
      results,
    });
  if (failure) throw failure;
  assertRequiredResults(results);
  return true;
}

export async function gateStage(runtime, stage, hookInput) {
  if (stage === 'push') return pushGate(runtime, hookInput);
  if (stage !== 'commit') {
    const selection = await selectProposal(runtime, stage);
    runtime.output(`${stage}: ${selection.reason}`);
    return runGates(runtime, selection, stage);
  }
  return isolatedGate(runtime, stage);
}

async function isolatedGate(runtime, stage, proposal) {
  const candidate = proposal?.candidate;
  let files = proposal
    ? proposal.files
    : (await runtime.git(['diff', '--cached', '--name-only', '--no-renames', '-z'])).stdout
        .split('\0')
        .filter(Boolean);
  return ownedTemporary(async (temporary) => {
    const root = join(temporary, 'snapshot');
    const snapshot = candidate
      ? await runtime.materializeCommit(runtime.root, root, candidate.commit)
      : await runtime.materialize(runtime.root, root);
    if (candidate && (snapshot.commit !== candidate.commit || snapshot.tree !== candidate.tree))
      throw new Error('Materialized push candidate identity does not match');
    const sourceIdentity = candidate
      ? hashIdentity(await fileHashes(root, await candidateSourceFiles(root)))
      : undefined;
    let baselineAvailable = proposal ? proposal.baselineAvailable : true;
    if (!candidate && snapshot?.tree) {
      try {
        files = (
          await runtime.git(['diff', '--name-only', '--no-renames', '-z', 'HEAD', snapshot.tree])
        ).stdout
          .split('\0')
          .filter(Boolean);
      } catch {
        baselineAvailable = false;
      }
    }
    // Never inherit module search or package-manager configuration from the dirty checkout.
    const env = Object.fromEntries(
      Object.entries(runtime.env).filter(
        ([key]) =>
          !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$|INIT_CWD$|npm_config_|PNPM_|STARA_ISOLATED_ROOT$)/i.test(
            key,
          ),
      ),
    );
    for (const key of Object.keys(env).filter((name) => name.toUpperCase() === 'PATH')) {
      env[key] = env[key]
        .split(delimiter)
        .filter((entry) => {
          if (!entry) return false;
          const path = resolve(entry);
          return (
            path !== runtime.root &&
            !within(runtime.root, path) &&
            !/(?:^|[\\/])node_modules(?:[\\/]|$)/i.test(entry)
          );
        })
        .join(delimiter);
    }
    Object.assign(env, {
      STARA_ISOLATED_ROOT: root,
      pnpm_config_store_dir: join(temporary, 'store'),
      pnpm_config_node_linker: 'isolated',
      pnpm_config_package_import_method: 'copy',
      pnpm_config_modules_dir: 'node_modules',
      pnpm_config_virtual_store_dir: 'node_modules/.pnpm',
      pnpm_config_ignore_pnpmfile: 'true',
      pnpm_config_pnpmfile: '',
      pnpm_config_enable_global_virtual_store: 'false',
      pnpm_config_verify_deps_before_run: 'error',
    });
    const isolated = createRuntime({
      ...runtime,
      root,
      env,
      run: runtime.run,
      candidate,
      sourceIdentity,
    });
    await mkdir(join(temporary, 'store'));
    for (const path of (await listFiles(root)).filter(
      (file) => file === 'package.json' || file.endsWith('/package.json'),
    )) {
      const manifest = await readJson(join(root, path));
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        if (
          Object.values(manifest[field] ?? {}).some((version) =>
            /^(?:file|link|portal):/.test(version),
          )
        ) {
          throw new Error('External local dependencies are not isolated');
        }
      }
    }
    let failure;
    try {
      await bootstrap(
        {
          ...isolated,
          pnpm: (args, options) =>
            isolated.pnpm(
              args[0] === 'install'
                ? [
                    ...args,
                    '--ignore-scripts',
                    '--ignore-pnpmfile',
                    '--config.node-linker=isolated',
                    '--config.package-import-method=copy',
                    '--config.modules-dir=node_modules',
                    '--config.virtual-store-dir=node_modules/.pnpm',
                    '--store-dir',
                    join(temporary, 'store'),
                  ]
                : args,
              { ...options, record: true },
            ),
        },
        { hooks: false },
      );
      const moduleUrl = pathToFileURL(join(root, 'tooling/lib/workspace.mjs')).href;
      const input = JSON.stringify({
        files,
        baselineAvailable,
        stage,
        tree: snapshot?.tree,
        ...(proposal ?? {}),
      });
      const options = JSON.stringify({
        runId: runtime.runId,
        actor: runtime.actor,
        pnpmPath: runtime.pnpmPath,
        sourceIdentity,
      });
      const program = `import { runMaterializedGate } from ${JSON.stringify(moduleUrl)}; await runMaterializedGate(${input}, ${options});`;
      await isolated.run(runtime.node, ['--input-type=module', '--eval', program], {
        timeout: 600000,
        record: true,
      });
    } catch (error) {
      failure = error;
    }
    if (
      !failure &&
      candidate &&
      sourceIdentity !== hashIdentity(await fileHashes(root, await candidateSourceFiles(root)))
    )
      failure = new Error('Candidate source drift invalidates push results');
    const evidence = await preserveStagedEvidence({ ...runtime, candidate, sourceIdentity }, root);
    if (!failure) {
      try {
        if (!evidence?.selection || evidence.results?.status !== 'pass')
          throw new Error('Staged gate evidence is missing or failed');
        assertRequiredResults(evidence.results.results);
        if (
          candidate &&
          [evidence.selection.candidate, evidence.results.candidate].some(
            (value) => !sameCandidate(value, candidate),
          )
        )
          throw new Error('Push evidence is not bound to the candidate');
      } catch (error) {
        failure = error;
      }
    }
    if (failure) {
      if (evidence?.results?.status !== 'fail')
        await writeEvidence(runtime.root, `.artifacts/gates/${runtime.runId}/results.json`, {
          ...evidence?.results,
          stage,
          actor: runtime.actor,
          runId: runtime.runId,
          ...(candidate ? { candidate } : {}),
          status: 'fail',
          results: evidence?.results?.results ?? [],
          error: sanitize(failure.message, runtime.env, 4096),
        });
      throw failure;
    }
    return true;
  });
}

export async function runMaterializedGate(
  { files, baselineAvailable, stage, tree, candidate, baseline, updates },
  options = {},
) {
  const runtime = createRuntime({ ...options, candidate });
  const knownPackages = await packageInventory(runtime);
  return runGates(
    runtime,
    {
      ...classifyChanges({ files, knownPackages, baselineAvailable }),
      tree,
      files,
      ...(candidate ? { candidate, baseline, updates } : {}),
    },
    stage,
  );
}
