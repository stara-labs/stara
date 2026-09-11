import { createHash } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';
import { assertUnlinked, within } from '../lib/files.mjs';
import { createRuntime } from '../lib/process.mjs';
import { parseDispatch, parseManifest, publicEvidence } from './contract.mjs';

const repositoryId = '1363262992';
const sourcePattern = /^[a-f0-9]{40}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const runPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const decimalPattern = /^[1-9][0-9]*$/;
const trivyImage =
  'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const targets = {
  '@stara/web': 'web',
  '@stara/ui': 'ui',
  '@stara/api': 'api',
  '@stara/tooling': 'tooling',
};
const commands = [
  'execute',
  'await-checks',
  'images',
  'safety',
  'publish',
  'dispatch',
  'coverage-export',
];
const systemClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};
const fail = () => new Error('Release command denied or outcome unknown');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function requireValue(condition) {
  if (!condition) throw fail();
}

function matches(value, pattern) {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

function shape(value, keys) {
  requireValue(value && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  requireValue(Reflect.ownKeys(value).length === keys.length);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
  }
}

function json(bytes, maximum) {
  requireValue(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= maximum);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(text);
  requireValue(
    parseDocument(text, { schema: 'json', uniqueKeys: true, prettyErrors: false }).errors.length ===
      0,
  );
  return value;
}

async function readBytes(path, maximum, parent) {
  requireValue(typeof path === 'string' && isAbsolute(path));
  const target = resolve(path);
  if (parent) requireValue(within(parent, target));
  await assertUnlinked(target);
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    requireValue(stat.isFile() && stat.size > 0 && stat.size <= maximum);
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    requireValue(length > 0 && length <= maximum);
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

async function writeOwned(root, path, bytes, createParents = true) {
  requireValue(within(root, resolve(path)));
  await assertUnlinked(path);
  if (createParents) await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await assertUnlinked(path);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
}

function paths(runtime) {
  requireValue(runtime && typeof runtime.root === 'string' && matches(runtime.runId, runPattern));
  const root = resolve(runtime.root);
  const directory = join(root, '.artifacts', 'release-pipeline', runtime.runId);
  return {
    root,
    directory,
    pointer: join(directory, 'result.json'),
    publicDirectory: join(root, '.artifacts', 'public-release'),
  };
}

async function git(runtime, args) {
  const result = await runtime.git(args, {
    timeout: 30_000,
    shell: false,
    record: false,
  });
  requireValue(result?.code === 0 && typeof result.stdout === 'string');
  return result.stdout;
}

async function sourceIdentity(env, runtime) {
  const supplied = ['GITHUB_SHA', 'STARA_SOURCE_SHA'].filter((key) => Object.hasOwn(env, key));
  if (supplied.length) {
    for (const key of supplied) requireValue(matches(env[key], sourcePattern));
    requireValue(supplied.every((key) => env[key] === env[supplied[0]]));
    return env[supplied[0]];
  }
  const sourceSha = (await git(runtime, ['rev-parse', '--verify', 'HEAD'])).trim();
  requireValue(matches(sourceSha, sourcePattern));
  return sourceSha;
}

function runIdentity(value) {
  shape(value, ['id', 'attempt']);
  requireValue(matches(value.id, decimalPattern));
  requireValue(Number.isSafeInteger(value.attempt) && value.attempt > 0);
}

function imageRun(env) {
  requireValue(matches(env.GITHUB_RUN_ID, decimalPattern));
  requireValue(matches(env.GITHUB_RUN_ATTEMPT, decimalPattern));
  const value = { id: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT) };
  runIdentity(value);
  return value;
}

function checkedIdentity(value, sourceSha) {
  shape(value, ['sourceSha', 'scaffold', 'codeql']);
  requireValue(value.sourceSha === sourceSha);
  runIdentity(value.scaffold);
  runIdentity(value.codeql);
  return structuredClone(value);
}

function verifiedIdentity(value, runtime, sourceSha, mode) {
  shape(value, [
    'schemaVersion',
    'sourceSha',
    'mode',
    'runId',
    'images',
    'evidenceDirectory',
    'receiptSha256',
    'verified',
  ]);
  requireValue(value.schemaVersion === 1 && value.verified === true);
  requireValue(value.sourceSha === sourceSha && value.runId === runtime.runId);
  requireValue(['ci', 'working-tree'].includes(value.mode) && (!mode || value.mode === mode));
  requireValue(value.evidenceDirectory === paths(runtime).directory);
  requireValue(matches(value.receiptSha256, hashPattern));
  shape(value.images, ['web', 'api']);
  for (const component of ['web', 'api']) {
    shape(value.images[component], ['imageId', 'tag']);
    requireValue(matches(value.images[component].imageId, /^sha256:[a-f0-9]{64}$/));
    requireValue(value.images[component].tag === `stara-release-${component}:${runtime.runId}`);
  }
  return structuredClone(value);
}

async function readPointer(runtime, sourceSha) {
  const { directory, pointer } = paths(runtime);
  return verifiedIdentity(
    json(await readBytes(pointer, 65536, directory), 65536),
    runtime,
    sourceSha,
  );
}

async function appendChecks(path, checks) {
  requireValue(typeof path === 'string' && isAbsolute(path));
  await assertUnlinked(path);
  const file = await open(path, 'r+');
  try {
    const stat = await file.stat();
    requireValue(stat.isFile());
    await file.write(
      `scaffold-run=${checks.scaffold.id}\nscaffold-attempt=${checks.scaffold.attempt}\n`,
      stat.size,
      'utf8',
    );
  } finally {
    await file.close();
  }
}

async function createGitHubReader({ env }) {
  const { request } = await import('@octokit/request');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (Object.hasOwn(env, 'GH_TOKEN')) {
    requireValue(typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.trim().length > 0);
    headers.authorization = `Bearer ${env.GH_TOKEN}`;
  }
  const silent = () => {};
  const reader = request.defaults({
    baseUrl: 'https://api.github.com',
    headers,
    request: {
      redirect: 'error',
      log: { debug: silent, info: silent, warn: silent, error: silent },
    },
  });
  return async (route, parameters) => {
    requireValue(typeof route === 'string' && route.startsWith('GET /repos/{owner}/{repo}'));
    requireValue(parameters?.owner === 'stara-labs' && parameters.repo === 'stara');
    requireValue(
      !['url', 'baseUrl', 'method', 'headers'].some((key) => Object.hasOwn(parameters, key)),
    );
    return reader(route, parameters);
  };
}

function googleRequest() {
  let client;
  return async (options) => {
    client ??= (async () => {
      const { GoogleAuth } = await import('google-auth-library');
      return new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      }).getClient();
    })();
    return (await client).request(options);
  };
}

const defaults = {
  awaitMainChecks: async (options) => (await import('./pipeline.mjs')).awaitMainChecks(options),
  verifyImages: async (options) => (await import('./pipeline.mjs')).verifyImages(options),
  checkImageEvidence: async (options) =>
    (await import('./pipeline.mjs')).checkImageEvidence(options),
  publishCandidate: async (options) => (await import('./pipeline.mjs')).publishCandidate(options),
  dispatchCandidate: async (options) => (await import('./pipeline.mjs')).dispatchCandidate(options),
  executeCLI: async (options) => (await import('./transport.mjs')).executeCLI(options),
  createAuthenticatedRequest: async (options) =>
    (await import('./transport.mjs')).createAuthenticatedRequest(options),
  createGitHubReader,
  createArtifactPublisher: async ({ env, clock }) => {
    const { createArtifactPublisher } = await import('./publisher.mjs');
    return createArtifactPublisher({
      env,
      clock,
      request: googleRequest(),
      attest: async (input) => (await import('@actions/attest')).attestProvenance(input),
      verifyBundle: async (input) => (await import('./transport.mjs')).verifyBundle(input),
    });
  },
  createStagingDispatcher: async ({ env, clock }) => {
    const { createStagingDispatcher } = await import('./publisher.mjs');
    return createStagingDispatcher({ env, clock, request: googleRequest() });
  },
};

function metric(value) {
  requireValue(value && typeof value === 'object');
  requireValue(Number.isSafeInteger(value.total) && value.total > 0);
  requireValue(
    Number.isSafeInteger(value.covered) && value.covered >= 0 && value.covered <= value.total,
  );
  requireValue(
    value.skipped === 0 && Number.isFinite(value.pct) && value.pct >= 0 && value.pct <= 100,
  );
  // Istanbul truncates percentages to two decimal places.
  requireValue(value.pct === Math.floor((10000 * value.covered) / value.total) / 100);
  return value.pct;
}

async function exportCoverage({ runtime, env, sourceSha, root, publicDirectory }) {
  requireValue(env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main');
  requireValue(
    env.GITHUB_REPOSITORY_ID === repositoryId && env.GITHUB_REPOSITORY === 'stara-labs/stara',
  );
  requireValue(env.GITHUB_SHA === sourceSha);
  const identity = imageRun(env);
  const cleanHead = async () => {
    requireValue((await git(runtime, ['rev-parse', '--verify', 'HEAD'])).trim() === sourceSha);
    requireValue(
      (await git(runtime, ['status', '--porcelain=v1', '--untracked-files=all'])) === '',
    );
  };
  await cleanHead();
  const coverage = [];
  for (const [target, directory] of Object.entries(targets)) {
    const path = join(root, '.artifacts', 'coverage', directory, 'coverage-summary.json');
    const summary = json(await readBytes(path, 16 * 1024 * 1024, root), 16 * 1024 * 1024);
    const values = {};
    for (const key of ['lines', 'branches', 'functions', 'statements'])
      values[key] = metric(summary?.total?.[key]);
    requireValue(values.lines >= 90 && values.branches >= 85);
    coverage.push({
      target,
      sourceSha,
      complete: true,
      lines: values.lines,
      branches: values.branches,
    });
  }
  await cleanHead();
  const envelope = {
    schemaVersion: 1,
    sourceSha,
    runId: identity.id,
    runAttempt: identity.attempt,
    coverage,
  };
  await writeOwned(root, join(publicDirectory, 'coverage.json'), JSON.stringify(envelope));
}

export async function main(argv = process.argv.slice(2), options = {}) {
  try {
    requireValue(Array.isArray(argv) && argv.length === 1 && commands.includes(argv[0]));
    const command = argv[0];
    const env = options.env ?? options.runtime?.env ?? process.env;
    const runtime = options.runtime ?? createRuntime({ env, runId: env.STARA_RELEASE_RUN_ID });
    const clock = options.clock ?? systemClock;
    const operations = { ...defaults, ...options.operations };
    if (command === 'execute') {
      const request = await operations.createAuthenticatedRequest({ clock });
      const result = await operations.executeCLI({ argv: ['execute'], env, clock, request });
      requireValue(['succeeded', 'running'].includes(result?.status));
      return 0;
    }
    const location = paths(runtime);
    const { root, directory, pointer, publicDirectory } = location;
    await assertUnlinked(directory);
    const sourceSha = await sourceIdentity(env, runtime);
    if (command === 'images') {
      const mode = env.CI === 'true' ? 'ci' : 'working-tree';
      const verified = verifiedIdentity(
        await operations.verifyImages({ sourceSha, mode, runtime, clock, trivyImage }),
        runtime,
        sourceSha,
        mode,
      );
      await writeOwned(directory, pointer, JSON.stringify(verified), false);
      const evidence = publicEvidence({
        schemaVersion: 1,
        sourceSha,
        synthetic: true,
        results: [{ scenario: 'REL-10', result: 'Passed', mode: 'simulation' }],
      });
      await writeOwned(root, join(publicDirectory, 'results.json'), JSON.stringify(evidence));
    } else if (command === 'safety') {
      const verified = await readPointer(runtime, sourceSha);
      requireValue((await operations.checkImageEvidence({ verified, runtime })) === true);
    } else if (command === 'coverage-export') {
      await exportCoverage({ runtime, env, sourceSha, ...location });
    } else if (command === 'await-checks' || command === 'publish') {
      const verified = command === 'publish' ? await readPointer(runtime, sourceSha) : undefined;
      const request = await operations.createGitHubReader({ env });
      const checks = checkedIdentity(
        await operations.awaitMainChecks({ sourceSha, repositoryId, request, clock }),
        sourceSha,
      );
      if (command === 'await-checks') {
        await writeOwned(root, join(directory, 'checks.json'), JSON.stringify(checks));
        if (Object.hasOwn(env, 'GITHUB_OUTPUT')) await appendChecks(env.GITHUB_OUTPUT, checks);
      } else {
        const imagesRun = imageRun(env);
        const rawCoverage = await readBytes(
          join(root, '.artifacts', 'release-inputs', 'coverage', 'coverage.json'),
          1024 * 1024,
          root,
        );
        const coveragePath = join(directory, 'coverage.json');
        await writeOwned(directory, coveragePath, rawCoverage, false);
        const { registry, storage } = await operations.createArtifactPublisher({
          runtime,
          env,
          clock,
        });
        const result = await operations.publishCandidate({
          verified,
          checks,
          coverage: { path: coveragePath, sha256: hash(rawCoverage) },
          imagesRun,
          repositoryId,
          runtime,
          registry,
          storage,
        });
        shape(result, ['manifest', 'manifestSha256']);
        const manifest = Buffer.from(JSON.stringify(result.manifest));
        const admitted = parseManifest(manifest, result.manifestSha256);
        requireValue(admitted.sourceSha === sourceSha && admitted.repositoryId === repositoryId);
        requireValue(
          admitted.runs.images.id === imagesRun.id &&
            admitted.runs.images.attempt === imagesRun.attempt,
        );
        requireValue(
          admitted.runs.scaffold.id === checks.scaffold.id &&
            admitted.runs.scaffold.attempt === checks.scaffold.attempt,
        );
        requireValue(
          admitted.runs.codeql.id === checks.codeql.id &&
            admitted.runs.codeql.attempt === checks.codeql.attempt,
        );
        await writeOwned(root, join(publicDirectory, 'manifest.json'), manifest);
      }
    } else if (command === 'dispatch') {
      requireValue(matches(env.STARA_CONFIGURATION_SHA256, hashPattern));
      requireValue(
        matches(
          env.STARA_STAGING_TOPIC,
          /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/,
        ),
      );
      const event = json(await readBytes(env.GITHUB_EVENT_PATH, 1024 * 1024), 1024 * 1024);
      const manifest = await readBytes(
        join(root, '.artifacts', 'release-inputs', 'candidate', 'manifest.json'),
        65536,
        root,
      );
      parseManifest(manifest, hash(manifest));
      const request = await operations.createGitHubReader({ env });
      const publish = await operations.createStagingDispatcher({ runtime, env, clock });
      const result = await operations.dispatchCandidate({
        event,
        repositoryId,
        request,
        publish,
        topic: env.STARA_STAGING_TOPIC,
        manifest,
        configurationSha256: env.STARA_CONFIGURATION_SHA256,
      });
      parseDispatch(Buffer.from(JSON.stringify(result)));
    }
    return 0;
  } catch {
    throw fail();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = await main();
  } catch {
    console.error('Release command denied or outcome unknown');
    process.exitCode = 1;
  }
}
