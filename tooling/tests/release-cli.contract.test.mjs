import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../lib/process.mjs';
import { ownedTemporary } from '../lib/files.mjs';
import { parseManifest, publicEvidence } from '../release/contract.mjs';

const sourceSha = '1'.repeat(40);
const repositoryId = '1363262992';
const canary = 'synthetic-private-cli-canary-DO-NOT-PUBLISH';
const trivyImage =
  'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const cliURL = new URL('../release/cli.mjs', import.meta.url);
const start = 1_800_000_000_000;
const runId = 'cli-synthetic-run';
const bytes = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const copy = (value) => structuredClone(value);
const emitted = [];
const forbidden = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Live I/O is forbidden in CLI contracts');
  }),
);
const defaultTransport = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  createAuthenticatedRequest: vi.fn(),
  verifyBundle: vi.fn(),
}));
vi.mock('../release/transport.mjs', () => defaultTransport);
vi.mock('google-auth-library', () => ({ GoogleAuth: forbidden }));
vi.mock('node:child_process', () => ({
  execFile: forbidden,
  execFileSync: forbidden,
  exec: forbidden,
  execSync: forbidden,
  spawn: forbidden,
  spawnSync: forbidden,
  fork: forbidden,
}));

async function implementation() {
  try {
    await access(cliURL);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Missing implementation: tooling/release/cli.mjs; behavior not executed', {
      cause: error,
    });
  }
  const api = await import(/* @vite-ignore */ cliURL.href);
  expect(api.main, 'Missing CLI main export; behavior not executed').toBeTypeOf('function');
  return api;
}

function clean(error) {
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/\S/);
  for (let value = error, depth = 0; value && depth < 8; value = value.cause, depth++) {
    expect(`${value.message ?? ''}\n${value.stack ?? ''}\n${JSON.stringify(value)}`).not.toContain(
      canary,
    );
  }
}
async function denied(action) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  clean(failure);
}
beforeEach(() => {
  forbidden.mockClear();
  vi.stubGlobal('fetch', forbidden);
  for (const name of ['log', 'info', 'warn', 'error', 'debug'])
    vi.spyOn(console, name).mockImplementation((...values) => {
      emitted.push(
        values
          .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
          .join(' '),
      );
    });
});
afterEach(() => {
  expect(forbidden).not.toHaveBeenCalled();
  expect(emitted.splice(0).join('\n')).not.toContain(canary);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('../lib/process.mjs');
});

function environment() {
  return {
    CI: 'true',
    GITHUB_SHA: sourceSha,
    STARA_SOURCE_SHA: sourceSha,
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'stara-labs/stara',
    GITHUB_REPOSITORY_ID: repositoryId,
    GITHUB_RUN_ID: '102',
    GITHUB_RUN_ATTEMPT: '1',
    STARA_RELEASE_RUN_ID: runId,
    GH_TOKEN: canary,
    STARA_IMAGE_REPOSITORY: 'us-central1-docker.pkg.dev/stara-synthetic-delivery/app',
    STARA_ARTIFACT_BUCKET: 'stara-synthetic-artifacts',
    STARA_STAGING_TOPIC: 'projects/stara-synthetic-delivery/topics/staging-candidates',
  };
}
function checks() {
  return { sourceSha, scaffold: { id: '101', attempt: 2 }, codeql: { id: '103', attempt: 1 } };
}
function manifest() {
  return {
    schemaVersion: 1,
    sourceSha,
    repositoryId,
    images: {
      web: { digest: `sha256:${'2'.repeat(64)}`, attestationSha256: '4'.repeat(64) },
      api: { digest: `sha256:${'3'.repeat(64)}`, attestationSha256: '5'.repeat(64) },
    },
    runs: {
      scaffold: checks().scaffold,
      images: { id: '102', attempt: 1 },
      codeql: checks().codeql,
    },
  };
}
const targetDirectories = {
  '@stara/web': 'web',
  '@stara/ui': 'ui',
  '@stara/api': 'api',
  '@stara/tooling': 'tooling',
};
function coverage() {
  return {
    schemaVersion: 1,
    sourceSha,
    runId: '101',
    runAttempt: 2,
    coverage: Object.keys(targetDirectories).map((target) => ({
      target,
      sourceSha,
      complete: true,
      lines: 90,
      branches: 85,
    })),
  };
}
function summary() {
  return {
    total: {
      lines: { total: 100, covered: 90, skipped: 0, pct: 90 },
      branches: { total: 100, covered: 85, skipped: 0, pct: 85 },
      statements: { total: 100, covered: 91, skipped: 0, pct: 91 },
      functions: { total: 100, covered: 92, skipped: 0, pct: 92 },
      branchesTrue: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
    },
    [canary]: { syntheticFileDetails: true },
  };
}

async function put(file, content) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content instanceof Uint8Array ? content : bytes(content));
}

async function fixture(action) {
  const api = await implementation();
  return ownedTemporary(async (temporary) => {
    const root = join(temporary, 'workspace');
    await mkdir(root);
    const env = environment();
    const time = { now: () => start, sleep: vi.fn(async () => {}) };
    const commands = vi.fn(async (executable, args) => {
      if (executable === 'git' && args[0] === 'rev-parse' && args.at(-1) === 'HEAD')
        return { code: 0, stdout: `${sourceSha}\n`, stderr: '' };
      if (executable === 'git' && args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      throw new Error('Unexpected injected CLI command');
    });
    const output = vi.fn((value) =>
      emitted.push(typeof value === 'string' ? value : JSON.stringify(value)),
    );
    const runtime = createRuntime({ root, env, runId, run: commands, output });
    const directory = join(root, '.artifacts', 'release-pipeline', runId);
    const verified = {
      schemaVersion: 1,
      sourceSha,
      mode: 'ci',
      runId,
      images: {
        web: { imageId: `sha256:${'2'.repeat(64)}`, tag: `stara-release-web:${runId}` },
        api: { imageId: `sha256:${'3'.repeat(64)}`, tag: `stara-release-api:${runId}` },
      },
      evidenceDirectory: directory,
      receiptSha256: '6'.repeat(64),
      verified: true,
    };
    const reader = vi.fn();
    const request = vi.fn();
    const registry = {
      web: `${env.STARA_IMAGE_REPOSITORY}/web`,
      api: `${env.STARA_IMAGE_REPOSITORY}/api`,
      attest: vi.fn(),
    };
    const storage = { put: vi.fn() };
    const publish = vi.fn();
    const operations = {
      awaitMainChecks: vi.fn(async () => checks()),
      verifyImages: vi.fn(async ({ mode }) => {
        await mkdir(directory, { recursive: false });
        return { ...copy(verified), mode };
      }),
      checkImageEvidence: vi.fn(async () => true),
      publishCandidate: vi.fn(async () => ({
        manifest: manifest(),
        manifestSha256: hash(bytes(manifest())),
      })),
      dispatchCandidate: vi.fn(async () => ({
        schemaVersion: 1,
        sourceSha,
        manifestSha256: hash(bytes(manifest())),
        configurationSha256: '7'.repeat(64),
      })),
      executeCLI: vi.fn(async () => ({ status: 'succeeded' })),
      createAuthenticatedRequest: vi.fn(() => request),
      createGitHubReader: vi.fn(() => reader),
      createArtifactPublisher: vi.fn(async () => ({ registry, storage })),
      createStagingDispatcher: vi.fn(async () => publish),
    };
    await mkdir(dirname(directory), { recursive: true });
    const f = {
      api,
      root,
      temporary,
      directory,
      env: runtime.env,
      runtime,
      commands,
      operations,
      time,
      verified,
      reader,
      request,
      registry,
      storage,
      publish,
      pointer: join(directory, 'result.json'),
      publicFile: (name) => join(root, '.artifacts', 'public-release', name),
      run: (command, extra = {}) =>
        api.main([command], { runtime, clock: time, operations, ...extra }),
      seedPointer: () => put(join(directory, 'result.json'), verified),
    };
    await action(f);
  });
}
function noCloud(f) {
  for (const name of [
    'createArtifactPublisher',
    'createStagingDispatcher',
    'createAuthenticatedRequest',
    'executeCLI',
  ])
    expect(f.operations[name]).not.toHaveBeenCalled();
}
async function missing(file) {
  await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
}
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

describe('CLI dispatch and source selection', () => {
  it('imports without default transport, credentials, commands, output or exit changes', async () => {
    const exitCode = process.exitCode;
    const calls = Object.values(defaultTransport).map((fn) => fn.mock.calls.length);
    await implementation();
    expect(process.exitCode).toBe(exitCode);
    expect(Object.values(defaultTransport).map((fn) => fn.mock.calls.length)).toEqual(calls);
    expect(emitted).toEqual([]);
  });

  it.each([
    [],
    ['unknown'],
    ['images', '--target', 'production'],
    ['execute', '--command', canary],
    ['images', 'safety'],
    ['coverage-export', canary],
  ])('rejects argv %j before any operation', async (argv) =>
    fixture(async (f) => {
      await denied(() =>
        f.api.main(argv, { runtime: f.runtime, operations: f.operations, clock: f.time }),
      );
      for (const operation of Object.values(f.operations)) expect(operation).not.toHaveBeenCalled();
      expect(f.commands).not.toHaveBeenCalled();
    }),
  );

  it.each(['GITHUB_SHA', 'STARA_SOURCE_SHA'])(
    'accepts the sole strict source from %s with runtime.env fallback',
    async (name) =>
      fixture(async (f) => {
        delete f.env[name === 'GITHUB_SHA' ? 'STARA_SOURCE_SHA' : 'GITHUB_SHA'];
        expect(await f.run('images')).toBe(0);
        expect(f.operations.verifyImages.mock.calls[0][0].sourceSha).toBe(sourceSha);
        noCloud(f);
      }),
  );

  it('uses local Git HEAD only when both source environment values are absent', async () =>
    fixture(async (f) => {
      delete f.env.GITHUB_SHA;
      delete f.env.STARA_SOURCE_SHA;
      delete f.env.CI;
      expect(await f.run('images')).toBe(0);
      expect(
        f.commands.mock.calls.some(([tool, args]) => tool === 'git' && args[0] === 'rev-parse'),
      ).toBe(true);
      expect(f.operations.verifyImages.mock.calls[0][0]).toMatchObject({
        sourceSha,
        mode: 'working-tree',
      });
    }));

  it.each(['', 'short', 'A'.repeat(40), `${sourceSha}\n`, '1'.repeat(64)])(
    'rejects malformed supplied source %s instead of falling back',
    async (source) =>
      fixture(async (f) => {
        f.env.GITHUB_SHA = source;
        delete f.env.STARA_SOURCE_SHA;
        await denied(() => f.run('images'));
        expect(f.operations.verifyImages).not.toHaveBeenCalled();
      }),
  );

  it('rejects conflicting environment SHAs before operations', async () =>
    fixture(async (f) => {
      f.env.STARA_SOURCE_SHA = '8'.repeat(40);
      await denied(() => f.run('images'));
      expect(f.operations.verifyImages).not.toHaveBeenCalled();
    }));
});

describe('images and safety: owned pointers and allowlisted public evidence', () => {
  it.each([
    ['true', 'ci'],
    ['false', 'working-tree'],
    [undefined, 'working-tree'],
  ])('maps CI=%s to %s without cloud auth', async (ci, mode) =>
    fixture(async (f) => {
      if (ci === undefined) delete f.env.CI;
      else f.env.CI = ci;
      expect(await f.run('images')).toBe(0);
      expect(f.operations.verifyImages).toHaveBeenCalledExactlyOnceWith({
        sourceSha,
        mode,
        runtime: f.runtime,
        clock: f.time,
        trivyImage,
      });
      expect(await readJson(f.pointer)).toEqual({ ...f.verified, mode });
      const result = await readJson(f.publicFile('results.json'));
      expect(publicEvidence(result)).toEqual(result);
      expect(result).toMatchObject({ schemaVersion: 1, sourceSha, synthetic: true });
      expect(result.results.length).toBeGreaterThan(0);
      expect(
        result.results.every((item) => item.mode === 'simulation' && item.result === 'Passed'),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain(f.directory);
      noCloud(f);
      expect(f.operations.createGitHubReader).not.toHaveBeenCalled();
    }),
  );

  it('does not overwrite an existing result pointer', async () =>
    fixture(async (f) => {
      await f.seedPointer();
      const original = await readFile(f.pointer);
      f.operations.verifyImages.mockResolvedValue(copy(f.verified));
      await denied(() => f.run('images'));
      expect(await readFile(f.pointer)).toEqual(original);
      await missing(f.publicFile('results.json'));
    }));

  it.each([
    { verified: false },
    { sourceSha: '8'.repeat(40) },
    { runId: 'foreign-run' },
    { receiptSha256: 'bad' },
    { diagnostics: canary },
    { environment: 'production' },
  ])('denies invalid returned verification identity before writing a pointer', async (change) =>
    fixture(async (f) => {
      f.operations.verifyImages.mockResolvedValue({ ...f.verified, ...change });
      await denied(() => f.run('images'));
      await missing(f.pointer);
      await missing(f.publicFile('results.json'));
    }),
  );

  it('cannot redirect returned image evidence outside its owned run', async () =>
    fixture(async (f) => {
      const foreign = join(f.temporary, 'foreign');
      await mkdir(foreign);
      f.operations.verifyImages.mockResolvedValue({ ...f.verified, evidenceDirectory: foreign });
      await denied(() => f.run('images'));
      expect(await readdir(foreign)).toEqual([]);
    }));

  it('reopens the strict per-run pointer and delegates safety validation without new auth or scans', async () =>
    fixture(async (f) => {
      await f.seedPointer();
      expect(await f.run('safety')).toBe(0);
      expect(f.operations.checkImageEvidence).toHaveBeenCalledExactlyOnceWith({
        verified: f.verified,
        runtime: f.runtime,
      });
      expect(f.operations.verifyImages).not.toHaveBeenCalled();
      noCloud(f);
    }));

  it.each(['missing', 'duplicate', 'oversized', 'foreign', 'unknown', 'trailing'])(
    'rejects a %s pointer before the safety delegate',
    async (kind) =>
      fixture(async (f) => {
        let raw = bytes(f.verified);
        if (kind === 'duplicate')
          raw = bytes(JSON.stringify(f.verified).replace('{', '{"schemaVersion":1,'));
        if (kind === 'oversized') raw = bytes(JSON.stringify(f.verified).padEnd(65537));
        if (kind === 'foreign') raw = bytes({ ...f.verified, evidenceDirectory: f.temporary });
        if (kind === 'unknown') raw = bytes({ ...f.verified, extra: canary });
        if (kind === 'trailing') raw = bytes(`${JSON.stringify(f.verified)}{}`);
        if (kind !== 'missing') await put(f.pointer, raw);
        await denied(() => f.run('safety'));
        expect(f.operations.checkImageEvidence).not.toHaveBeenCalled();
        noCloud(f);
      }),
  );

  it('rejects a linked run directory before reading or writing evidence', async () =>
    fixture(async (f) => {
      const foreign = join(f.temporary, 'foreign');
      await mkdir(foreign);
      await put(join(foreign, 'result.json'), f.verified);
      await symlink(foreign, f.directory, process.platform === 'win32' ? 'junction' : 'dir');
      await denied(() => f.run('safety'));
      expect(f.operations.checkImageEvidence).not.toHaveBeenCalled();
    }));

  it('sanitizes safety failure instead of treating it as a successful independent check', async () =>
    fixture(async (f) => {
      await f.seedPointer();
      f.operations.checkImageEvidence.mockRejectedValue(new Error(canary));
      await denied(() => f.run('safety'));
    }));
});

describe('await-checks: read-only GitHub provider and bounded output identity', () => {
  it('uses the GitHub-only reader and appends only sanitized scaffold identifiers', async () =>
    fixture(async (f) => {
      const output = join(f.temporary, 'github-output');
      f.env.GITHUB_OUTPUT = output;
      await put(output, 'earlier=value\n');
      expect(await f.run('await-checks')).toBe(0);
      expect(f.operations.createGitHubReader).toHaveBeenCalledExactlyOnceWith({ env: f.env });
      expect(f.operations.awaitMainChecks).toHaveBeenCalledExactlyOnceWith({
        sourceSha,
        repositoryId,
        request: f.reader,
        clock: f.time,
      });
      expect(await readFile(output, 'utf8')).toBe(
        'earlier=value\nscaffold-run=101\nscaffold-attempt=2\n',
      );
      expect(await readJson(join(f.directory, 'checks.json'))).toEqual(checks());
      noCloud(f);
    }));

  it('allows local read-only checks without a GitHub output file', async () =>
    fixture(async (f) => {
      expect(await f.run('await-checks')).toBe(0);
      expect(await readJson(join(f.directory, 'checks.json'))).toEqual(checks());
      noCloud(f);
    }));

  it.each([
    { sourceSha: '8'.repeat(40) },
    { scaffold: { id: '101\nprivate=value', attempt: 2 } },
    { scaffold: { id: '00101', attempt: 2 } },
    { scaffold: { id: '101', attempt: 0 } },
    { scaffold: { id: '101', attempt: '2' } },
    { diagnostics: canary },
  ])('rejects malformed prerequisite output before public Actions output', async (change) =>
    fixture(async (f) => {
      const output = join(f.temporary, 'github-output');
      f.env.GITHUB_OUTPUT = output;
      await put(output, 'unchanged\n');
      f.operations.awaitMainChecks.mockResolvedValue({ ...checks(), ...change });
      await denied(() => f.run('await-checks'));
      expect(await readFile(output, 'utf8')).toBe('unchanged\n');
    }),
  );

  it('does not emit output after prerequisite failure', async () =>
    fixture(async (f) => {
      f.operations.awaitMainChecks.mockRejectedValue(new Error(canary));
      await denied(() => f.run('await-checks'));
      await missing(join(f.directory, 'checks.json'));
    }));
});

async function seedCoverage(f, changedTarget, value) {
  for (const [target, directory] of Object.entries(targetDirectories))
    await put(
      join(f.root, '.artifacts', 'coverage', directory, 'coverage-summary.json'),
      target === changedTarget ? value : summary(),
    );
}

describe('coverage-export: actual four-target totals, never selected or fabricated coverage', () => {
  it('validates actual totals and exports only the exact source/run/attempt envelope', async () =>
    fixture(async (f) => {
      await seedCoverage(f);
      expect(await f.run('coverage-export')).toBe(0);
      const result = await readJson(f.publicFile('coverage.json'));
      expect(result).toEqual({ ...coverage(), runId: '102', runAttempt: 1 });
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(JSON.stringify(result)).not.toContain('Unknown');
      expect(
        f.commands.mock.calls.some(([tool, args]) => tool === 'git' && args[0] === 'status'),
      ).toBe(true);
      expect(
        f.commands.mock.calls.some(([tool, args]) => tool === 'git' && args[0] === 'rev-parse'),
      ).toBe(true);
      for (const operation of Object.values(f.operations)) expect(operation).not.toHaveBeenCalled();
    }));

  it.each(Object.keys(targetDirectories))(
    'requires the complete %s target summary',
    async (target) =>
      fixture(async (f) => {
        for (const [name, directory] of Object.entries(targetDirectories))
          if (name !== target)
            await put(
              join(f.root, '.artifacts', 'coverage', directory, 'coverage-summary.json'),
              summary(),
            );
        await denied(() => f.run('coverage-export'));
        await missing(f.publicFile('coverage.json'));
      }),
  );

  it.each([
    ['lines', 'pct', 0],
    ['lines', 'pct', 89.99],
    ['branches', 'pct', 84.99],
    ['lines', 'pct', '90'],
    ['branches', 'pct', null],
    ['lines', 'pct', 101],
    ['lines', 'total', 0],
    ['branches', 'total', 0],
    ['statements', 'total', -1],
    ['functions', 'total', 1.5],
    ['functions', 'covered', -1],
    ['lines', 'covered', 101],
    ['branches', 'covered', null],
    ['functions', 'pct', 'Unknown'],
    ['statements', 'skipped', 1],
    ['lines', 'covered', 89],
    ['branches', 'covered', 84],
  ])('rejects invalid or inconsistent %s.%s=%s', async (metric, field, value) =>
    fixture(async (f) => {
      const report = summary();
      report.total[metric][field] = value;
      await seedCoverage(f, '@stara/web', report);
      await denied(() => f.run('coverage-export'));
      await missing(f.publicFile('coverage.json'));
    }),
  );

  it.each(['lines', 'branches', 'statements', 'functions'])(
    'requires numeric %s totals',
    async (metric) =>
      fixture(async (f) => {
        const report = summary();
        delete report.total[metric];
        await seedCoverage(f, '@stara/api', report);
        await denied(() => f.run('coverage-export'));
      }),
  );

  it.each(['duplicate', 'trailing', 'invalid-utf8', 'oversized'])(
    'rejects %s coverage bytes',
    async (kind) =>
      fixture(async (f) => {
        let raw = bytes(summary());
        if (kind === 'duplicate')
          raw = bytes(JSON.stringify(summary()).replace('{', '{"total":{},'));
        if (kind === 'trailing') raw = bytes(`${JSON.stringify(summary())}{}`);
        if (kind === 'invalid-utf8') raw = Buffer.concat([raw, Buffer.from([0xc3, 0x28])]);
        if (kind === 'oversized')
          raw = bytes(JSON.stringify(summary()).padEnd(16 * 1024 * 1024 + 1));
        await seedCoverage(f, '@stara/tooling', raw);
        await denied(() => f.run('coverage-export'));
      }),
  );

  it.each([
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_RUN_ID', 'bad'],
    ['GITHUB_RUN_ATTEMPT', '0'],
    ['GITHUB_REPOSITORY_ID', '666'],
    ['GITHUB_REPOSITORY', 'attacker/repo'],
  ])('rejects invalid publication context %s', async (key, value) =>
    fixture(async (f) => {
      await seedCoverage(f);
      f.env[key] = value;
      await denied(() => f.run('coverage-export'));
      await missing(f.publicFile('coverage.json'));
    }),
  );

  it.each(['head', 'dirty', 'untracked'])(
    'rejects %s workspace state before exporting',
    async (state) =>
      fixture(async (f) => {
        await seedCoverage(f);
        const previous = f.commands.getMockImplementation();
        f.commands.mockImplementation(async (tool, args, ...rest) => {
          if (state === 'head' && args[0] === 'rev-parse')
            return { code: 0, stdout: '8'.repeat(40), stderr: '' };
          if (state !== 'head' && args[0] === 'status')
            return {
              code: 0,
              stdout: state === 'dirty' ? ' M source.ts\n' : '?? unknown.ts\n',
              stderr: '',
            };
          return previous(tool, args, ...rest);
        });
        await denied(() => f.run('coverage-export'));
        await missing(f.publicFile('coverage.json'));
      }),
  );

  it('does not overwrite an existing exported envelope', async () =>
    fixture(async (f) => {
      await seedCoverage(f);
      await put(f.publicFile('coverage.json'), 'previous\n');
      await denied(() => f.run('coverage-export'));
      expect(await readFile(f.publicFile('coverage.json'), 'utf8')).toBe('previous\n');
    }));

  it('rejects a linked public destination without writing outside the workspace', async () =>
    fixture(async (f) => {
      await seedCoverage(f);
      const foreign = join(f.temporary, 'foreign-public');
      await mkdir(foreign);
      await symlink(
        foreign,
        dirname(f.publicFile('coverage.json')),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await denied(() => f.run('coverage-export'));
      expect(await readdir(foreign)).toEqual([]);
    }));
});

async function seedPublish(f) {
  await f.seedPointer();
  await put(
    join(f.root, '.artifacts', 'release-inputs', 'coverage', 'coverage.json'),
    bytes(` ${JSON.stringify(coverage())}\n`),
  );
}
describe('publish: target-neutral artifacts with freshly bound checks and owned coverage bytes', () => {
  it('publishes without a target configuration hash and emits only a strict manifest', async () =>
    fixture(async (f) => {
      await seedPublish(f);
      expect(f.env.STARA_CONFIGURATION_SHA256).toBeUndefined();
      expect(await f.run('publish')).toBe(0);
      expect(f.operations.awaitMainChecks).toHaveBeenCalledExactlyOnceWith({
        sourceSha,
        repositoryId,
        request: f.reader,
        clock: f.time,
      });
      expect(f.operations.createArtifactPublisher).toHaveBeenCalledExactlyOnceWith({
        runtime: f.runtime,
        env: f.env,
        clock: f.time,
      });
      const args = f.operations.publishCandidate.mock.calls[0][0];
      expect(args).toEqual({
        verified: f.verified,
        checks: checks(),
        coverage: args.coverage,
        imagesRun: { id: '102', attempt: 1 },
        repositoryId,
        runtime: f.runtime,
        registry: f.registry,
        storage: f.storage,
      });
      const imported = await readFile(
        join(f.root, '.artifacts', 'release-inputs', 'coverage', 'coverage.json'),
      );
      expect(resolve(args.coverage.path)).not.toBe(
        resolve(join(f.root, '.artifacts', 'release-inputs', 'coverage', 'coverage.json')),
      );
      expect(relative(f.directory, args.coverage.path)).not.toMatch(/^\.\./);
      expect(await readFile(args.coverage.path)).toEqual(imported);
      expect(args.coverage.sha256).toBe(hash(imported));
      const published = await readFile(f.publicFile('manifest.json'));
      expect(parseManifest(published, hash(published))).toEqual(manifest());
      expect(hash(published)).toBe(hash(bytes(manifest())));
      expect(f.operations.createStagingDispatcher).not.toHaveBeenCalled();
      expect(f.operations.createAuthenticatedRequest).not.toHaveBeenCalled();
    }));

  it('does not forward a target hash to neutral publication even if an unrelated env value exists', async () =>
    fixture(async (f) => {
      await seedPublish(f);
      f.env.STARA_CONFIGURATION_SHA256 = canary;
      expect(await f.run('publish')).toBe(0);
      expect(f.operations.publishCandidate.mock.calls[0][0]).not.toHaveProperty(
        'configurationSha256',
      );
    }));

  it('does not use an old checks file when prerequisite revalidation fails', async () =>
    fixture(async (f) => {
      await seedPublish(f);
      await put(join(f.directory, 'checks.json'), checks());
      f.operations.awaitMainChecks.mockRejectedValue(new Error(canary));
      await denied(() => f.run('publish'));
      expect(f.operations.publishCandidate).not.toHaveBeenCalled();
      expect(f.operations.createArtifactPublisher).not.toHaveBeenCalled();
      await missing(f.publicFile('manifest.json'));
    }));

  it('requires the fixed downloaded coverage input', async () =>
    fixture(async (f) => {
      await f.seedPointer();
      f.env.STARA_COVERAGE_PATH = join(f.temporary, 'alternate.json');
      await put(f.env.STARA_COVERAGE_PATH, coverage());
      await denied(() => f.run('publish'));
      expect(f.operations.publishCandidate).not.toHaveBeenCalled();
    }));

  it.each([
    { manifest: { ...manifest(), diagnostics: canary } },
    { manifestSha256: 'bad' },
    { manifestSha256: '9'.repeat(64) },
  ])('rejects invalid publication output before creating public evidence', async (change) =>
    fixture(async (f) => {
      await seedPublish(f);
      f.operations.publishCandidate.mockResolvedValue({
        manifest: manifest(),
        manifestSha256: hash(bytes(manifest())),
        ...change,
      });
      await denied(() => f.run('publish'));
      await missing(f.publicFile('manifest.json'));
    }),
  );

  it.each(['missing', 'different-run', 'different-attempt', 'extra-private-field'])(
    'rejects %s CodeQL identity in returned publication before public output',
    async (kind) =>
      fixture(async (f) => {
        await seedPublish(f);
        const candidate = manifest();
        if (kind === 'missing') delete candidate.runs.codeql;
        if (kind === 'different-run') candidate.runs.codeql.id = '104';
        if (kind === 'different-attempt') candidate.runs.codeql.attempt = 2;
        if (kind === 'extra-private-field') candidate.runs.codeql.diagnostics = canary;
        f.operations.publishCandidate.mockResolvedValue({
          manifest: candidate,
          manifestSha256: hash(bytes(candidate)),
        });
        await denied(() => f.run('publish'));
        expect(f.operations.awaitMainChecks).toHaveBeenCalledTimes(1);
        await missing(f.publicFile('manifest.json'));
      }),
  );
});

async function seedDispatch(f) {
  f.env.GITHUB_EVENT_NAME = 'workflow_run';
  f.env.GITHUB_EVENT_PATH = join(f.temporary, 'official-github-event.json');
  f.env.STARA_CONFIGURATION_SHA256 = '7'.repeat(64);
  const event = {
    action: 'completed',
    repository: { id: Number(repositoryId), full_name: 'stara-labs/stara' },
    workflow_run: {
      id: 102,
      run_attempt: 1,
      head_sha: sourceSha,
      url: `https://attacker.invalid/${canary}`,
    },
  };
  const rawManifest = bytes(` ${JSON.stringify(manifest())}\n`);
  await put(f.env.GITHUB_EVENT_PATH, event);
  await put(
    join(f.root, '.artifacts', 'release-inputs', 'candidate', 'manifest.json'),
    rawManifest,
  );
  return { event, rawManifest };
}
describe('dispatch: official event and fixed candidate bytes with no public raw details', () => {
  it('passes original candidate bytes and fixed topic/hash to the dispatcher core', async () =>
    fixture(async (f) => {
      const { event, rawManifest } = await seedDispatch(f);
      expect(await f.run('dispatch')).toBe(0);
      expect(f.operations.createStagingDispatcher).toHaveBeenCalledExactlyOnceWith({
        runtime: f.runtime,
        env: f.env,
        clock: f.time,
      });
      expect(f.operations.dispatchCandidate).toHaveBeenCalledExactlyOnceWith({
        event,
        repositoryId,
        request: f.reader,
        publish: f.publish,
        topic: f.env.STARA_STAGING_TOPIC,
        manifest: rawManifest,
        configurationSha256: '7'.repeat(64),
      });
      expect(f.operations.createArtifactPublisher).not.toHaveBeenCalled();
      await missing(f.publicFile('manifest.json'));
      await missing(f.publicFile('results.json'));
    }));

  it.each(['STARA_CONFIGURATION_SHA256', 'STARA_STAGING_TOPIC', 'GITHUB_EVENT_PATH'])(
    'requires fixed dispatch field %s',
    async (field) =>
      fixture(async (f) => {
        await seedDispatch(f);
        delete f.env[field];
        await denied(() => f.run('dispatch'));
        expect(f.operations.dispatchCandidate).not.toHaveBeenCalled();
      }),
  );

  it('denies a two-run candidate without CodeQL before dispatcher construction', async () =>
    fixture(async (f) => {
      await seedDispatch(f);
      const candidate = manifest();
      delete candidate.runs.codeql;
      await put(
        join(f.root, '.artifacts', 'release-inputs', 'candidate', 'manifest.json'),
        candidate,
      );
      await denied(() => f.run('dispatch'));
      expect(f.operations.createStagingDispatcher).not.toHaveBeenCalled();
      expect(f.operations.dispatchCandidate).not.toHaveBeenCalled();
    }));

  it.each(['event-duplicate', 'event-oversized', 'manifest-oversized', 'event-trailing'])(
    'denies malformed %s before dispatcher mutation',
    async (kind) =>
      fixture(async (f) => {
        const { event, rawManifest } = await seedDispatch(f);
        if (kind === 'event-duplicate')
          await put(
            f.env.GITHUB_EVENT_PATH,
            JSON.stringify(event).replace('{', '{"action":"completed",'),
          );
        if (kind === 'event-oversized')
          await put(f.env.GITHUB_EVENT_PATH, JSON.stringify(event).padEnd(1024 * 1024 + 1));
        if (kind === 'event-trailing')
          await put(f.env.GITHUB_EVENT_PATH, `${JSON.stringify(event)}{}`);
        if (kind === 'manifest-oversized')
          await put(
            join(f.root, '.artifacts', 'release-inputs', 'candidate', 'manifest.json'),
            rawManifest.toString().padEnd(65537),
          );
        await denied(() => f.run('dispatch'));
        expect(f.operations.dispatchCandidate).not.toHaveBeenCalled();
      }),
  );
});

describe('execute and failure propagation', () => {
  it('passes the fixed environment run identity to default runtime construction', async () =>
    fixture(async (f) => {
      const runtimeFactory = vi.fn(() => f.runtime);
      vi.doMock('../lib/process.mjs', () => ({ createRuntime: runtimeFactory }));
      vi.resetModules();
      try {
        const api = await import(/* @vite-ignore */ cliURL.href);
        expect(
          await api.main(['images'], { env: f.env, clock: f.time, operations: f.operations }),
        ).toBe(0);
        expect(runtimeFactory).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ env: f.env, runId }),
        );
        noCloud(f);
      } finally {
        vi.resetModules();
      }
    }));

  it('delegates exactly execute with env and configured Google transport without Git/source requirements', async () =>
    fixture(async (f) => {
      delete f.env.GITHUB_SHA;
      delete f.env.STARA_SOURCE_SHA;
      expect(await f.run('execute')).toBe(0);
      expect(f.operations.createAuthenticatedRequest).toHaveBeenCalledExactlyOnceWith({
        clock: f.time,
      });
      expect(f.operations.executeCLI).toHaveBeenCalledExactlyOnceWith({
        argv: ['execute'],
        env: f.env,
        clock: f.time,
        request: f.request,
      });
      expect(f.commands).not.toHaveBeenCalled();
      expect(f.operations.createGitHubReader).not.toHaveBeenCalled();
    }));

  it('acknowledges an already-running duplicate without repeating execution or publishing success', async () =>
    fixture(async (f) => {
      f.operations.executeCLI.mockResolvedValue({ status: 'running' });
      expect(await f.run('execute')).toBe(0);
      expect(f.operations.executeCLI).toHaveBeenCalledTimes(1);
      expect(f.commands).not.toHaveBeenCalled();
      expect(f.operations.createArtifactPublisher).not.toHaveBeenCalled();
      expect(f.operations.createStagingDispatcher).not.toHaveBeenCalled();
      await missing(f.publicFile('results.json'));
      await missing(f.publicFile('manifest.json'));
    }));

  it.each(['failed', 'degraded', 'reconciliation_required', 'unknown', undefined])(
    'does not exit success for executor status %s',
    async (status) =>
      fixture(async (f) => {
        f.operations.executeCLI.mockResolvedValue({ status });
        await denied(() => f.run('execute'));
      }),
  );

  it.each([
    ['images', 'verifyImages'],
    ['await-checks', 'awaitMainChecks'],
    ['execute', 'executeCLI'],
    ['publish', 'publishCandidate'],
    ['dispatch', 'dispatchCandidate'],
  ])('sanitizes %s operation failure without retry or public success', async (command, operation) =>
    fixture(async (f) => {
      if (command === 'publish') await seedPublish(f);
      if (command === 'dispatch') await seedDispatch(f);
      f.operations[operation].mockRejectedValue(new Error(canary));
      await denied(() => f.run(command));
      expect(f.operations[operation]).toHaveBeenCalledTimes(1);
      await missing(f.publicFile('manifest.json'));
    }),
  );

  it.each([false, true])(
    'executable entry runs only its own path and sanitizes failure=%s',
    async (failure) =>
      fixture(async (f) => {
        const originalArgv = process.argv;
        const originalExit = process.exitCode;
        defaultTransport.createAuthenticatedRequest.mockReturnValue(f.request);
        defaultTransport.executeCLI.mockReset();
        if (failure) defaultTransport.executeCLI.mockRejectedValue(new Error(canary));
        else defaultTransport.executeCLI.mockResolvedValue({ status: 'succeeded' });
        vi.doMock('../lib/process.mjs', () => ({ createRuntime: () => f.runtime }));
        vi.resetModules();
        try {
          process.argv = [process.execPath, fileURLToPath(cliURL), 'execute'];
          await import(/* @vite-ignore */ cliURL.href);
          await vi.waitFor(() => expect(defaultTransport.executeCLI).toHaveBeenCalledTimes(1));
          if (failure) await vi.waitFor(() => expect(process.exitCode).toBe(1));
          else expect(process.exitCode ?? 0).toBe(0);
        } finally {
          process.argv = originalArgv;
          process.exitCode = originalExit;
          vi.resetModules();
        }
      }),
  );
});
