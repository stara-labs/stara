import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../lib/process.mjs';
import { parseDispatch, parseManifest } from '../release/contract.mjs';
import { artifactPaths } from '../../tests/e2e/artifact-run.ts';

let pipeline;
beforeAll(async () => {
  pipeline = await import(
    /* @vite-ignore */ new URL('../release/pipeline.mjs', import.meta.url).href
  );
});

const sha = '1'.repeat(40);
const repositoryId = '123456';
const minute = 60_000;
const startedAt = 1_800_000_000_000;
const canary = 'synthetic-pipeline-private-canary-DO-NOT-PUBLISH';
const imageIds = { web: `sha256:${'2'.repeat(64)}`, api: `sha256:${'3'.repeat(64)}` };
const digests = { web: `sha256:${'4'.repeat(64)}`, api: `sha256:${'5'.repeat(64)}` };
const scanner =
  'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const gatewayImage =
  'nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce';
const configurationSha256 = '7'.repeat(64);
const registryNames = {
  web: 'us-central1-docker.pkg.dev/synthetic-delivery/app/web',
  api: 'us-central1-docker.pkg.dev/synthetic-delivery/app/api',
};
const workflows = {
  scaffold: {
    id: 354641209,
    path: '.github/workflows/checks.yml',
    jobs: [
      'Candidate verification',
      'Windows package verification',
      'Container journeys',
      'Required scaffold checks',
      'Release image verification',
    ],
  },
  codeql: {
    id: 355366692,
    path: 'dynamic/github-code-scanning/codeql',
    jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)'],
  },
  images: {
    id: 123457,
    path: '.github/workflows/release.yml',
    jobs: ['Verify release images', 'Publish verified images'],
  },
};
const runs = {
  scaffold: { id: '101', attempt: 1 },
  codeql: { id: '102', attempt: 1 },
  images: { id: '103', attempt: 2 },
};
const expectedChecks = { sourceSha: sha, scaffold: runs.scaffold, codeql: runs.codeql };
const cleanup = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const copy = (value) => structuredClone(value);
async function write(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof value === 'string' || value instanceof Uint8Array ? value : bytes(value),
  );
}
function clock() {
  let now = startedAt;
  return {
    now: () => now,
    sleep: vi.fn(async (ms) => {
      now += ms;
    }),
    advance: (ms) => {
      now += ms;
    },
  };
}
function nativeRun(kind) {
  const workflow = workflows[kind];
  return {
    id: Number(runs[kind].id),
    run_number: Number(runs[kind].id),
    run_attempt: runs[kind].attempt,
    workflow_id: workflow.id,
    path: workflow.path,
    event: 'push',
    head_branch: 'main',
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    repository: { id: Number(repositoryId), full_name: 'stara-labs/stara' },
    head_repository: { id: Number(repositoryId), full_name: 'stara-labs/stara' },
  };
}
function nativeJobs(kind) {
  return workflows[kind].jobs.map((name, index) => ({
    id: Number(runs[kind].id) * 100 + index,
    name,
    run_id: Number(runs[kind].id),
    run_attempt: runs[kind].attempt,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
  }));
}
function github(options = {}) {
  const calls = [];
  const counts = {};
  const request = vi.fn(async (route, parameters = {}) => {
    calls.push({ route, parameters });
    expect(route.startsWith('GET ')).toBe(true);
    expect(parameters.owner).toBe('stara-labs');
    expect(parameters.repo).toBe('stara');
    expect(JSON.stringify({ route, parameters })).not.toContain('synthetic-attacker.example');
    let data;
    if (
      /\/git\/ref\//.test(route) ||
      /\/git\/ref\//.test(String(parameters.ref)) ||
      /\/git\/ref\{?/.test(route) ||
      route.endsWith('/git/ref/{ref}')
    ) {
      data = { ref: 'refs/heads/main', object: { type: 'commit', sha: options.mainSha ?? sha } };
    } else if (route.endsWith('/repos/{owner}/{repo}')) {
      data = { id: Number(repositoryId), full_name: 'stara-labs/stara' };
    } else if (route.includes('/jobs')) {
      const kind = Object.keys(runs).find((key) => runs[key].id === String(parameters.run_id));
      if (!kind) throw new Error('Unexpected synthetic jobs run');
      const jobs = nativeJobs(kind);
      options.jobs?.(jobs, kind, parameters);
      data = { total_count: options.jobTotal ?? jobs.length, jobs };
    } else if (route.includes('/actions/runs/')) {
      const kind = Object.keys(runs).find((key) => runs[key].id === String(parameters.run_id));
      if (!kind) throw new Error('Unexpected synthetic run');
      data = nativeRun(kind);
      options.run?.(data, kind);
    } else if (route.includes('/workflows/')) {
      const kind = Object.keys(workflows).find(
        (key) =>
          String(workflows[key].id) === String(parameters.workflow_id) ||
          workflows[key].path.endsWith(`/${parameters.workflow_id}`),
      );
      if (!kind) throw new Error('Unexpected synthetic workflow');
      if (route.endsWith('/runs')) {
        const run = nativeRun(kind);
        counts[kind] = (counts[kind] ?? 0) + 1;
        options.list?.(run, kind, counts[kind]);
        data = { total_count: 1, workflow_runs: [run] };
      } else
        data = {
          id: workflows[kind].id,
          path: workflows[kind].path,
          name:
            kind === 'images'
              ? 'Release images'
              : kind === 'scaffold'
                ? 'Scaffold checks'
                : 'CodeQL',
          state: 'active',
        };
    } else throw new Error(`Unexpected synthetic GET route: ${route}`);
    const result = { data, headers: {} };
    return options.response ? options.response(result, route, parameters) : result;
  });
  return { request, calls, clock: clock() };
}
function codeqlHistory(entries, mutateResponse = () => {}) {
  return github({
    response: (result, route, parameters) => {
      if (
        route.endsWith('/workflows/{workflow_id}/runs') &&
        String(parameters.workflow_id) === String(workflows.codeql.id)
      ) {
        result.data = { total_count: entries.length, workflow_runs: copy(entries) };
      }
      mutateResponse(result, route, parameters);
      return result;
    },
  });
}
function cleanScan() {
  return { SchemaVersion: 2, Results: [{ Target: 'synthetic', Vulnerabilities: [], Secrets: [] }] };
}
function emptyFilesystemScan(kind) {
  return {
    SchemaVersion: 2,
    Trivy: { Version: '0.74.0' },
    ReportID: '11111111-1111-4111-8111-111111111111',
    CreatedAt: '2026-09-11T01:21:05.507106267Z',
    ArtifactName: kind === 'metadata' ? '/evidence/metadata' : '/evidence/public-files',
    ArtifactType: 'filesystem',
  };
}
function replaceScan(report, value) {
  for (const key of Object.keys(report)) delete report[key];
  Object.assign(report, value);
}
function cleanBrowser() {
  return {
    config: { projects: [{ name: 'chromium' }, { name: 'firefox' }, { name: 'webkit' }] },
    suites: [],
    errors: [],
    stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 },
  };
}
const reportFiles = {
  browser: 'browser.json',
  webImage: 'web-image-scan.json',
  apiImage: 'api-image-scan.json',
  metadata: 'metadata-scan.json',
  publicFiles: 'public-files-scan.json',
};

// Real runtime and filesystem boundaries; Docker, GitHub, scanner and publisher
// effects are injected simulations. A pass does not establish live image/IAM trust.
async function imageHarness(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'stara-pipeline-author-'));
  cleanup.push(root);
  const runId = 'synthetic-run';
  const evidenceDirectory = join(root, '.artifacts/release-pipeline', runId);
  const calls = [];
  const publicOutput = [];
  const fetchCalls = [];
  const tags = new Map();
  const f = {
    root,
    runId,
    evidenceDirectory,
    calls,
    publicOutput,
    fetchCalls,
    tags,
    clock: clock(),
    dirty: false,
    head: sha,
    statusCalls: 0,
    builds: 0,
  };
  for (const path of [
    'UI/web/release.Dockerfile',
    'backend/api/release.Dockerfile',
    'tests/e2e/release.compose.yaml',
    'tests/e2e/release.config.ts',
  ])
    await write(join(root, path), 'synthetic fixture only\n');
  const localPath = (path) =>
    path.startsWith('/evidence/')
      ? join(evidenceDirectory, path.slice('/evidence/'.length))
      : isAbsolute(path)
        ? path
        : resolve(root, path);
  const valueAfter = (args, names) => {
    const index = args.findIndex((arg) => names.includes(arg));
    return index < 0 ? undefined : args[index + 1];
  };
  const runner = async (executable, args, settings) => {
    const call = { executable, args: [...args], settings };
    calls.push(call);
    expect(Array.isArray(args)).toBe(true);
    expect(settings.shell ?? false).toBe(false);
    expect(settings.timeout).toBeGreaterThan(0);
    expect(settings.timeout).toBeLessThanOrEqual(25 * minute);
    if (options.command) {
      const override = await options.command(call, f);
      if (override !== undefined) return override;
    }
    if (executable === 'git') {
      if (args[0] === 'status') {
        f.statusCalls++;
        return ok(f.dirty ? ' M synthetic-source.ts\n' : '');
      }
      if (args[0] === 'rev-parse')
        return ok(`${args.some((arg) => arg.includes('tree')) ? 'a'.repeat(40) : f.head}\n`);
      if (args[0] === 'diff') return ok();
      throw new Error('Unexpected synthetic Git operation');
    }
    if (executable === 'docker') {
      if (args[0] === 'ps') {
        expect(args).toEqual([
          'ps',
          '--all',
          '--filter',
          `label=com.docker.compose.project=stara-release-${runId}`,
          '--quiet',
        ]);
        return ok();
      }
      if (args[0] === 'build') {
        const component = args.some((arg) => arg.includes('UI/web/')) ? 'web' : 'api';
        const iid = valueAfter(args, ['--iidfile']);
        const tag = valueAfter(args, ['--tag', '-t']);
        expect(iid).toBeDefined();
        expect(tag).toBeDefined();
        await write(localPath(iid), `${imageIds[component]}\n`);
        tags.set(tag, imageIds[component]);
        f.builds++;
        return ok(canary);
      }
      if (args[0] === 'pull') {
        expect(args).toEqual(['pull', gatewayImage]);
        f.gatewayAvailable = true;
        return ok(canary);
      }
      if (args[0] === 'compose') {
        if (options.coldGateway && args.includes('up') && !f.gatewayAvailable)
          throw new Error('Synthetic cold daemon has no gateway image');
        return ok(canary);
      }
      if (args.includes('inspect')) {
        const ref = args.at(-1);
        const imageId = tags.get(ref) ?? (Object.values(imageIds).includes(ref) ? ref : undefined);
        if (!imageId) throw new Error('Unknown synthetic image');
        const component = imageId === imageIds.web ? 'web' : 'api';
        return ok(
          JSON.stringify([
            {
              Id: imageId,
              RepoTags: [ref],
              RepoDigests: [`${registryNames[component]}@${digests[component]}`],
              Config: { Env: ['NODE_ENV=production'], Labels: { 'synthetic-label': canary } },
            },
          ]),
        );
      }
      if (args.includes('save')) {
        const path = valueAfter(args, ['--output', '-o']);
        await write(localPath(path), `synthetic archive ${args.at(-1)}`);
        return ok();
      }
      if (args[0] === 'create') return ok('synthetic-extraction-container\n');
      if (args[0] === 'cp') {
        await write(
          join(localPath(args.at(-1)), 'index.html'),
          '<main>Synthetic public app</main>',
        );
        return ok();
      }
      if (args[0] === 'rm') return ok();
      if (args[0] === 'tag' || (args[0] === 'image' && args[1] === 'tag')) {
        tags.set(args.at(-1), tags.get(args.at(-2)) ?? args.at(-2));
        return ok();
      }
      if (args[0] === 'push' || (args[0] === 'image' && args[1] === 'push')) return ok(canary);
      if (args[0] === 'run') {
        const output = valueAfter(args, ['--output', '-o']);
        expect(args).toContain(scanner);
        expect(output).toBeDefined();
        const scan = cleanScan();
        options.scan?.(scan, basename(output));
        await write(localPath(output), scan);
        return ok(canary);
      }
      throw new Error('Unexpected synthetic Docker operation');
    }
    if (args.includes('playwright')) {
      const output = settings.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
      expect(output).toBeDefined();
      const report = cleanBrowser();
      options.browser?.(report);
      await write(localPath(output), report);
      return ok(canary);
    }
    throw new Error('Unexpected synthetic executable');
  };
  const fetcher = vi.fn(async (url, optionsArg) => {
    fetchCalls.push({ url: String(url), options: optionsArg });
    if (options.fetch) return options.fetch(url, optionsArg);
    return {
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/health')
          ? { status: 'ok' }
          : { schemaVersion: 1, environment: 'staging' },
    };
  });
  f.runtime = createRuntime({
    root,
    runId,
    pnpmPath: join(root, 'pnpm.cjs'),
    run: runner,
    fetch: fetcher,
    output: (value) => publicOutput.push(value),
    env: {
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: sha,
      GITHUB_RUN_ID: runs.images.id,
      GITHUB_RUN_ATTEMPT: String(runs.images.attempt),
      GITHUB_REPOSITORY_ID: repositoryId,
      GITHUB_REPOSITORY: 'stara-labs/stara',
      STARA_RELEASE_PORT: '8173',
    },
  });
  f.verify = (extra = {}) =>
    pipeline.verifyImages({
      sourceSha: sha,
      mode: 'ci',
      runtime: f.runtime,
      clock: f.clock,
      trivyImage: scanner,
      ...extra,
    });
  return f;
}
async function receiptFixture(f, mode = 'ci') {
  const reports = {};
  for (const [name, path] of Object.entries(reportFiles)) {
    const raw = bytes(name === 'browser' ? cleanBrowser() : cleanScan());
    await write(join(f.evidenceDirectory, path), raw);
    reports[name] = { path, sha256: hash(raw) };
  }
  const images = {
    web: { imageId: imageIds.web, tag: 'stara-release-web:synthetic-run' },
    api: { imageId: imageIds.api, tag: 'stara-release-api:synthetic-run' },
  };
  for (const image of Object.values(images)) f.tags.set(image.tag, image.imageId);
  const receipt = {
    schemaVersion: 1,
    sourceSha: sha,
    mode,
    runId: f.runId,
    images,
    verified: true,
    reports,
  };
  const raw = bytes(receipt);
  await write(join(f.evidenceDirectory, 'verified.json'), raw);
  return {
    schemaVersion: 1,
    sourceSha: sha,
    mode,
    runId: f.runId,
    images,
    evidenceDirectory: f.evidenceDirectory,
    receiptSha256: hash(raw),
    verified: true,
  };
}
async function symlinkEvidence(f) {
  if (process.platform === 'win32') {
    const outside = join(f.root, 'outside-evidence');
    await rename(f.evidenceDirectory, outside);
    await symlink(outside, f.evidenceDirectory, 'junction');
  } else {
    const target = join(f.evidenceDirectory, reportFiles.browser);
    const outside = join(f.root, 'outside-report.json');
    await write(outside, await readFile(target));
    await rm(target);
    await symlink(outside, target);
  }
}
async function publisher(options = {}) {
  const f = await imageHarness();
  const verified = await receiptFixture(f);
  const coverageRecords = ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'].map(
    (target) => ({ target, sourceSha: sha, complete: true, lines: 90, branches: 85 }),
  );
  const envelope = {
    schemaVersion: 1,
    sourceSha: sha,
    runId: runs.scaffold.id,
    runAttempt: runs.scaffold.attempt,
    coverage: coverageRecords,
  };
  options.coverage?.(envelope);
  const coverageBytes = bytes(envelope);
  const coverage = {
    path: join(f.evidenceDirectory, 'coverage-input.json'),
    sha256: hash(coverageBytes),
  };
  await write(coverage.path, coverageBytes);
  const puts = [];
  const attest = vi.fn(async (args) => {
    const bundle = Buffer.from(`synthetic attestation bytes for ${args.component}`);
    const result = {
      bundle,
      verification: {
        verified: true,
        sourceSha: sha,
        repositoryId,
        workflowRef: 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main',
        imageDigest: digests[args.component],
        attestationSha256: hash(bundle),
        runId: runs.images.id,
        runAttempt: runs.images.attempt,
      },
    };
    options.attestation?.(result, args);
    return result;
  });
  const storage = {
    put: vi.fn(async (input) => {
      puts.push(input);
      return options.put ? options.put(input) : { created: true };
    }),
  };
  const args = {
    verified,
    checks: copy(expectedChecks),
    coverage,
    imagesRun: copy(runs.images),
    repositoryId,
    runtime: f.runtime,
    registry: { ...registryNames, attest },
    storage,
  };
  return {
    ...f,
    args,
    puts,
    attest,
    publish: (extra = {}) => pipeline.publishCandidate({ ...args, ...extra }),
  };
}
function publicationEffects(f) {
  return f.calls.filter(
    ({ args }) => args.includes('push') || args.includes('tag') || args.includes('build'),
  );
}
async function sanitizedRejection(operation) {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(String(error.message)).toMatch(/\S/);
  expect(String(error.message)).not.toContain(canary);
  expect(String(error.stack)).not.toContain(canary);
  expect(error.cause).toBeUndefined();
}

describe('REL-02/03 pipeline waits for exact trusted mainline checks', () => {
  it('accepts the exact Scaffold and dynamic CodeQL workflows and all seven required jobs', async () => {
    const f = github();
    expect(
      await pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    ).toEqual(expectedChecks);
    const queries = f.calls.filter(
      ({ route }) => route.includes('/workflows/') && route.endsWith('/runs'),
    );
    expect(queries.map(({ parameters }) => String(parameters.workflow_id)).sort()).toEqual([
      '354641209',
      '355366692',
    ]);
    for (const { parameters } of queries)
      expect(parameters).toMatchObject({ head_sha: sha, branch: 'main', event: 'push' });
    for (const { parameters } of f.calls) {
      expect(parameters.request.signal).toBeInstanceOf(AbortSignal);
      expect(parameters.request.timeout).toBeGreaterThan(0);
      expect(parameters.request.timeout).toBeLessThanOrEqual(20 * minute);
    }
  });

  it.each([
    [
      'wrong repository',
      (run) => {
        run.repository.id = 999999;
      },
    ],
    [
      'fork head',
      (run) => {
        run.head_repository.id = 999999;
      },
    ],
    [
      'wrong SHA',
      (run) => {
        run.head_sha = 'a'.repeat(40);
      },
    ],
    [
      'wrong branch',
      (run) => {
        run.head_branch = 'feature';
      },
    ],
    [
      'PR event',
      (run) => {
        run.event = 'pull_request';
      },
    ],
    [
      'wrong workflow ID',
      (run) => {
        run.workflow_id = 999999;
      },
    ],
    [
      'wrong workflow path',
      (run) => {
        run.path = '.github/workflows/codeql.yml';
      },
    ],
    [
      'failed',
      (run) => {
        run.conclusion = 'failure';
      },
    ],
    [
      'cancelled',
      (run) => {
        run.conclusion = 'cancelled';
      },
    ],
    [
      'skipped',
      (run) => {
        run.conclusion = 'skipped';
      },
    ],
  ])('denies %s evidence even when a successful list result exists', async (_name, mutate) => {
    const f = github({ run: mutate });
    await sanitizedRejection(() =>
      pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    );
  });

  it.each([
    [
      'missing image job',
      (jobs, kind) => {
        if (kind === 'scaffold') jobs.pop();
      },
    ],
    [
      'missing Actions analysis',
      (jobs, kind) => {
        if (kind === 'codeql') jobs.pop();
      },
    ],
    [
      'skipped job',
      (jobs) => {
        jobs[0].conclusion = 'skipped';
      },
    ],
    [
      'failed job',
      (jobs) => {
        jobs[0].conclusion = 'failure';
      },
    ],
    [
      'wrong attempt job',
      (jobs) => {
        jobs[0].run_attempt++;
      },
    ],
    [
      'wrong source job',
      (jobs) => {
        jobs[0].head_sha = 'a'.repeat(40);
      },
    ],
    [
      'duplicate job',
      (jobs) => {
        jobs.push(jobs[0]);
      },
    ],
  ])('denies %s', async (_name, mutate) => {
    const f = github({ jobs: mutate });
    await sanitizedRejection(() =>
      pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    );
  });

  it('does not mistake a selected job page for complete prerequisite evidence', async () => {
    const f = github({ jobTotal: 1001 });
    await sanitizedRejection(() =>
      pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    );
    expect(f.calls.length).toBeLessThan(100);
  });

  it('polls incomplete runs within the original deadline and later accepts completed evidence', async () => {
    const f = github({
      list: (run, _kind, count) => {
        if (count < 2) {
          run.status = 'in_progress';
          run.conclusion = null;
        }
      },
    });
    expect(
      await pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    ).toEqual(expectedChecks);
    expect(f.clock.sleep).toHaveBeenCalled();
    expect(f.clock.now()).toBeLessThan(startedAt + 20 * minute);
  });

  it('stops waiting after twenty minutes instead of resetting the deadline', async () => {
    const f = github({
      list: (run) => {
        run.status = 'queued';
        run.conclusion = null;
      },
    });
    f.clock.sleep.mockImplementation(async () => f.clock.advance(5 * minute));
    await sanitizedRejection(() =>
      pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    );
    expect(f.clock.sleep.mock.calls.length).toBeLessThanOrEqual(4);
    expect(f.calls.length).toBeLessThan(50);
  });

  it('rejects a superseded main candidate and sanitized API failures', async () => {
    const f = github({ mainSha: 'a'.repeat(40) });
    await sanitizedRejection(() =>
      pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: f.request,
        clock: f.clock,
      }),
    );
    await sanitizedRejection(() =>
      pipeline.awaitMainChecks({
        sourceSha: sha,
        repositoryId,
        request: async () => {
          throw new Error(canary);
        },
        clock: clock(),
      }),
    );
  });
});

describe('REL-02/03 latest CodeQL workflow-run selection', () => {
  const selectedRun = () => nativeRun('codeql');
  const olderRun = () => ({
    ...selectedRun(),
    id: 900,
    run_number: 99,
    conclusion: 'failure',
  });
  const awaitChecks = (f) =>
    pipeline.awaitMainChecks({ sourceSha: sha, repositoryId, request: f.request, clock: f.clock });
  const inventoryCall = ({ route, parameters }) =>
    route.endsWith('/workflows/{workflow_id}/runs') &&
    String(parameters.workflow_id) === String(workflows.codeql.id);
  const selectedCalls = (f) =>
    f.calls.filter(({ parameters }) => String(parameters.run_id) === runs.codeql.id);

  it.each([false, true])(
    'selects greatest run_number despite older failed higher ID and response order reversed=%s',
    async (reverse) => {
      const entries = [olderRun(), selectedRun(), { ...olderRun(), id: 901, run_number: 100 }];
      if (reverse) entries.reverse();
      const f = codeqlHistory(entries);
      expect(await awaitChecks(f)).toEqual(expectedChecks);
      for (const { parameters } of f.calls.filter(inventoryCall)) {
        expect(parameters).toMatchObject({
          workflow_id: String(workflows.codeql.id),
          head_sha: sha,
          branch: 'main',
          event: 'push',
          per_page: 100,
          page: 1,
        });
        expect(parameters).not.toHaveProperty('status');
      }
      const calls = selectedCalls(f);
      const current = calls.findIndex(({ route }) => route.endsWith('/actions/runs/{run_id}'));
      const attempt = calls.findIndex(({ route }) => route.endsWith('/attempts/{attempt_number}'));
      const jobs = calls.findIndex(({ route }) => route.endsWith('/jobs'));
      expect(current).toBeGreaterThanOrEqual(0);
      expect(attempt).toBeGreaterThan(current);
      expect(jobs).toBeGreaterThan(attempt);
      expect(calls[attempt].parameters.attempt_number).toBe(runs.codeql.attempt);
      expect(calls[jobs].parameters.attempt_number).toBe(runs.codeql.attempt);
      expect(
        f.calls.some(({ parameters }) => ['900', '901'].includes(String(parameters.run_id))),
      ).toBe(false);
    },
  );

  it.each(['failure', 'queued', 'in_progress'])(
    'never falls back to older success when newest is %s',
    async (status) => {
      const newest = selectedRun();
      if (status === 'failure') newest.conclusion = status;
      else Object.assign(newest, { status, conclusion: null });
      const f = codeqlHistory(
        [{ ...olderRun(), conclusion: 'success' }, newest],
        (result, route, parameters) => {
          if (String(parameters.run_id) === runs.codeql.id && !route.endsWith('/jobs'))
            Object.assign(result.data, newest);
        },
      );
      f.clock.sleep.mockImplementation(async () => f.clock.advance(5 * minute));
      await sanitizedRejection(() => awaitChecks(f));
      expect(f.calls.some(({ parameters }) => String(parameters.run_id) === '900')).toBe(false);
      expect(selectedCalls(f).some(({ route }) => route.endsWith('/jobs'))).toBe(false);
      expect(f.clock.now()).toBeLessThanOrEqual(startedAt + 20 * minute);
      expect(f.calls.length).toBeLessThan(100);
    },
  );

  it.each([
    'duplicate-id',
    'tied-greatest-number',
    'missing-number',
    'zero-number',
    'string-number',
    'unsafe-number',
    'count-mismatch',
    'string-count',
    'empty',
    'missing-array',
    'over-100',
    'next-page',
  ])('denies ambiguous or incomplete %s inventory', async (scenario) => {
    const f = codeqlHistory([olderRun(), selectedRun()], (result, route, parameters) => {
      if (!inventoryCall({ route, parameters })) return;
      const inventory = result.data;
      const older = inventory.workflow_runs[0];
      if (scenario === 'duplicate-id') older.id = String(runs.codeql.id);
      if (scenario === 'tied-greatest-number') older.run_number = selectedRun().run_number;
      if (scenario === 'missing-number') delete older.run_number;
      if (scenario === 'zero-number') older.run_number = 0;
      if (scenario === 'string-number') older.run_number = '99';
      if (scenario === 'unsafe-number') older.run_number = Number.MAX_SAFE_INTEGER + 1;
      if (scenario === 'count-mismatch') inventory.total_count++;
      if (scenario === 'string-count') inventory.total_count = '2';
      if (scenario === 'empty') Object.assign(inventory, { total_count: 0, workflow_runs: [] });
      if (scenario === 'missing-array') delete inventory.workflow_runs;
      if (scenario === 'over-100') {
        inventory.workflow_runs = Array.from({ length: 101 }, (_value, index) => ({
          ...selectedRun(),
          id: 1000 + index,
          run_number: index + 1,
        }));
        inventory.total_count = 101;
      }
      if (scenario === 'next-page')
        result.headers.Link = '<https://api.github.com/synthetic-page>; rel="next"';
    });
    await sanitizedRejection(() => awaitChecks(f));
    expect(selectedCalls(f)).toEqual([]);
    expect(f.calls.length).toBeLessThan(100);
  });

  it.each(['workflow', 'path', 'source', 'branch', 'event', 'repository', 'fork'])(
    'denies a wrong %s identity in an older inventory entry',
    async (scenario) => {
      const older = olderRun();
      if (scenario === 'workflow') older.workflow_id++;
      if (scenario === 'path') older.path = '.github/workflows/codeql.yml';
      if (scenario === 'source') older.head_sha = 'a'.repeat(40);
      if (scenario === 'branch') older.head_branch = 'feature';
      if (scenario === 'event') older.event = 'pull_request';
      if (scenario === 'repository') older.repository.id++;
      if (scenario === 'fork') older.head_repository.id++;
      const f = codeqlHistory([older, selectedRun()]);
      await sanitizedRejection(() => awaitChecks(f));
      expect(selectedCalls(f)).toEqual([]);
    },
  );

  it.each(['current-attempt', 'current-number', 'attempt-number'])(
    'denies %s changing after the selected inventory snapshot',
    async (scenario) => {
      const f = codeqlHistory([selectedRun()], (result, route, parameters) => {
        if (String(parameters.run_id) !== runs.codeql.id) return;
        if (route.endsWith('/actions/runs/{run_id}')) {
          if (scenario === 'current-attempt') result.data.run_attempt++;
          if (scenario === 'current-number') result.data.run_number++;
        }
        if (scenario === 'attempt-number' && route.endsWith('/attempts/{attempt_number}'))
          result.data.run_number++;
      });
      await sanitizedRejection(() => awaitChecks(f));
      expect(selectedCalls(f).some(({ route }) => route.endsWith('/jobs'))).toBe(false);
    },
  );
});

describe('REL-02/09/10/11 build and verify exact local image bytes', () => {
  it.each(['metadata', 'publicFiles'])(
    'accepts the pinned Trivy filesystem %s empty-result envelope and revalidates its receipt',
    async (kind) => {
      const f = await imageHarness({
        scan: (report, name) => {
          if (name === reportFiles[kind]) replaceScan(report, emptyFilesystemScan(kind));
        },
      });
      const verified = await f.verify();
      expect(verified.verified).toBe(true);
      expect(await pipeline.checkImageEvidence({ runtime: f.runtime, verified })).toBe(true);
      const raw = JSON.parse(await readFile(join(f.evidenceDirectory, reportFiles[kind])));
      expect(raw).not.toHaveProperty('Results');
      expect(raw).toEqual(emptyFilesystemScan(kind));
    },
  );

  it.each([
    'wrong-version',
    'missing-version',
    'extra-version-field',
    'invalid-id',
    'uppercase-id',
    'invalid-time',
    'rolled-over-time',
    'missing-time',
    'wrong-name',
    'wrong-type',
    'extra-key',
    'null-results',
    'secret-result',
    'high-result',
  ])(
    'denies Trivy filesystem %s without treating absent Results as blanket success',
    async (scenario) => {
      const f = await imageHarness({
        scan: (report, name) => {
          if (name !== reportFiles.metadata) return;
          const value = emptyFilesystemScan('metadata');
          if (scenario === 'wrong-version') value.Trivy.Version = '0.73.0';
          if (scenario === 'missing-version') delete value.Trivy;
          if (scenario === 'extra-version-field') value.Trivy.Private = canary;
          if (scenario === 'invalid-id') value.ReportID = canary;
          if (scenario === 'uppercase-id') value.ReportID = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
          if (scenario === 'invalid-time') value.CreatedAt = '2026-99-99T01:00:00Z';
          if (scenario === 'rolled-over-time') value.CreatedAt = '2026-02-30T01:00:00.123Z';
          if (scenario === 'missing-time') delete value.CreatedAt;
          if (scenario === 'wrong-name') value.ArtifactName = '/evidence/public-files';
          if (scenario === 'wrong-type') value.ArtifactType = 'container_image';
          if (scenario === 'extra-key') value.untrusted = canary;
          if (scenario === 'null-results') value.Results = null;
          if (scenario === 'secret-result')
            value.Results = [
              { Target: 'synthetic', Secrets: [{ Match: canary, Severity: 'LOW' }] },
            ];
          if (scenario === 'high-result')
            value.Results = [
              {
                Target: 'synthetic',
                Vulnerabilities: [{ VulnerabilityID: 'CVE-2099-0003', Severity: 'HIGH' }],
              },
            ];
          replaceScan(report, value);
        },
      });
      await sanitizedRejection(() => f.verify());
      await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
    },
  );

  it.each(['webImage', 'apiImage'])(
    'denies an empty filesystem envelope substituted for the %s image scan',
    async (kind) => {
      const f = await imageHarness({
        scan: (report, name) => {
          if (name === reportFiles[kind]) replaceScan(report, emptyFilesystemScan('metadata'));
        },
      });
      await sanitizedRejection(() => f.verify());
      await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
    },
  );

  it('uses the existing browser artifact run naming contract for release journeys', async () => {
    const f = await imageHarness();
    await f.verify();
    const browser = f.calls.find(({ args }) => args.includes('playwright'));
    const runId = browser.settings.env.STARA_E2E_RUN_ID;
    const result = artifactPaths(join(f.evidenceDirectory, 'browser-artifacts'), runId);
    expect(result.runId).toBe(`run-release-${f.runId}`);
  });

  it('builds once, runs exact IDs, probes real staging config, scans all surfaces and writes a bound receipt', async () => {
    const f = await imageHarness();
    const verified = await f.verify();
    expect(verified).toMatchObject({
      schemaVersion: 1,
      sourceSha: sha,
      mode: 'ci',
      runId: f.runId,
      evidenceDirectory: f.evidenceDirectory,
      verified: true,
    });
    expect(f.builds).toBe(2);
    expect(verified.images.web.imageId).toBe(imageIds.web);
    expect(verified.images.api.imageId).toBe(imageIds.api);
    const compose = f.calls.filter(({ args }) => args[0] === 'compose');
    const inventory = f.calls.findIndex(
      ({ executable, args }) => executable === 'docker' && args[0] === 'ps',
    );
    expect(inventory).toBeGreaterThanOrEqual(0);
    expect(inventory).toBeLessThan(
      f.calls.findIndex(({ args }) => args[0] === 'compose' && args.includes('up')),
    );
    expect(compose.some(({ args }) => args.includes('up'))).toBe(true);
    expect(compose.some(({ args }) => args.includes('down'))).toBe(true);
    for (const { args, settings } of compose) {
      expect(args).toContain('stara-release-synthetic-run');
      expect(
        args.some((arg) => arg.replaceAll('\\', '/').endsWith('tests/e2e/release.compose.yaml')),
      ).toBe(true);
      expect(args).not.toContain('--build');
      expect(settings.env).toMatchObject({
        STARA_RELEASE_WEB_IMAGE: imageIds.web,
        STARA_RELEASE_API_IMAGE: imageIds.api,
      });
    }
    expect(f.fetchCalls.map((entry) => entry.url).sort()).toEqual([
      'http://127.0.0.1:8173/api/health',
      'http://127.0.0.1:8173/api/runtime-config',
    ]);
    const browser = f.calls.find(({ args }) => args.includes('playwright'));
    expect(browser.args).toEqual(
      expect.arrayContaining([
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/e2e/release.config.ts',
      ]),
    );
    expect(browser.args).not.toContain('--project');
    expect(browser.settings.env.STARA_E2E_BASE_URL).toBe('http://127.0.0.1:8173');
    const scans = f.calls.filter(({ args }) => args[0] === 'run' && args.includes(scanner));
    expect(scans).toHaveLength(4);
    expect(scans.filter(({ args }) => args.includes('image'))).toHaveLength(2);
    expect(scans.filter(({ args }) => args.includes('fs'))).toHaveLength(2);
    for (const { args } of scans) {
      expect(args).toContain('--output');
      expect(args.join(' ')).not.toContain('docker.sock');
    }
    const raw = await readFile(join(f.evidenceDirectory, 'verified.json'));
    expect(hash(raw)).toBe(verified.receiptSha256);
    const receipt = JSON.parse(raw);
    expect(Object.keys(receipt.reports).sort()).toEqual(Object.keys(reportFiles).sort());
    for (const report of Object.values(receipt.reports))
      expect(hash(await readFile(join(f.evidenceDirectory, report.path)))).toBe(report.sha256);
    expect(JSON.stringify(f.publicOutput)).not.toContain(canary);
    expect(f.statusCalls).toBeGreaterThanOrEqual(2);
    expect(
      f.calls.every(
        ({ executable, args }) =>
          !['sh', 'bash', 'cmd', 'powershell', 'gcloud'].includes(executable) &&
          !args.includes('prune') &&
          !args.includes('--volumes'),
      ),
    ).toBe(true);
  });

  it('denies a preexisting Docker project without starting or cleaning its containers', async () => {
    const f = await imageHarness({
      command: ({ executable, args }) => {
        if (executable === 'docker' && args[0] === 'ps')
          return ok('synthetic-preexisting-container\n');
      },
    });
    await sanitizedRejection(() => f.verify());
    expect(
      f.calls.some(
        ({ args }) => args[0] === 'compose' && (args.includes('up') || args.includes('down')),
      ),
    ).toBe(false);
    expect(
      f.calls.some(({ executable, args }) => executable === 'docker' && args[0] === 'rm'),
    ).toBe(false);
    await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
  });

  it('prepares only the approved gateway image on a cold daemon before Compose, preserving built application IDs', async () => {
    const f = await imageHarness({ coldGateway: true });
    const verified = await f.verify();
    const pulls = f.calls.filter(
      ({ executable, args }) => executable === 'docker' && args[0] === 'pull',
    );
    expect(pulls).toHaveLength(1);
    expect(pulls[0].args).toEqual(['pull', gatewayImage]);
    expect(f.calls.indexOf(pulls[0])).toBeLessThan(
      f.calls.findIndex(({ args }) => args[0] === 'compose' && args.includes('up')),
    );
    expect(verified.images.web.imageId).toBe(imageIds.web);
    expect(verified.images.api.imageId).toBe(imageIds.api);
    expect(f.builds).toBe(2);
  });

  it.each(['development', 'production', ''])(
    'denies invalid mode %s before Docker',
    async (mode) => {
      const f = await imageHarness();
      await sanitizedRejection(() => f.verify({ mode }));
      expect(f.builds).toBe(0);
    },
  );

  it.each(['dirty', 'wrong-head'])('denies %s CI source before building', async (state) => {
    const f = await imageHarness();
    if (state === 'dirty') f.dirty = true;
    else f.head = 'a'.repeat(40);
    await sanitizedRejection(() => f.verify());
    expect(f.builds).toBe(0);
  });

  it('labels dirty local evaluation working-tree and never turns it into CI evidence', async () => {
    const f = await imageHarness();
    f.dirty = true;
    const result = await f.verify({ mode: 'working-tree' });
    expect(result.mode).toBe('working-tree');
    expect(JSON.parse(await readFile(join(f.evidenceDirectory, 'verified.json'))).mode).toBe(
      'working-tree',
    );
  });

  it.each([
    'aquasec/trivy:latest',
    'aquasec/trivy:0.74.0',
    `aquasec/trivy:0.74.0@sha256:${'6'.repeat(64)}`,
    `ghcr.io/aquasecurity/trivy@sha256:${'6'.repeat(64)}`,
    `synthetic-attacker.example/trivy@sha256:${'6'.repeat(64)}`,
  ])('denies unapproved scanner case %#', async (trivyImage) => {
    const f = await imageHarness();
    await sanitizedRejection(() => f.verify({ trivyImage }));
    expect(f.builds).toBe(0);
  });

  it('does not reuse an existing evidence directory or delete another run', async () => {
    const f = await imageHarness();
    await write(join(f.evidenceDirectory, 'sentinel'), canary);
    await sanitizedRejection(() => f.verify());
    expect(await readFile(join(f.evidenceDirectory, 'sentinel'), 'utf8')).toBe(canary);
    expect(f.builds).toBe(0);
  });

  it.each([
    ['wrong environment', { schemaVersion: 1, environment: 'development' }],
    ['extra secret', { schemaVersion: 1, environment: 'staging', secret: canary }],
    ['missing config', {}],
  ])(
    'rejects actual image %s before browser testing even if intercepted browser fixtures would pass',
    async (_name, runtimeConfig) => {
      const f = await imageHarness({
        fetch: async (url) => ({
          ok: true,
          status: 200,
          json: async () =>
            String(url).endsWith('/api/health') ? { status: 'ok' } : runtimeConfig,
        }),
      });
      await sanitizedRejection(() => f.verify());
      expect(f.calls.some(({ args }) => args.includes('playwright'))).toBe(false);
      expect(f.calls.some(({ args }) => args[0] === 'compose' && args.includes('down'))).toBe(true);
      await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
    },
  );

  it.each([
    [
      'secret',
      (report) => {
        report.Results[0].Secrets = [{ RuleID: 'synthetic', Match: canary, Severity: 'LOW' }];
      },
    ],
    [
      'critical vulnerability',
      (report) => {
        report.Results[0].Vulnerabilities = [
          { VulnerabilityID: 'CVE-2099-0001', Severity: 'CRITICAL', Title: canary },
        ];
      },
    ],
    [
      'high vulnerability',
      (report) => {
        report.Results[0].Vulnerabilities = [
          { VulnerabilityID: 'CVE-2099-0002', Severity: 'HIGH' },
        ];
      },
    ],
    [
      'malformed report',
      (report) => {
        delete report.Results;
      },
    ],
  ])(
    'rejects scanner %s despite exit zero without publishing raw findings',
    async (_name, mutate) => {
      const f = await imageHarness({ scan: mutate });
      await sanitizedRejection(() => f.verify());
      expect(JSON.stringify(f.publicOutput)).not.toContain(canary);
      await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
    },
  );

  it.each(['skipped', 'unexpected', 'flaky'])(
    'denies browser report with %s tests despite exit zero',
    async (field) => {
      const f = await imageHarness({
        browser: (report) => {
          report.stats[field] = 1;
        },
      });
      await sanitizedRejection(() => f.verify());
      expect(f.calls.some(({ args }) => args[0] === 'compose' && args.includes('down'))).toBe(true);
    },
  );

  it('fails closed when a scanner process rejects and cleanup also fails, without echoing either cause', async () => {
    const f = await imageHarness({
      command: ({ args }) => {
        if (
          (args[0] === 'run' && args.includes(scanner)) ||
          (args[0] === 'compose' && args.includes('down'))
        )
          throw new Error(canary);
      },
    });
    await sanitizedRejection(() => f.verify());
    expect(JSON.stringify(f.publicOutput)).not.toContain(canary);
    expect(f.calls.some(({ args }) => args[0] === 'compose' && args.includes('down'))).toBe(true);
    await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
  });

  it('stops after the original 25-minute build deadline and never creates a verified receipt', async () => {
    const f = await imageHarness({
      command: ({ args }, state) => {
        if (args[0] === 'build') state.clock.advance(26 * minute);
      },
    });
    await sanitizedRejection(() => f.verify());
    expect(f.builds).toBeLessThanOrEqual(1);
    expect(f.calls.some(({ args }) => args.includes('playwright'))).toBe(false);
    await expect(access(join(f.evidenceDirectory, 'verified.json'))).rejects.toThrow();
  });
});

describe('REL-02/03/04/10 immutable receipt publication', () => {
  it('accepts original pinned Trivy empty filesystem reports during immutable receipt publication', async () => {
    const f = await publisher();
    const path = join(f.evidenceDirectory, 'verified.json');
    const receipt = JSON.parse(await readFile(path));
    for (const kind of ['metadata', 'publicFiles']) {
      const raw = bytes(emptyFilesystemScan(kind));
      await write(join(f.evidenceDirectory, reportFiles[kind]), raw);
      receipt.reports[kind].sha256 = hash(raw);
    }
    const raw = bytes(receipt);
    await write(path, raw);
    f.args.verified.receiptSha256 = hash(raw);
    const result = await f.publish();
    expect(result.manifest.runs.codeql).toEqual(runs.codeql);
    expect(f.puts).toHaveLength(4);
  });
  it('publishes exactly the tested IDs, real attestation bytes and source-bound coverage, then strict manifest last', async () => {
    const f = await publisher();
    expect(f.args).not.toHaveProperty('configurationSha256');
    const result = await f.publish();
    expect(f.builds).toBe(0);
    const pushes = f.calls.filter(({ args }) => args.includes('push'));
    expect(pushes).toHaveLength(2);
    for (const component of ['web', 'api']) {
      const tag = `${registryNames[component]}:sha-${sha}-run-${runs.images.id}-${runs.images.attempt}`;
      expect(pushes.some(({ args }) => args.includes(tag))).toBe(true);
      expect(f.tags.get(tag)).toBe(imageIds[component]);
      expect(f.attest).toHaveBeenCalledWith(
        expect.objectContaining({
          component,
          subjectName: registryNames[component],
          subjectDigest: digests[component],
          sourceSha: sha,
          runId: runs.images.id,
          runAttempt: runs.images.attempt,
        }),
      );
    }
    expect(f.attest).toHaveBeenCalledTimes(2);
    expect(f.puts).toHaveLength(4);
    const manifestPut = f.puts.at(-1);
    expect(manifestPut.key).toBe(`manifests/${hash(manifestPut.bytes)}.json`);
    expect(parseManifest(manifestPut.bytes, result.manifestSha256)).toEqual(result.manifest);
    expect(result.manifest).toMatchObject({
      schemaVersion: 1,
      sourceSha: sha,
      repositoryId,
      runs: { scaffold: runs.scaffold, images: runs.images, codeql: runs.codeql },
      images: { web: { digest: digests.web }, api: { digest: digests.api } },
    });
    const uploadedCoverage = f.puts.find((entry) => entry.key.startsWith('coverage/'));
    expect(uploadedCoverage.key).toBe(`coverage/${sha}/101-1.json`);
    expect(JSON.parse(Buffer.from(uploadedCoverage.bytes).toString())).toHaveLength(4);
    for (const put of f.puts) {
      expect(put.ifAbsent).toBe(true);
      expect(put.key).toMatch(
        /^(attestations\/[a-f0-9]{64}\.jsonl|coverage\/[a-f0-9]{40}\/101-1\.json|manifests\/[a-f0-9]{64}\.json)$/,
      );
      expect(Buffer.from(put.bytes).toString()).not.toContain(canary);
    }
    expect(JSON.stringify(f.publicOutput)).not.toContain(canary);
    expect(
      f.calls.every(
        ({ executable, args }) =>
          executable !== 'gcloud' && !args.includes('deploy') && !args.includes('set-iam-policy'),
      ),
    ).toBe(true);
  });

  it.each(['missing', 'changed-receipt', 'changed-report', 'memory-only', 'working-tree'])(
    'denies %s verification evidence before any publisher mutation',
    async (mode) => {
      const f = await publisher();
      if (mode === 'missing') await rm(join(f.evidenceDirectory, 'verified.json'));
      if (mode === 'changed-receipt')
        await write(join(f.evidenceDirectory, 'verified.json'), canary);
      if (mode === 'changed-report')
        await write(join(f.evidenceDirectory, reportFiles.browser), canary);
      if (mode === 'memory-only') f.args.verified.images.web.imageId = `sha256:${'a'.repeat(64)}`;
      if (mode === 'working-tree') f.args.verified = await receiptFixture(f, 'working-tree');
      await sanitizedRejection(() => f.publish());
      expect(publicationEffects(f)).toEqual([]);
      expect(f.puts).toEqual([]);
      expect(f.attest).not.toHaveBeenCalled();
    },
  );

  it('rejects symlinked evidence bytes even when their hash matches', async () => {
    const f = await publisher();
    await symlinkEvidence(f);
    await sanitizedRejection(() => f.publish());
    expect(publicationEffects(f)).toEqual([]);
  });

  it.each([
    [
      'coverage source',
      (value) => {
        value.sourceSha = 'a'.repeat(40);
      },
    ],
    [
      'coverage run',
      (value) => {
        value.runId = '999';
      },
    ],
    [
      'coverage attempt',
      (value) => {
        value.runAttempt++;
      },
    ],
    [
      'selected coverage',
      (value) => {
        value.coverage[0].complete = false;
      },
    ],
    [
      'missing target',
      (value) => {
        value.coverage.pop();
      },
    ],
    [
      'low coverage',
      (value) => {
        value.coverage[0].branches = 84.9;
      },
    ],
  ])('rejects %s without uploading or pushing', async (_name, mutate) => {
    const f = await publisher({ coverage: mutate });
    await sanitizedRejection(() => f.publish());
    expect(publicationEffects(f)).toEqual([]);
    expect(f.puts).toEqual([]);
  });

  it.each([
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_REPOSITORY_ID',
    'GITHUB_REF',
    'GITHUB_EVENT_NAME',
  ])('rejects substituted CI %s before mutation', async (name) => {
    const f = await publisher();
    f.runtime.env[name] = 'synthetic-invalid';
    await sanitizedRejection(() => f.publish());
    expect(publicationEffects(f)).toEqual([]);
    expect(f.puts).toEqual([]);
  });

  it('rejects changed local image identity after verification instead of rebuilding a substitute', async () => {
    const f = await publisher();
    f.tags.set(f.args.verified.images.web.tag, `sha256:${'a'.repeat(64)}`);
    await sanitizedRejection(() => f.publish());
    expect(publicationEffects(f)).toEqual([]);
    expect(f.puts).toEqual([]);
  });

  it.each([
    'verified',
    'sourceSha',
    'repositoryId',
    'workflowRef',
    'imageDigest',
    'attestationSha256',
    'runId',
    'runAttempt',
  ])('rejects attestation substitution in %s and never publishes manifest', async (field) => {
    const f = await publisher({
      attestation: (result) => {
        result.verification[field] = field === 'verified' ? false : canary;
      },
    });
    await sanitizedRejection(() => f.publish());
    expect(f.puts.some((put) => put.key.startsWith('manifests/'))).toBe(false);
    expect(JSON.stringify(f.publicOutput)).not.toContain(canary);
  });

  it('does not invent attestation bytes or retry ambiguous immutable uploads', async () => {
    const missing = await publisher({
      attestation: (result) => {
        delete result.bundle;
      },
    });
    await sanitizedRejection(() => missing.publish());
    expect(missing.puts).toEqual([]);
    const uncertain = await publisher({
      put: async () => {
        throw new Error(canary);
      },
    });
    await sanitizedRejection(() => uncertain.publish());
    expect(uncertain.puts).toHaveLength(1);
  });
});

describe('REL-02/10 reusable nonpublishing image evidence inspection', () => {
  beforeEach(() => {
    expect(pipeline.checkImageEvidence, 'Missing shared evidence inspection export').toBeTypeOf(
      'function',
    );
  });

  it.each(['ci', 'working-tree'])(
    'checks %s original receipt and reports without Docker or publication',
    async (mode) => {
      const f = await imageHarness();
      const verified = await receiptFixture(f, mode);
      expect(await pipeline.checkImageEvidence({ runtime: f.runtime, verified })).toBe(true);
      expect(f.calls).toEqual([]);
      expect(f.fetchCalls).toEqual([]);
    },
  );

  it.each([
    'missing-receipt',
    'tampered-receipt',
    'missing-report',
    'tampered-report',
    'returned-image',
    'outside-directory',
    'invalid-mode',
    'failed-browser',
    'symlink',
  ])('denies %s with zero command or network effects', async (scenario) => {
    const f = await imageHarness();
    const verified = await receiptFixture(f);
    const receiptPath = join(f.evidenceDirectory, 'verified.json');
    if (scenario === 'missing-receipt') await rm(receiptPath);
    if (scenario === 'tampered-receipt') await write(receiptPath, canary);
    if (scenario === 'missing-report') await rm(join(f.evidenceDirectory, reportFiles.browser));
    if (scenario === 'tampered-report')
      await write(join(f.evidenceDirectory, reportFiles.browser), canary);
    if (scenario === 'returned-image') verified.images.api.imageId = `sha256:${'a'.repeat(64)}`;
    if (scenario === 'outside-directory') verified.evidenceDirectory = f.root;
    if (scenario === 'invalid-mode') verified.mode = 'production';
    if (scenario === 'failed-browser') {
      const report = cleanBrowser();
      report.stats.unexpected = 1;
      const reportBytes = bytes(report);
      await write(join(f.evidenceDirectory, reportFiles.browser), reportBytes);
      const receipt = JSON.parse(await readFile(receiptPath));
      receipt.reports.browser.sha256 = hash(reportBytes);
      const receiptBytes = bytes(receipt);
      await write(receiptPath, receiptBytes);
      verified.receiptSha256 = hash(receiptBytes);
    }
    if (scenario === 'symlink') await symlinkEvidence(f);
    await sanitizedRejection(() => pipeline.checkImageEvidence({ runtime: f.runtime, verified }));
    expect(f.calls).toEqual([]);
    expect(f.fetchCalls).toEqual([]);
  });
});

describe('REL-02/03/04/10 completed-workflow candidate dispatch', () => {
  function dispatchFixture(options = {}) {
    const api = github(options);
    const manifest = {
      schemaVersion: 1,
      sourceSha: sha,
      repositoryId,
      images: {
        web: { digest: digests.web, attestationSha256: '8'.repeat(64) },
        api: { digest: digests.api, attestationSha256: '9'.repeat(64) },
      },
      runs: { scaffold: copy(runs.scaffold), images: copy(runs.images), codeql: copy(runs.codeql) },
    };
    const publish = vi.fn(async () => ({ messageIds: ['synthetic-message'] }));
    const event = {
      action: 'completed',
      repository: { id: Number(repositoryId), full_name: 'stara-labs/stara' },
      workflow_run: nativeRun('images'),
    };
    const args = {
      event,
      repositoryId,
      request: api.request,
      publish,
      topic: 'projects/synthetic-delivery/topics/staging-candidates',
      manifest: bytes(manifest),
      configurationSha256,
    };
    return {
      ...api,
      args,
      publish,
      run: (extra = {}) => pipeline.dispatchCandidate({ ...args, ...extra }),
    };
  }

  it('refetches release.yml, completed jobs and main before publishing only strict base64 dispatch to the fixed topic', async () => {
    const f = dispatchFixture();
    f.args.event.workflow_run.url = 'https://synthetic-attacker.example/run';
    const result = await f.run();
    expect(
      f.calls.some(
        ({ route, parameters }) =>
          route.includes('/workflows/') && parameters.workflow_id === 'release.yml',
      ),
    ).toBe(true);
    expect(f.calls.some(({ route }) => route.includes('/jobs'))).toBe(true);
    expect(f.publish).toHaveBeenCalledOnce();
    const message = f.publish.mock.calls[0][0];
    expect(Object.keys(message).sort()).toEqual(['data', 'topic']);
    expect(message.topic).toBe(f.args.topic);
    const decoded = Buffer.from(message.data, 'base64').toString('utf8');
    expect(parseDispatch(decoded)).toEqual(result);
    expect(result).toEqual({
      schemaVersion: 1,
      sourceSha: sha,
      manifestSha256: hash(f.args.manifest),
      configurationSha256,
    });
    expect(message.data).toBe(Buffer.from(decoded).toString('base64'));
  });

  it.each([
    [
      'incomplete publishing workflow',
      (run) => {
        run.status = 'in_progress';
        run.conclusion = null;
      },
    ],
    [
      'failed publish workflow',
      (run) => {
        run.conclusion = 'failure';
      },
    ],
    [
      'wrong run SHA',
      (run) => {
        run.head_sha = 'a'.repeat(40);
      },
    ],
    [
      'wrong workflow path',
      (run) => {
        run.path = '.github/workflows/release-images.yml';
      },
    ],
    [
      'wrong attempt',
      (run) => {
        run.run_attempt++;
      },
    ],
    [
      'wrong repository',
      (run) => {
        run.repository.id = 999999;
      },
    ],
    [
      'non-push source',
      (run) => {
        run.event = 'workflow_dispatch';
      },
    ],
  ])('denies %s even when webhook claims success', async (_name, mutate) => {
    const f = dispatchFixture({ run: mutate });
    await sanitizedRejection(() => f.run());
    expect(f.publish).not.toHaveBeenCalled();
  });

  it.each(['Verify release images', 'Publish verified images'])(
    'requires exact completed %s job',
    async (name) => {
      const f = dispatchFixture({
        jobs: (jobs) => {
          jobs.splice(
            jobs.findIndex((job) => job.name === name),
            1,
          );
        },
      });
      await sanitizedRejection(() => f.run());
      expect(f.publish).not.toHaveBeenCalled();
    },
  );

  it.each(['sourceSha', 'run', 'configuration', 'topic'])(
    'denies changed %s binding before publishing',
    async (field) => {
      const f = dispatchFixture();
      const manifest = JSON.parse(Buffer.from(f.args.manifest).toString('utf8'));
      if (field === 'sourceSha') manifest.sourceSha = 'a'.repeat(40);
      if (field === 'run') manifest.runs.images.id = '999';
      f.args.manifest = bytes(manifest);
      if (field === 'configuration') f.args.configurationSha256 = canary;
      if (field === 'topic') f.args.topic = 'https://synthetic-attacker.example/topic';
      await sanitizedRejection(() => f.run());
      expect(f.publish).not.toHaveBeenCalled();
    },
  );

  it('ignores event-supplied destinations, rejects incomplete action and never retries an unknown publish', async () => {
    const f = dispatchFixture();
    f.args.event.topic = 'projects/synthetic-foreign/topics/foreign';
    await f.run();
    expect(f.publish.mock.calls[0][0].topic).toBe(f.args.topic);
    const incomplete = dispatchFixture();
    incomplete.args.event.action = 'requested';
    await sanitizedRejection(() => incomplete.run());
    expect(incomplete.publish).not.toHaveBeenCalled();
    const unknown = dispatchFixture();
    unknown.publish.mockRejectedValue(new Error(canary));
    await sanitizedRejection(() => unknown.run());
    expect(unknown.publish).toHaveBeenCalledOnce();
  });
});
