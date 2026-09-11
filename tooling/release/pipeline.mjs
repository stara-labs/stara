import { createHash } from 'node:crypto';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual, TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';
import { assertUnlinked, within } from '../lib/files.mjs';
import { parseDispatch, parseManifest, validateProvenance } from './contract.mjs';

const minute = 60_000;
const components = ['web', 'api'];
const targets = ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'];
const scanner =
  'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const gateway =
  'nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce';
const workflowRef = 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main';
const workflows = {
  scaffold: {
    id: '354641209',
    path: '.github/workflows/checks.yml',
    event: 'push',
    jobs: [
      'Candidate verification',
      'Windows package verification',
      'Container journeys',
      'Required scaffold checks',
      'Release image verification',
    ],
  },
  codeql: {
    id: '355366692',
    path: 'dynamic/github-code-scanning/codeql',
    event: 'dynamic',
    jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)'],
  },
  images: {
    path: '.github/workflows/release.yml',
    event: 'push',
    jobs: ['Verify release images', 'Publish verified images'],
  },
};
const reportFiles = {
  browser: 'browser.json',
  webImage: 'web-image-scan.json',
  apiImage: 'api-image-scan.json',
  metadata: 'metadata-scan.json',
  publicFiles: 'public-files-scan.json',
};
const shaPattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const runPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

function requireValue(condition) {
  if (!condition) throw new Error('Release pipeline denied');
}

function matches(value, pattern) {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

function shape(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  requireValue(Reflect.ownKeys(value).length === keys.length);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
  }
}

function decimal(value) {
  if (Number.isSafeInteger(value) && value > 0) value = String(value);
  requireValue(matches(value, /^[1-9][0-9]*$/));
  return value;
}

function runIdentity(value) {
  shape(value, ['id', 'attempt']);
  requireValue(typeof value.id === 'string');
  decimal(value.id);
  requireValue(Number.isSafeInteger(value.attempt) && value.attempt > 0);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function json(bytes, maximum) {
  requireValue(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= maximum);
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(source);
  requireValue(
    parseDocument(source, { schema: 'json', uniqueKeys: true, prettyErrors: false }).errors
      .length === 0,
  );
  return value;
}

async function guarded(action) {
  try {
    return await action();
  } catch {
    throw new Error('Release pipeline denied');
  }
}

function budget(clock, duration, limit) {
  requireValue(typeof clock?.now === 'function' && typeof clock?.sleep === 'function');
  let observed = clock.now();
  requireValue(Number.isSafeInteger(observed) && observed >= 0);
  const deadline = limit ?? observed + duration;
  const remaining = () => {
    const current = clock.now();
    requireValue(Number.isSafeInteger(current) && current >= 0);
    observed = Math.max(observed, current);
    const left = deadline - observed;
    requireValue(left > 0);
    return left;
  };
  const call = async (action) => {
    const timeout = remaining();
    const controller = new AbortController();
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => {
          remaining();
          return action(controller.signal, timeout);
        }),
        new Promise((_done, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Release deadline exceeded'));
          }, timeout);
        }),
      ]);
      remaining();
      return value;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
  return { deadline, remaining, call };
}

function github(request, time) {
  requireValue(typeof request === 'function');
  return async (route, parameters = {}) =>
    time.call(async (signal, timeout) => {
      const response = await request(route, {
        owner: 'stara-labs',
        repo: 'stara',
        ...parameters,
        request: { signal, timeout },
      });
      requireValue(response && typeof response.data === 'object' && response.data !== null);
      const links = Object.entries(response.headers ?? {}).filter(
        ([key]) => key.toLowerCase() === 'link',
      );
      requireValue(
        links.every(([, value]) => typeof value === 'string' && !/rel=["']?next/.test(value)),
      );
      return response.data;
    });
}

function repository(value, repositoryId) {
  requireValue(
    value && decimal(value.id) === repositoryId && value.full_name === 'stara-labs/stara',
  );
}

async function currentMain(get, sourceSha, repositoryId) {
  repository(await get('GET /repos/{owner}/{repo}'), repositoryId);
  const ref = await get('GET /repos/{owner}/{repo}/git/ref/{ref}', { ref: 'heads/main' });
  requireValue(
    ref.ref === 'refs/heads/main' && ref.object?.type === 'commit' && ref.object.sha === sourceSha,
  );
}

function nativeRunIdentity(run, workflow, sourceSha, repositoryId, identity) {
  requireValue(run && typeof run === 'object');
  const id = decimal(run.id);
  requireValue(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  requireValue(decimal(run.workflow_id) === workflow.id && run.path === workflow.path);
  requireValue(
    run.head_sha === sourceSha && run.head_branch === 'main' && run.event === workflow.event,
  );
  repository(run.repository, repositoryId);
  repository(run.head_repository, repositoryId);
  if (identity) requireValue(id === identity.id && run.run_attempt === identity.attempt);
  return { id, attempt: run.run_attempt };
}

function nativeRun(run, workflow, sourceSha, repositoryId, identity) {
  const result = nativeRunIdentity(run, workflow, sourceSha, repositoryId, identity);
  requireValue(['queued', 'in_progress', 'completed'].includes(run.status));
  if (run.status === 'completed') requireValue(run.conclusion === 'success');
  else requireValue(run.conclusion === null);
  return result;
}

function latestCodeqlRun(inventory, sourceSha, repositoryId) {
  requireValue(
    Number.isSafeInteger(inventory.total_count) &&
      inventory.total_count > 0 &&
      inventory.total_count <= 100 &&
      Array.isArray(inventory.workflow_runs) &&
      inventory.workflow_runs.length === inventory.total_count,
  );
  const ids = new Set();
  let selected;
  for (const run of inventory.workflow_runs) {
    const identity = nativeRunIdentity(run, workflows.codeql, sourceSha, repositoryId);
    requireValue(!ids.has(identity.id));
    ids.add(identity.id);
    requireValue(Number.isSafeInteger(run.run_number) && run.run_number > 0);
    if (!selected || run.run_number > selected.run_number) selected = run;
  }
  requireValue(
    inventory.workflow_runs.filter((run) => run.run_number === selected.run_number).length === 1,
  );
  return selected;
}

async function completedRun(get, workflow, sourceSha, repositoryId, identity, runNumber) {
  const run = await get(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}',
    {
      run_id: identity.id,
      attempt_number: identity.attempt,
    },
  );
  nativeRun(run, workflow, sourceSha, repositoryId, identity);
  if (runNumber !== undefined) requireValue(run.run_number === runNumber);
  if (run.status !== 'completed') return false;
  const inventory = await get(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs',
    {
      run_id: identity.id,
      attempt_number: identity.attempt,
      per_page: 100,
      page: 1,
    },
  );
  requireValue(
    Array.isArray(inventory.jobs) &&
      inventory.jobs.length > 0 &&
      Number.isSafeInteger(inventory.total_count) &&
      inventory.total_count === inventory.jobs.length &&
      inventory.total_count <= 100,
  );
  const names = new Set();
  const ids = new Set();
  for (const job of inventory.jobs) {
    requireValue(
      job && typeof job.name === 'string' && job.name.length > 0 && !names.has(job.name),
    );
    const id = decimal(job.id);
    requireValue(!ids.has(id));
    names.add(job.name);
    ids.add(id);
    requireValue(
      decimal(job.run_id) === identity.id &&
        job.run_attempt === identity.attempt &&
        job.head_sha === sourceSha,
    );
    requireValue(job.status === 'completed' && job.conclusion === 'success');
  }
  requireValue(workflow.jobs.every((name) => names.has(name)));
  return true;
}

export async function awaitMainChecks(options) {
  return guarded(async () => {
    shape(options, ['sourceSha', 'repositoryId', 'request', 'clock']);
    const { sourceSha, repositoryId, request, clock } = options;
    requireValue(matches(sourceSha, shaPattern) && typeof repositoryId === 'string');
    decimal(repositoryId);
    const time = budget(clock, 20 * minute);
    const get = github(request, time);
    await currentMain(get, sourceSha, repositoryId);
    const result = { sourceSha };
    for (const kind of ['scaffold', 'codeql']) {
      const workflow = workflows[kind];
      while (true) {
        const inventory = await get(
          'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs',
          {
            workflow_id: workflow.id,
            head_sha: sourceSha,
            branch: 'main',
            // Include every CodeQL event so a newer unsupported run cannot be hidden.
            ...(kind === 'codeql' ? {} : { event: workflow.event }),
            per_page: 100,
            page: 1,
          },
        );
        let run;
        if (kind === 'codeql') {
          run = latestCodeqlRun(inventory, sourceSha, repositoryId);
        } else {
          requireValue(
            inventory.total_count === 1 &&
              Array.isArray(inventory.workflow_runs) &&
              inventory.workflow_runs.length === 1,
          );
          run = inventory.workflow_runs[0];
        }
        const identity = nativeRun(run, workflow, sourceSha, repositoryId);
        let current = run;
        let runNumber;
        if (kind === 'codeql') {
          runNumber = run.run_number;
          current = await get('GET /repos/{owner}/{repo}/actions/runs/{run_id}', {
            run_id: identity.id,
          });
          nativeRun(current, workflow, sourceSha, repositoryId, identity);
          requireValue(current.run_number === runNumber);
        }
        if (
          run.status === 'completed' &&
          current.status === 'completed' &&
          (await completedRun(get, workflow, sourceSha, repositoryId, identity, runNumber))
        ) {
          result[kind] = identity;
          break;
        }
        await time.call(() => clock.sleep(Math.min(5000, time.remaining())));
        await currentMain(get, sourceSha, repositoryId);
      }
    }
    await currentMain(get, sourceSha, repositoryId);
    return result;
  });
}

function runtimePaths(runtime) {
  requireValue(runtime && typeof runtime.root === 'string' && matches(runtime.runId, runPattern));
  const root = resolve(runtime.root);
  requireValue(!root.includes(','));
  return { root, evidenceDirectory: join(root, '.artifacts', 'release-pipeline', runtime.runId) };
}

async function readOwned(directory, path, maximum) {
  const target = resolve(path);
  requireValue(within(directory, target));
  await assertUnlinked(target);
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= maximum);
    const data = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length <= maximum) {
      const read = await file.read(data, length, data.length - length, length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    requireValue(length > 0 && length <= maximum);
    return data.subarray(0, length);
  } finally {
    await file.close();
  }
}

async function writeOwned(directory, path, bytes) {
  requireValue(within(directory, resolve(path)));
  await assertUnlinked(path);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
}

function command(runtime, time, env) {
  requireValue(
    typeof runtime.run === 'function' &&
      typeof runtime.git === 'function' &&
      typeof runtime.pnpm === 'function',
  );
  return async (kind, args) =>
    time.call(async (signal, timeout) => {
      const settings = { cwd: runtime.root, env, timeout, signal, shell: false, record: false };
      const result =
        kind === 'git'
          ? await runtime.git(args, settings)
          : kind === 'pnpm'
            ? await runtime.pnpm(args, settings)
            : await runtime.run(kind, args, settings);
      requireValue(
        result?.code === 0 &&
          typeof result.stdout === 'string' &&
          typeof result.stderr === 'string',
      );
      return result.stdout;
    });
}

async function sourceState(run, sourceSha, mode) {
  requireValue((await run('git', ['rev-parse', '--verify', 'HEAD'])).trim() === sourceSha);
  const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (mode === 'ci') requireValue(status === '');
}

async function inspect(run, ref, expected) {
  const output = await run('docker', ['image', 'inspect', ref]);
  const data = json(Buffer.from(output), 16 * 1024 * 1024);
  requireValue(Array.isArray(data) && data.length === 1 && matches(data[0]?.Id, imagePattern));
  requireValue(data[0].Id === expected);
  return data[0];
}

function browserReport(report) {
  requireValue(
    report &&
      Array.isArray(report.errors) &&
      report.errors.length === 0 &&
      Array.isArray(report.suites),
  );
  requireValue(Number.isSafeInteger(report.stats?.expected) && report.stats.expected > 0);
  requireValue(['unexpected', 'flaky', 'skipped'].every((key) => report.stats[key] === 0));
  requireValue(Array.isArray(report.config?.projects) && report.config.projects.length === 3);
  requireValue(
    isDeepStrictEqual(report.config.projects.map((project) => project.name).sort(), [
      'chromium',
      'firefox',
      'webkit',
    ]),
  );
}

function scanReport(report, filename) {
  requireValue(report?.SchemaVersion === 2);
  if (!Object.hasOwn(report, 'Results')) {
    shape(report, [
      'SchemaVersion',
      'Trivy',
      'ReportID',
      'CreatedAt',
      'ArtifactName',
      'ArtifactType',
    ]);
    shape(report.Trivy, ['Version']);
    requireValue(report.Trivy.Version === '0.74.0');
    const artifactName =
      filename === reportFiles.metadata
        ? '/evidence/metadata'
        : filename === reportFiles.publicFiles
          ? '/evidence/public-files'
          : null;
    requireValue(
      artifactName !== null &&
        report.ArtifactName === artifactName &&
        report.ArtifactType === 'filesystem',
    );
    requireValue(matches(report.ReportID, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/));
    requireValue(matches(report.CreatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/));
    const createdAt = new Date(report.CreatedAt);
    requireValue(Number.isFinite(createdAt.getTime()));
    // Reject calendar rollover while retaining Go's sub-millisecond timestamp precision.
    requireValue(createdAt.toISOString().slice(0, 19) === report.CreatedAt.slice(0, 19));
    return;
  }
  requireValue(Array.isArray(report.Results));
  for (const result of report.Results) {
    requireValue(result && typeof result === 'object');
    if (Object.hasOwn(result, 'Secrets'))
      requireValue(Array.isArray(result.Secrets) && result.Secrets.length === 0);
    if (Object.hasOwn(result, 'Vulnerabilities')) {
      requireValue(Array.isArray(result.Vulnerabilities));
      for (const vulnerability of result.Vulnerabilities) {
        requireValue(['UNKNOWN', 'LOW', 'MEDIUM'].includes(vulnerability?.Severity));
      }
    }
  }
}

async function reports(directory, expected) {
  if (expected) shape(expected, Object.keys(reportFiles));
  const result = {};
  for (const [name, path] of Object.entries(reportFiles)) {
    if (expected) {
      shape(expected[name], ['path', 'sha256']);
      requireValue(expected[name].path === path && matches(expected[name].sha256, hashPattern));
    }
    const bytes = await readOwned(directory, join(directory, path), 16 * 1024 * 1024);
    const sha256 = hash(bytes);
    if (expected) requireValue(sha256 === expected[name].sha256);
    const report = json(bytes, 16 * 1024 * 1024);
    if (name === 'browser') browserReport(report);
    else scanReport(report, path);
    result[name] = { path, sha256 };
  }
  return result;
}

async function unlinkedTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    requireValue(!entry.isSymbolicLink());
    if (entry.isDirectory()) await unlinkedTree(path);
    else requireValue(entry.isFile());
  }
}

export async function verifyImages(options) {
  return guarded(async () => {
    shape(options, ['sourceSha', 'mode', 'runtime', 'clock', 'trivyImage']);
    const { sourceSha, mode, runtime, clock, trivyImage } = options;
    requireValue(
      matches(sourceSha, shaPattern) &&
        ['ci', 'working-tree'].includes(mode) &&
        trivyImage === scanner,
    );
    const { root, evidenceDirectory } = runtimePaths(runtime);
    const total = budget(clock, 25 * minute);
    // Keep one minute within the original budget for scoped resource cleanup.
    const work = budget(clock, 0, total.deadline - minute);
    const env = { ...runtime.env };
    const port = env.STARA_RELEASE_PORT ?? '8173';
    requireValue(matches(port, /^[1-9][0-9]{0,4}$/) && Number(port) <= 65535);
    const origin = `http://127.0.0.1:${port}`;
    await assertUnlinked(evidenceDirectory);
    await mkdir(dirname(evidenceDirectory), { recursive: true, mode: 0o700 });
    await mkdir(evidenceDirectory, { mode: 0o700 });
    const images = {};
    const run = command(runtime, work, env);
    const clean = command(runtime, total, env);
    const project = `stara-release-${runtime.runId}`;
    const compose = [
      'compose',
      '--project-name',
      project,
      '--file',
      join(root, 'tests/e2e/release.compose.yaml'),
    ];
    const extractionContainers = [];
    let composeOwned = false;
    let failure;
    try {
      await sourceState(run, sourceSha, mode);
      const existing = await run('docker', [
        'ps',
        '--all',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--quiet',
      ]);
      requireValue(existing.trim() === '');
      await mkdir(join(evidenceDirectory, 'metadata'), { mode: 0o700 });
      await mkdir(join(evidenceDirectory, 'public-files'), { mode: 0o700 });
      for (const component of components) {
        const tag = `stara-release-${component}:${runtime.runId}`;
        const iidFile = join(evidenceDirectory, `${component}.iid`);
        const dockerfile =
          component === 'web' ? 'UI/web/release.Dockerfile' : 'backend/api/release.Dockerfile';
        await run('docker', [
          'build',
          '--file',
          dockerfile,
          '--iidfile',
          iidFile,
          '--tag',
          tag,
          '.',
        ]);
        const imageId = new TextDecoder('utf-8', { fatal: true })
          .decode(await readOwned(evidenceDirectory, iidFile, 256))
          .trim();
        requireValue(matches(imageId, imagePattern));
        const metadata = await inspect(run, tag, imageId);
        images[component] = { imageId, tag };
        await writeOwned(
          evidenceDirectory,
          join(evidenceDirectory, 'metadata', `${component}.json`),
          JSON.stringify(metadata),
        );
        await run('docker', [
          'image',
          'save',
          '--output',
          join(evidenceDirectory, `${component}.tar`),
          imageId,
        ]);
      }
      env.STARA_RELEASE_WEB_IMAGE = images.web.imageId;
      env.STARA_RELEASE_API_IMAGE = images.api.imageId;
      env.STARA_RELEASE_PORT = port;
      env.STARA_E2E_BASE_URL = origin;
      env.STARA_E2E_RUN_ID = `run-release-${runtime.runId}`;
      env.PLAYWRIGHT_JSON_OUTPUT_NAME = join(evidenceDirectory, 'browser.json');
      await run('docker', ['pull', gateway]);
      composeOwned = true;
      await run('docker', [
        ...compose,
        'up',
        '--detach',
        '--wait',
        '--wait-timeout',
        String(Math.max(1, Math.floor(work.remaining() / 1000))),
        '--no-build',
        '--pull',
        'never',
      ]);
      requireValue(typeof runtime.fetch === 'function');
      for (const [path, expected] of [
        ['/api/health', { status: 'ok' }],
        ['/api/runtime-config', { schemaVersion: 1, environment: 'staging' }],
      ]) {
        await work.call(async (signal) => {
          const response = await runtime.fetch(`${origin}${path}`, {
            method: 'GET',
            signal,
            redirect: 'error',
            cache: 'no-store',
          });
          requireValue(response?.status === 200 && response.ok === true);
          requireValue(isDeepStrictEqual(await response.json(), expected));
        });
      }
      await run('pnpm', [
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/e2e/release.config.ts',
        '--reporter=json',
      ]);
      const extraction = (
        await run('docker', ['create', '--name', `${project}-public`, images.web.imageId])
      ).trim();
      requireValue(matches(extraction, /^[a-z0-9][a-z0-9-]{0,127}$/));
      extractionContainers.push(extraction);
      await run('docker', [
        'cp',
        `${extraction}:/usr/share/nginx/html/.`,
        join(evidenceDirectory, 'public-files'),
      ]);
      await unlinkedTree(join(evidenceDirectory, 'public-files'));
      const scan = async (name, args) => {
        await run('docker', [
          'run',
          '--rm',
          '--mount',
          `type=bind,source=${evidenceDirectory},target=/evidence`,
          scanner,
          ...args,
          '--format',
          'json',
          '--output',
          `/evidence/${reportFiles[name]}`,
          '--exit-code',
          '0',
        ]);
      };
      for (const component of components)
        await scan(component === 'web' ? 'webImage' : 'apiImage', [
          'image',
          '--input',
          `/evidence/${component}.tar`,
          '--scanners',
          'vuln,secret',
        ]);
      await scan('metadata', ['fs', '--scanners', 'secret', '/evidence/metadata']);
      await scan('publicFiles', ['fs', '--scanners', 'secret', '/evidence/public-files']);
      await reports(evidenceDirectory);
      for (const component of components)
        await inspect(run, images[component].tag, images[component].imageId);
    } catch (error) {
      failure = error;
    } finally {
      for (const container of extractionContainers) {
        try {
          await clean('docker', ['rm', container]);
        } catch (error) {
          failure ??= error;
        }
      }
      if (composeOwned) {
        try {
          await clean('docker', [...compose, 'down']);
        } catch (error) {
          failure ??= error;
        }
      }
    }
    if (failure) throw failure;
    await sourceState(command(runtime, total, env), sourceSha, mode);
    const receipt = {
      schemaVersion: 1,
      sourceSha,
      mode,
      runId: runtime.runId,
      images,
      verified: true,
      reports: await reports(evidenceDirectory),
    };
    const bytes = Buffer.from(JSON.stringify(receipt));
    requireValue(bytes.length <= 65536);
    total.remaining();
    await writeOwned(evidenceDirectory, join(evidenceDirectory, 'verified.json'), bytes);
    return {
      schemaVersion: 1,
      sourceSha,
      mode,
      runId: runtime.runId,
      images,
      evidenceDirectory,
      receiptSha256: hash(bytes),
      verified: true,
    };
  });
}

function imageShape(images, runId) {
  shape(images, components);
  for (const component of components) {
    shape(images[component], ['imageId', 'tag']);
    requireValue(matches(images[component].imageId, imagePattern));
    requireValue(images[component].tag === `stara-release-${component}:${runId}`);
  }
}

async function verifiedReceipt(verified, runtime, modes = ['ci']) {
  shape(verified, [
    'schemaVersion',
    'sourceSha',
    'mode',
    'runId',
    'images',
    'evidenceDirectory',
    'receiptSha256',
    'verified',
  ]);
  const { evidenceDirectory } = runtimePaths(runtime);
  requireValue(
    verified.evidenceDirectory === evidenceDirectory && verified.runId === runtime.runId,
  );
  requireValue(
    verified.schemaVersion === 1 && modes.includes(verified.mode) && verified.verified === true,
  );
  requireValue(
    matches(verified.sourceSha, shaPattern) && matches(verified.receiptSha256, hashPattern),
  );
  imageShape(verified.images, verified.runId);
  const bytes = await readOwned(evidenceDirectory, join(evidenceDirectory, 'verified.json'), 65536);
  requireValue(hash(bytes) === verified.receiptSha256);
  const receipt = json(bytes, 65536);
  shape(receipt, ['schemaVersion', 'sourceSha', 'mode', 'runId', 'images', 'verified', 'reports']);
  imageShape(receipt.images, receipt.runId);
  for (const key of ['schemaVersion', 'sourceSha', 'mode', 'runId', 'images', 'verified'])
    requireValue(isDeepStrictEqual(receipt[key], verified[key]));
  await reports(evidenceDirectory, receipt.reports);
  return receipt;
}

export async function checkImageEvidence(options) {
  return guarded(async () => {
    shape(options, ['runtime', 'verified']);
    const verified = structuredClone(options.verified);
    const runtime = { root: options.runtime.root, runId: options.runtime.runId };
    await verifiedReceipt(verified, runtime, ['ci', 'working-tree']);
    return true;
  });
}

async function coverageBytes(coverage, directory, checks) {
  shape(coverage, ['path', 'sha256']);
  requireValue(typeof coverage.path === 'string' && matches(coverage.sha256, hashPattern));
  const bytes = await readOwned(directory, coverage.path, 1024 * 1024);
  requireValue(hash(bytes) === coverage.sha256);
  const envelope = json(bytes, 1024 * 1024);
  shape(envelope, ['schemaVersion', 'sourceSha', 'runId', 'runAttempt', 'coverage']);
  requireValue(
    envelope.schemaVersion === 1 &&
      envelope.sourceSha === checks.sourceSha &&
      envelope.runId === checks.scaffold.id &&
      envelope.runAttempt === checks.scaffold.attempt,
  );
  requireValue(Array.isArray(envelope.coverage) && envelope.coverage.length === targets.length);
  const seen = new Set();
  for (const report of envelope.coverage) {
    shape(report, ['target', 'sourceSha', 'complete', 'lines', 'branches']);
    requireValue(targets.includes(report.target) && !seen.has(report.target));
    seen.add(report.target);
    requireValue(report.sourceSha === checks.sourceSha && report.complete === true);
    requireValue(Number.isFinite(report.lines) && report.lines >= 90 && report.lines <= 100);
    requireValue(
      Number.isFinite(report.branches) && report.branches >= 85 && report.branches <= 100,
    );
  }
  return Buffer.from(JSON.stringify(envelope.coverage));
}

export async function publishCandidate(options) {
  return guarded(async () => {
    shape(options, [
      'verified',
      'checks',
      'coverage',
      'imagesRun',
      'repositoryId',
      'runtime',
      'registry',
      'storage',
    ]);
    const { runtime, registry, storage } = options;
    const { verified, checks, coverage, imagesRun, repositoryId } = structuredClone({
      verified: options.verified,
      checks: options.checks,
      coverage: options.coverage,
      imagesRun: options.imagesRun,
      repositoryId: options.repositoryId,
    });
    const time = budget(realClock, 15 * minute);
    const env = { ...runtime.env };
    const run = command(runtime, time, env);
    requireValue(typeof repositoryId === 'string');
    decimal(repositoryId);
    shape(checks, ['sourceSha', 'scaffold', 'codeql']);
    runIdentity(checks.scaffold);
    runIdentity(checks.codeql);
    runIdentity(imagesRun);
    requireValue(checks.sourceSha === verified.sourceSha && matches(checks.sourceSha, shaPattern));
    requireValue(
      env.GITHUB_EVENT_NAME === 'push' &&
        env.GITHUB_REF === 'refs/heads/main' &&
        env.GITHUB_SHA === verified.sourceSha &&
        env.GITHUB_RUN_ID === imagesRun.id &&
        env.GITHUB_RUN_ATTEMPT === String(imagesRun.attempt) &&
        env.GITHUB_REPOSITORY_ID === repositoryId &&
        env.GITHUB_REPOSITORY === 'stara-labs/stara',
    );
    shape(registry, ['web', 'api', 'attest']);
    requireValue(typeof registry.attest === 'function' && typeof storage?.put === 'function');
    const repositories = Object.fromEntries(
      components.map((component) => [component, registry[component]]),
    );
    for (const name of Object.values(repositories))
      requireValue(
        matches(
          name,
          /^us-central1-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*$/,
        ),
      );
    requireValue(repositories.web !== repositories.api);
    const receipt = await verifiedReceipt(verified, runtime);
    const coverageRaw = await coverageBytes(coverage, verified.evidenceDirectory, checks);
    await sourceState(run, verified.sourceSha, 'ci');
    for (const component of components)
      await inspect(run, receipt.images[component].tag, receipt.images[component].imageId);
    const images = {};
    for (const component of components) {
      const image = receipt.images[component];
      const ref = `${repositories[component]}:sha-${verified.sourceSha}-run-${imagesRun.id}-${imagesRun.attempt}`;
      await run('docker', ['tag', image.imageId, ref]);
      await inspect(run, ref, image.imageId);
      await run('docker', ['push', ref]);
      const pushed = await inspect(run, ref, image.imageId);
      requireValue(Array.isArray(pushed.RepoDigests));
      const candidates = pushed.RepoDigests.filter(
        (entry) => typeof entry === 'string' && entry.startsWith(`${repositories[component]}@`),
      );
      requireValue(candidates.length === 1);
      const digest = candidates[0].slice(repositories[component].length + 1);
      requireValue(matches(digest, imagePattern));
      images[component] = { digest };
    }
    const attestations = {};
    for (const component of components) {
      const result = await time.call(() =>
        registry.attest({
          component,
          subjectName: repositories[component],
          subjectDigest: images[component].digest,
          sourceSha: verified.sourceSha,
          runId: imagesRun.id,
          runAttempt: imagesRun.attempt,
          runtime,
        }),
      );
      requireValue(
        result?.bundle instanceof Uint8Array &&
          result.bundle.byteLength > 0 &&
          result.bundle.byteLength <= 1024 * 1024,
      );
      const bundle = Buffer.from(result.bundle);
      images[component].attestationSha256 = hash(bundle);
      attestations[component] = { bundle, verification: structuredClone(result.verification) };
    }
    const manifestBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sourceSha: verified.sourceSha,
        repositoryId,
        images,
        runs: { scaffold: checks.scaffold, images: imagesRun, codeql: checks.codeql },
      }),
    );
    const manifestSha256 = hash(manifestBytes);
    const manifest = parseManifest(manifestBytes, manifestSha256);
    const policy = {
      repositoryId,
      requiredTargets: targets,
      provenanceWorkflowRef: workflowRef,
      workflows: {
        scaffold: {
          workflowRef: 'stara-labs/stara/.github/workflows/checks.yml@refs/heads/main',
          jobs: workflows.scaffold.jobs,
        },
        images: { workflowRef, jobs: workflows.images.jobs },
        codeql: { workflowRef: workflows.codeql.path, jobs: workflows.codeql.jobs },
      },
    };
    for (const component of components)
      validateProvenance(manifest, component, attestations[component].verification, policy);
    // Validate all uploads before the first immutable write; never retry a failed write.
    const put = async (key, bytes) => {
      const result = await time.call(() => storage.put({ key, bytes, ifAbsent: true }));
      requireValue(result?.created === true);
    };
    for (const component of components)
      await put(
        `attestations/${images[component].attestationSha256}.jsonl`,
        attestations[component].bundle,
      );
    await put(
      `coverage/${verified.sourceSha}/${checks.scaffold.id}-${checks.scaffold.attempt}.json`,
      coverageRaw,
    );
    await put(`manifests/${manifestSha256}.json`, manifestBytes);
    return { manifest, manifestSha256 };
  });
}

export async function dispatchCandidate(options) {
  return guarded(async () => {
    shape(options, [
      'event',
      'repositoryId',
      'request',
      'publish',
      'topic',
      'manifest',
      'configurationSha256',
    ]);
    const { request, publish, topic, repositoryId, configurationSha256 } = options;
    requireValue(options.manifest instanceof Uint8Array && options.manifest.byteLength <= 65536);
    const bytes = Buffer.from(options.manifest);
    const manifestSha256 = hash(bytes);
    const manifest = parseManifest(bytes, manifestSha256);
    requireValue(typeof repositoryId === 'string' && manifest.repositoryId === repositoryId);
    decimal(repositoryId);
    requireValue(
      matches(
        topic,
        /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/,
      ),
    );
    requireValue(typeof publish === 'function');
    const event = structuredClone(options.event);
    requireValue(event?.action === 'completed');
    repository(event.repository, repositoryId);
    const identity = {
      id: decimal(event.workflow_run?.id),
      attempt: event.workflow_run?.run_attempt,
    };
    runIdentity(identity);
    requireValue(
      isDeepStrictEqual(identity, manifest.runs.images) &&
        event.workflow_run.head_sha === manifest.sourceSha,
    );
    const time = budget(realClock, 5 * minute);
    const get = github(request, time);
    await currentMain(get, manifest.sourceSha, repositoryId);
    const metadata = await get('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}', {
      workflow_id: 'release.yml',
    });
    requireValue(
      metadata.path === workflows.images.path &&
        metadata.name === 'Release images' &&
        metadata.state === 'active',
    );
    const workflow = { ...workflows.images, id: decimal(metadata.id) };
    requireValue(await completedRun(get, workflow, manifest.sourceSha, repositoryId, identity));
    await currentMain(get, manifest.sourceSha, repositoryId);
    const dispatchBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sourceSha: manifest.sourceSha,
        manifestSha256,
        configurationSha256,
      }),
    );
    const dispatch = parseDispatch(dispatchBytes);
    await time.call(() => publish({ topic, data: dispatchBytes.toString('base64') }));
    return dispatch;
  });
}
