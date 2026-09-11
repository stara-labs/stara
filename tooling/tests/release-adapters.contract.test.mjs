import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateEvidence, validateProvenance } from '../release/contract.mjs';

const canary = 'synthetic-private-adapter-canary-DO-NOT-PUBLISH';
const token = `synthetic.${canary}.signature`;
const sourceSha = '1'.repeat(40);
const receiptId = 'a'.repeat(64);
const start = 1_800_000_000_000;
const clone = (value) => structuredClone(value);
const bytes = (value) =>
  Buffer.from(
    typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value),
  );
const text = (value) => (typeof value === 'string' ? value : Buffer.from(value).toString('utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const jsonBody = (value) =>
  typeof value === 'string' || value instanceof Uint8Array ? JSON.parse(text(value)) : value;
const reply = (body, status = 200, headers = {}) => ({ status, headers, body });
const bundleFor = (component) => bytes(`${JSON.stringify({ synthetic: true, component })}\n`);

const policy = {
  repositoryId: '1363262992',
  workflows: {
    scaffold: {
      workflowRef: 'stara-labs/stara/.github/workflows/checks.yml@refs/heads/main',
      jobs: [
        'Candidate verification',
        'Windows package verification',
        'Container journeys',
        'Required scaffold checks',
      ],
    },
    images: {
      workflowRef: 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main',
      jobs: ['Verify release images', 'Publish verified images'],
    },
    codeql: {
      workflowRef: 'dynamic/github-code-scanning/codeql',
      jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)'],
    },
  },
  provenanceWorkflowRef: 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main',
  requiredTargets: ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'],
};

function configuration() {
  return {
    schemaVersion: 1,
    targetId: 'staging-a',
    environment: 'staging',
    policy: clone(policy),
    projectId: 'stara-test-target',
    region: 'us-central1',
    services: { web: 'stara-web', api: 'stara-api' },
    runtimeServiceAccounts: {
      web: 'web-runtime@stara-test-target.iam.gserviceaccount.com',
      api: 'api-runtime@stara-test-target.iam.gserviceaccount.com',
    },
    imageRepositories: {
      web: 'us-central1-docker.pkg.dev/stara-test-delivery/app/web',
      api: 'us-central1-docker.pkg.dev/stara-test-delivery/app/api',
    },
    artifactBucket: 'stara-test-artifacts',
    stateBucket: 'stara-test-target-state',
    stagingOrigin: 'https://staging.app.stara.co',
    executorServiceAccount: 'executor@stara-test-delivery.iam.gserviceaccount.com',
    loggingProjectId: 'stara-test-delivery',
  };
}

function manifest() {
  return {
    schemaVersion: 1,
    sourceSha,
    repositoryId: policy.repositoryId,
    images: {
      web: { digest: `sha256:${'2'.repeat(64)}`, attestationSha256: hash(bundleFor('web')) },
      api: { digest: `sha256:${'3'.repeat(64)}`, attestationSha256: hash(bundleFor('api')) },
    },
    runs: {
      scaffold: { id: '101', attempt: 1 },
      images: { id: '102', attempt: 1 },
      codeql: { id: '103', attempt: 2 },
    },
  };
}

const coverage = () =>
  policy.requiredTargets.map((target) => ({
    target,
    sourceSha,
    complete: true,
    lines: 90,
    branches: 85,
  }));
const scope = (config) => `projects/${config.projectId}/locations/${config.region}`;
const serviceName = (config, component) =>
  `${scope(config)}/services/${config.services[component]}`;
const revisionName = (config, component, suffix = 'candidate') =>
  `${serviceName(config, component)}/revisions/${config.services[component]}-${suffix}`;
const operationName = (config) => `${scope(config)}/operations/synthetic-operation`;
const header = (headers, name) =>
  Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
let loaded;

async function implementation() {
  const url = new URL('../release/adapters.mjs', import.meta.url);
  try {
    await access(url);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      'Missing implementation: tooling/release/adapters.mjs; adapter behavior not executed',
      { cause: error },
    );
  }
  loaded ??= await import(/* @vite-ignore */ url.href);
  for (const name of ['readPrivateConfiguration', 'createCloudStore', 'createCloudAdapters']) {
    expect(loaded[name], `Missing adapter export ${name}; behavior not executed`).toBeTypeOf(
      'function',
    );
  }
  return loaded;
}

function cleanError(error) {
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/\S/);
  for (let value = error, depth = 0; value && depth < 5; value = value.cause, depth += 1) {
    expect(`${value.message ?? ''}\n${value.stack ?? ''}`).not.toContain(canary);
    expect(`${value.message ?? ''}\n${value.stack ?? ''}`).not.toContain(token);
  }
}

async function denied(action, code) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  cleanError(failure);
  if (code) expect(failure.code).toBe(code);
  return failure;
}

const transports = [];
const emitted = [];
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Live fetch is forbidden in adapter contract tests');
    }),
  );
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    vi.spyOn(console, method).mockImplementation((...values) =>
      emitted.push(
        values
          .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
          .join(' '),
      ),
    );
  }
});
afterEach(() => {
  for (const request of transports.splice(0)) {
    for (const call of request.calls) {
      expect(call.url.protocol).toBe('https:');
      expect(call.url.username).toBe('');
      expect(call.url.password).toBe('');
      expect(['GET', 'POST', 'PATCH']).toContain(call.options.method);
      expect(['json', 'bytes']).toContain(call.options.responseType);
      expect([
        'storage.googleapis.com',
        'run.googleapis.com',
        'api.github.com',
        'iamcredentials.googleapis.com',
        'logging.googleapis.com',
        'staging.app.stara.co',
      ]).toContain(call.url.hostname);
    }
  }
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(emitted.splice(0).join('\n')).not.toContain(canary);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function transport(handler) {
  const calls = [];
  const request = vi.fn(async (url, options) => {
    const call = {
      url: new URL(String(url)),
      options: { ...options },
      body: options.body === undefined ? undefined : jsonOrBytes(options.body),
    };
    calls.push(call);
    if (calls.length > 100) throw new Error('Synthetic request bound exceeded');
    return handler(call, calls.length);
  });
  request.calls = calls;
  transports.push(request);
  return request;
}

function jsonOrBytes(value) {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return clone(value);
}

function controlledClock() {
  let time = start;
  return {
    now: () => time,
    sleep: vi.fn(async (duration) => {
      time += duration;
    }),
    advance: (duration) => {
      time += duration;
    },
  };
}

function argumentsFor(extra = {}) {
  return {
    targetId: configuration().targetId,
    receiptId,
    sourceSha,
    signal: new AbortController().signal,
    deadline: start + 60_000,
    ...extra,
  };
}

async function adapters(handler, overrides = {}) {
  const api = await implementation();
  const config = overrides.configuration ?? configuration();
  const request = transport(handler);
  const clock = overrides.clock ?? controlledClock();
  const verifyAttestation =
    overrides.verifyAttestation ??
    vi.fn(async (input) => ({
      verified: true,
      sourceSha: input.sourceSha,
      repositoryId: input.repositoryId,
      workflowRef: input.workflowRef,
      imageDigest: input.imageDigest,
      attestationSha256: hash(input.bundle),
      runId: input.runId,
      runAttempt: input.runAttempt,
    }));
  return {
    api,
    config,
    request,
    clock,
    verifyAttestation,
    value: api.createCloudAdapters({ configuration: config, request, clock, verifyAttestation }),
  };
}

function objectPath(call) {
  return decodeURIComponent(
    call.url.pathname.match(/\/o\/(.*)$/)?.[1] ?? call.url.searchParams.get('name') ?? '',
  );
}

describe('private configuration: strict immutable authority before I/O', () => {
  it('accepts additional explicitly reviewed required jobs without changing fixed trust roots', async () => {
    const api = await implementation();
    const config = configuration();
    config.policy.workflows.scaffold.jobs.push('Additional reviewed check');
    expect(api.readPrivateConfiguration(bytes(config))).toEqual(config);
  });

  it.each([
    [
      'foreign repository',
      (config) => {
        config.policy.repositoryId = '666';
      },
    ],
    [
      'foreign checks workflow',
      (config) => {
        config.policy.workflows.scaffold.workflowRef =
          'stara-labs/stara/.github/workflows/other.yml@refs/heads/main';
      },
    ],
    [
      'foreign image workflow',
      (config) => {
        config.policy.workflows.images.workflowRef =
          'other/stara/.github/workflows/release.yml@refs/heads/main';
      },
    ],
    [
      'missing required target',
      (config) => {
        config.policy.requiredTargets.pop();
      },
    ],
    [
      'substituted required target',
      (config) => {
        config.policy.requiredTargets[0] = '@stara/unreviewed';
      },
    ],
    [
      'duplicate scaffold job',
      (config) => {
        config.policy.workflows.scaffold.jobs.push(config.policy.workflows.scaffold.jobs[0]);
      },
    ],
    [
      'duplicate image job',
      (config) => {
        config.policy.workflows.images.jobs.push(config.policy.workflows.images.jobs[0]);
      },
    ],
  ])('does not accept %s in private policy', async (_label, change) => {
    const api = await implementation();
    const config = configuration();
    change(config);
    await denied(() => api.readPrivateConfiguration(bytes(config)));
  });
  it('accepts the exact operator configuration from text and original UTF-8 bytes', async () => {
    const api = await implementation();
    for (const raw of [JSON.stringify(configuration()), bytes(configuration())]) {
      expect(api.readPrivateConfiguration(raw)).toEqual(configuration());
    }
  });

  it.each([
    [
      'missing CodeQL policy',
      (value) => {
        delete value.workflows.codeql;
      },
    ],
    [
      'foreign CodeQL path',
      (value) => {
        value.workflows.codeql.workflowRef = 'dynamic/other/codeql';
      },
    ],
    [
      'source-file CodeQL substitution',
      (value) => {
        value.workflows.codeql.workflowRef =
          'stara-labs/stara/.github/workflows/codeql.yml@refs/heads/main';
      },
    ],
    [
      'empty CodeQL jobs',
      (value) => {
        value.workflows.codeql.jobs = [];
      },
    ],
    [
      'missing JavaScript analysis',
      (value) => {
        value.workflows.codeql.jobs = ['Analyze (actions)'];
      },
    ],
    [
      'missing Actions analysis',
      (value) => {
        value.workflows.codeql.jobs = ['Analyze (javascript-typescript)'];
      },
    ],
    [
      'duplicate CodeQL analysis',
      (value) => {
        value.workflows.codeql.jobs.push(value.workflows.codeql.jobs[0]);
      },
    ],
  ])('rejects %s before private I/O', async (_name, mutate) => {
    const api = await implementation();
    const config = configuration();
    mutate(config.policy);
    await denied(() => api.readPrivateConfiguration(bytes(config)));
  });

  it.each(Object.keys(configuration()))(
    'rejects missing required configuration field %s',
    async (field) => {
      const api = await implementation();
      const config = configuration();
      delete config[field];
      await denied(() => api.readPrivateConfiguration(bytes(config)));
    },
  );

  it.each([
    [
      'production',
      (config) => {
        config.environment = 'production';
      },
    ],
    [
      'foreign region',
      (config) => {
        config.region = 'europe-west1';
      },
    ],
    [
      'traversing target',
      (config) => {
        config.targetId = '../other';
      },
    ],
    [
      'encoded traversal',
      (config) => {
        config.targetId = '%2e%2e%2fother';
      },
    ],
    [
      'unsafe project',
      (config) => {
        config.projectId = `other/${canary}`;
      },
    ],
    [
      'foreign service path',
      (config) => {
        config.services.web = 'projects/other/services/web';
      },
    ],
    [
      'same service',
      (config) => {
        config.services.api = config.services.web;
      },
    ],
    [
      'same runtime identity',
      (config) => {
        config.runtimeServiceAccounts.api = config.runtimeServiceAccounts.web;
      },
    ],
    [
      'foreign runtime identity',
      (config) => {
        config.runtimeServiceAccounts.api = 'runtime@foreign-target.iam.gserviceaccount.com';
      },
    ],
    [
      'mutable image tag',
      (config) => {
        config.imageRepositories.api += ':latest';
      },
    ],
    [
      'image URL',
      (config) => {
        config.imageRepositories.web = 'https://untrusted.invalid/image';
      },
    ],
    [
      'different artifact location',
      (config) => {
        config.imageRepositories.web = config.imageRepositories.web.replace(
          'us-central1',
          'europe-west1',
        );
      },
    ],
    [
      'bucket URL',
      (config) => {
        config.artifactBucket = 'gs://stara-test-artifacts';
      },
    ],
    [
      'same bucket',
      (config) => {
        config.stateBucket = config.artifactBucket;
      },
    ],
    [
      'foreign executor endpoint',
      (config) => {
        config.executorServiceAccount = 'https://untrusted.invalid/signJwt';
      },
    ],
    [
      'target project for private logs',
      (config) => {
        config.loggingProjectId = config.projectId;
      },
    ],
    [
      'empty jobs',
      (config) => {
        config.policy.workflows.scaffold.jobs = [];
      },
    ],
    [
      'duplicate required target',
      (config) => {
        config.policy.requiredTargets.push(config.policy.requiredTargets[0]);
      },
    ],
    [
      'mutable workflow ref',
      (config) => {
        config.policy.provenanceWorkflowRef = config.policy.provenanceWorkflowRef.replace(
          'refs/heads/main',
          'refs/heads/feature',
        );
      },
    ],
  ])('denies %s without leaking configured data', async (_label, change) => {
    const api = await implementation();
    const config = configuration();
    change(config);
    await denied(() => api.readPrivateConfiguration(bytes(config)));
  });

  it.each([
    'https://app.stara.co',
    'http://staging.app.stara.co',
    'https://staging.app.stara.co/',
    'https://staging.app.stara.co:443',
    'https://staging.app.stara.co.attacker.invalid',
    'https://user:password@staging.app.stara.co',
    'https://staging.app.stara.co/?url=private',
    'https://staging.app.stara.co/#private',
  ])('denies noncanonical or foreign origin %s', async (origin) => {
    const api = await implementation();
    await denied(() =>
      api.readPrivateConfiguration(bytes({ ...configuration(), stagingOrigin: origin })),
    );
  });

  it.each([
    'credentials',
    'privateKey',
    'token',
    'command',
    'productionEnabled',
    '__proto__',
    'constructor',
  ])('rejects extra authority/secret key %s', async (key) => {
    const api = await implementation();
    await denied(() => api.readPrivateConfiguration(bytes({ ...configuration(), [key]: canary })));
  });

  it.each(['services', 'runtimeServiceAccounts', 'imageRepositories', 'policy'])(
    'rejects nested extras in %s',
    async (field) => {
      const api = await implementation();
      const config = configuration();
      config[field].unexpected = canary;
      await denied(() => api.readPrivateConfiguration(bytes(config)));
    },
  );

  it.each([
    [
      'duplicate root key',
      () => JSON.stringify(configuration()).replace('{', '{"schemaVersion":1,'),
    ],
    [
      'escaped duplicate key',
      () => JSON.stringify(configuration()).replace('{', '{"\\u0073chemaVersion":1,'),
    ],
    [
      'nested duplicate',
      () =>
        JSON.stringify(configuration()).replace('"services":{', '"services":{"web":"stara-web",'),
    ],
    ['invalid UTF-8', () => Buffer.concat([bytes(configuration()), Buffer.from([0xc3, 0x28])])],
    ['trailing JSON', () => `${JSON.stringify(configuration())}{}`],
    ['null', () => 'null'],
    ['array', () => bytes([configuration()])],
    ['object bypass', configuration],
    ['too large', () => JSON.stringify(configuration()).padEnd(65537)],
  ])('rejects %s raw configuration', async (_label, input) => {
    const api = await implementation();
    await denied(() => api.readPrivateConfiguration(input()));
  });

  it('accepts the exact byte boundary including trailing whitespace', async () => {
    const api = await implementation();
    expect(api.readPrivateConfiguration(JSON.stringify(configuration()).padEnd(65536))).toEqual(
      configuration(),
    );
  });
});

const ownerId = '11111111-1111-4111-8111-111111111111';
function receiptRecord(id = receiptId, extra = {}) {
  return {
    schemaVersion: 1,
    receiptId: id,
    targetId: configuration().targetId,
    sourceSha,
    manifestSha256: '4'.repeat(64),
    configurationSha256: '5'.repeat(64),
    status: 'running',
    startedAt: start,
    totalDeadline: start + 1800000,
    pendingEffect: null,
    effects: [],
    reads: [],
    revisions: {},
    trafficChanged: false,
    serviceStateKnown: true,
    degraded: false,
    notification: { status: 'not_started' },
    ...extra,
  };
}
const activeState = (record = receiptRecord(), owner = ownerId) => ({
  lock: { receiptId: record.receiptId, ownerId: owner },
  receipts: { [record.receiptId]: record },
});
const finishedReceipt = (id = receiptId, extra = {}) =>
  receiptRecord(id, {
    status: 'succeeded',
    outcome: 'succeeded',
    finishedAt: start + 1000,
    notification: { status: 'succeeded' },
    ...extra,
  });
const finishReceipt =
  (id = receiptId, extra = {}) =>
  (state) => {
    const receipt = { ...state.receipts[id], ...finishedReceipt(id, extra) };
    return {
      state: { lock: null, receipts: { ...state.receipts, [id]: receipt } },
      value: clone(receipt),
    };
  };

function stateBackend({
  state = null,
  generation = '9007199254740993',
  conflicts = 0,
  writeFailure,
  readFailure,
  archives = {},
  archiveWrite,
  targetWrite,
  beforeRead,
  conflictState,
} = {}) {
  let stored = state === null ? null : clone(state);
  let current = BigInt(generation);
  let rejected = 0;
  const archived = new Map(Object.entries(archives).map(([id, value]) => [id, bytes(value)]));
  const archiveKey = /^receipts\/([a-f0-9]{64})\.json$/;
  const control = {
    state: () => clone(stored),
    generation: () => String(current),
    setState: (value) => {
      stored = clone(value);
      current += 1n;
    },
    archive: (id) => (archived.has(id) ? Buffer.from(archived.get(id)) : undefined),
    setArchive: (id, value) => {
      archived.set(id, bytes(value));
    },
    archiveCount: () => archived.size,
  };
  const handler = async (call) => {
    const config = configuration();
    if (call.url.hostname !== 'storage.googleapis.com')
      throw new Error('Unexpected synthetic host');
    const path = objectPath(call);
    const archive = path.match(archiveKey);
    if (call.options.method === 'GET') {
      if (beforeRead) {
        const response = await beforeRead(call, control);
        if (response !== undefined) return response;
      }
      if (archive)
        return archived.has(archive[1])
          ? reply(Buffer.from(archived.get(archive[1])), 200, { 'x-goog-generation': '1' })
          : reply(bytes({ message: canary }), 404);
      if (readFailure) return readFailure;
      if (path !== `targets/${config.targetId}.json`)
        throw new Error('Unexpected synthetic state key');
      return stored === null
        ? reply(bytes({ error: { message: canary } }), 404)
        : reply(bytes(stored), 200, { 'X-Goog-Generation': String(current) });
    }
    if (
      call.options.method !== 'POST' ||
      call.url.pathname !== `/upload/storage/v1/b/${config.stateBucket}/o`
    )
      throw new Error('Unexpected synthetic state write');
    const commit = () => {
      if (archive) archived.set(archive[1], bytes(call.body));
      else {
        stored = jsonBody(call.body);
        current += 1n;
      }
      return reply({ name: path, generation: archive ? '1' : String(current) });
    };
    if (archive) {
      expect(call.url.searchParams.get('ifGenerationMatch')).toBe('0');
      if (archiveWrite) {
        const response = await archiveWrite(call, { ...control, commit });
        if (response !== undefined) return response;
      }
      return archived.has(archive[1]) ? reply({ message: canary }, 412) : commit();
    }
    if (path !== `targets/${config.targetId}.json`)
      throw new Error('Unexpected synthetic target key');
    if (targetWrite) {
      const response = await targetWrite(call, { ...control, commit });
      if (response !== undefined) return response;
    }
    if (writeFailure) return typeof writeFailure === 'function' ? writeFailure() : writeFailure;
    if (rejected < conflicts) {
      rejected += 1;
      current += 1n;
      if (conflictState) stored = conflictState(clone(stored));
      return reply({ error: { message: canary } }, 412);
    }
    const expected = stored === null ? '0' : String(current);
    if (call.url.searchParams.get('ifGenerationMatch') !== expected)
      return reply({ error: { message: canary } }, 412);
    return commit();
  };
  return { handler, ...control };
}

async function store(backend, config = configuration()) {
  const api = await implementation();
  const request = transport(backend.handler);
  return { value: api.createCloudStore({ configuration: config, request }), request, api };
}

const appendReceipt = (state) => ({
  state: activeState(
    receiptRecord(receiptId, {
      ...(state.receipts[receiptId] ?? {}),
      reads: [
        ...(state.receipts[receiptId]?.reads ?? []),
        { operation: 'loadManifest', outcome: 'succeeded' },
      ],
    }),
  ),
  value: 'committed',
});

describe('Cloud Storage state: generation CAS and bounded conflicts, simulated HTTP only', () => {
  it('returns an unchanged active receipt without rewriting its state or generation', async () => {
    const state = activeState();
    const backend = stateBackend({ state });
    const generation = backend.generation();
    const h = await store(backend);
    const action = vi.fn((current) => ({
      state: clone(current),
      value: clone(current.receipts[receiptId]),
    }));
    expect(await h.value.transact(configuration().targetId, receiptId, action)).toEqual(
      state.receipts[receiptId],
    );
    expect(action).toHaveBeenCalledTimes(1);
    expect(h.request.calls.filter((call) => call.options.method !== 'GET')).toHaveLength(0);
    expect(backend.generation()).toBe(generation);
    expect(backend.state()).toEqual(state);
  });
  it('treats only a 404 as absent state and writes create-if-absent', async () => {
    const backend = stateBackend();
    const h = await store(backend);
    expect(await h.value.read(configuration().targetId, receiptId)).toEqual({
      lock: null,
      receipts: {},
    });
    expect(await h.value.transact(configuration().targetId, receiptId, appendReceipt)).toBe(
      'committed',
    );
    const write = h.request.calls.find((call) => call.options.method === 'POST');
    expect(write.url.searchParams.get('uploadType')).toBe('media');
    expect(write.url.searchParams.get('ifGenerationMatch')).toBe('0');
    expect(objectPath(write)).toBe(`targets/${configuration().targetId}.json`);
    expect(backend.state().receipts[receiptId].status).toBe('running');
  });

  it('preserves large decimal generations and durable state across store recreation', async () => {
    const backend = stateBackend({ state: activeState() });
    const h = await store(backend);
    expect(await h.value.transact(configuration().targetId, receiptId, appendReceipt)).toBe(
      'committed',
    );
    const writes = h.request.calls.filter((call) => call.options.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].url.searchParams.get('ifGenerationMatch')).toBe('9007199254740993');
    const fresh = h.api.createCloudStore({ configuration: configuration(), request: h.request });
    const result = await fresh.read(configuration().targetId, receiptId);
    expect(result).toEqual(backend.state());
    result.receipts[receiptId].status = 'tampered';
    expect((await fresh.read(configuration().targetId, receiptId)).receipts[receiptId].status).toBe(
      'running',
    );
  });

  it('rereads and reapplies a pure callback after a confirmed conflict', async () => {
    const backend = stateBackend({
      state: activeState(),
      conflicts: 1,
      conflictState: (state) => {
        state.receipts[receiptId].reads.push({ operation: 'readTraffic', outcome: 'succeeded' });
        return state;
      },
    });
    const h = await store(backend);
    const action = vi.fn(appendReceipt);
    expect(await h.value.transact(configuration().targetId, receiptId, action)).toBe('committed');
    expect(action).toHaveBeenCalledTimes(2);
    expect(backend.state().receipts).toHaveProperty(receiptId);
    expect(backend.state().receipts[receiptId].reads.map((read) => read.operation)).toEqual([
      'readTraffic',
      'loadManifest',
    ]);
    expect(h.request.calls.filter((call) => call.options.method === 'POST')).toHaveLength(2);
  });

  it('stops at the third 412 conflict without a fourth write or successful return', async () => {
    const h = await store(stateBackend({ conflicts: 10 }));
    const action = vi.fn(appendReceipt);
    await denied(() => h.value.transact(configuration().targetId, receiptId, action));
    expect(action).toHaveBeenCalledTimes(3);
    expect(h.request.calls.filter((call) => call.options.method === 'POST')).toHaveLength(3);
  });

  it.each([400, 403, 429, 500, 503])(
    'does not replay a state mutation on HTTP %s',
    async (status) => {
      const h = await store(
        stateBackend({ writeFailure: reply({ error: { message: canary } }, status) }),
      );
      const action = vi.fn(appendReceipt);
      await denied(() => h.value.transact(configuration().targetId, receiptId, action));
      expect(action).toHaveBeenCalledTimes(1);
      expect(h.request.calls.filter((call) => call.options.method === 'POST')).toHaveLength(1);
    },
  );

  it('does not retry or claim callback success after a timed-out write', async () => {
    const h = await store(
      stateBackend({
        writeFailure: () => {
          throw Object.assign(new Error(canary), { code: 'ETIMEDOUT' });
        },
      }),
    );
    const action = vi.fn(appendReceipt);
    await denied(() => h.value.transact(configuration().targetId, receiptId, action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(h.request.calls.filter((call) => call.options.method === 'POST')).toHaveLength(1);
  });

  it.each([401, 403, 429, 500, 503])(
    'never turns state read HTTP %s into an empty successful transaction',
    async (status) => {
      const h = await store(stateBackend({ readFailure: reply(bytes({ error: canary }), status) }));
      const action = vi.fn(appendReceipt);
      await denied(() => h.value.transact(configuration().targetId, receiptId, action));
      expect(action).not.toHaveBeenCalled();
      expect(h.request.calls).toHaveLength(1);
    },
  );

  it.each([
    ['missing generation', reply(bytes({ lock: null, receipts: {} }))],
    [
      'numeric generation',
      reply(bytes({ lock: null, receipts: {} }), 200, { 'x-goog-generation': 123 }),
    ],
    [
      'unsafe generation',
      reply(bytes({ lock: null, receipts: {} }), 200, { 'x-goog-generation': `1&x=${canary}` }),
    ],
    ['malformed JSON', reply(bytes(`{"private":"${canary}"`), 200, { 'x-goog-generation': '1' })],
    [
      'duplicate state key',
      reply(bytes('{"lock":null,"lock":null,"receipts":{}}'), 200, { 'x-goog-generation': '1' }),
    ],
    ['missing receipts', reply(bytes({ lock: null }), 200, { 'x-goog-generation': '1' })],
    [
      'array receipts',
      reply(bytes({ lock: null, receipts: [] }), 200, { 'x-goog-generation': '1' }),
    ],
    ['oversized state', reply(bytes(' '.repeat(1048577)), 200, { 'x-goog-generation': '1' })],
  ])('fails closed on %s before invoking the transaction callback', async (_label, response) => {
    const h = await store(stateBackend({ readFailure: response }));
    const action = vi.fn(appendReceipt);
    await denied(() => h.value.transact(configuration().targetId, receiptId, action));
    expect(action).not.toHaveBeenCalled();
    expect(h.request.calls.filter((call) => call.options.method === 'POST')).toEqual([]);
  });

  it('does not write when the pure callback fails', async () => {
    const h = await store(stateBackend());
    await denied(() =>
      h.value.transact(configuration().targetId, receiptId, () => {
        throw new Error(canary);
      }),
    );
    expect(h.request.calls.filter((call) => call.options.method === 'POST')).toEqual([]);
  });

  it.each(['other-target', '../staging-a', '%2e%2e/other', 'staging-a/other'])(
    'denies state access to unconfigured target %s without I/O',
    async (target) => {
      const h = await store(stateBackend());
      await denied(() => h.value.read(target, receiptId));
      await denied(() => h.value.transact(target, receiptId, appendReceipt));
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it('preserves both accepted updates from two independently constructed concurrent stores', async () => {
    const backend = stateBackend({ state: activeState() });
    let initialReads = 0;
    let release;
    const barrier = new Promise((resolve) => {
      release = resolve;
    });
    const handler = async (call) => {
      const result = await backend.handler(call);
      if (call.options.method === 'GET' && initialReads < 2) {
        initialReads += 1;
        if (initialReads === 2) release();
        await barrier;
      }
      return result;
    };
    const api = await implementation();
    const request = transport(handler);
    const first = api.createCloudStore({ configuration: configuration(), request });
    const second = api.createCloudStore({ configuration: configuration(), request });
    await Promise.all(
      [first, second].map((value, index) =>
        value.transact(configuration().targetId, receiptId, (state) => ({
          state: {
            ...state,
            receipts: {
              ...state.receipts,
              [receiptId]: {
                ...state.receipts[receiptId],
                reads: [
                  ...state.receipts[receiptId].reads,
                  { operation: index === 0 ? 'loadManifest' : 'readTraffic', outcome: 'succeeded' },
                ],
              },
            },
          },
          value: index,
        })),
      ),
    );
    expect(Object.keys(backend.state().receipts)).toEqual([receiptId]);
    expect(
      backend
        .state()
        .receipts[receiptId].reads.map((read) => read.operation)
        .sort(),
    ).toEqual(['loadManifest', 'readTraffic']);
    expect(request.calls.filter((call) => call.options.method === 'POST')).toHaveLength(3);
  });
});

const noChange =
  (id = receiptId) =>
  (state) => ({ state: clone(state), value: clone(state.receipts[id]) });
const posts = (request) => request.calls.filter((call) => call.options.method === 'POST');
const archivePosts = (request) =>
  posts(request).filter((call) => objectPath(call).startsWith('receipts/'));
const targetPosts = (request) =>
  posts(request).filter((call) => objectPath(call).startsWith('targets/'));
const timeout = () => {
  throw Object.assign(new Error(canary), { code: 'ETIMEDOUT' });
};
const successorId = 'b'.repeat(64);
const successorState = () =>
  activeState(receiptRecord(successorId), '22222222-2222-4222-8222-222222222222');

describe('receipt archive protocol: synthetic durable prefixes, not live GCS atomicity', () => {
  it.each(['succeeded', 'failed', 'degraded'])(
    'archives %s before releasing and evicting the addressed active receipt',
    async (status) => {
      const backend = stateBackend({ state: activeState() });
      const h = await store(backend);
      const terminal = finishedReceipt(receiptId, {
        status,
        outcome: status,
        degraded: status === 'degraded',
      });
      expect(
        await h.value.transact(
          configuration().targetId,
          receiptId,
          finishReceipt(receiptId, terminal),
        ),
      ).toEqual(terminal);
      expect(posts(h.request).map(objectPath)).toEqual([
        `receipts/${receiptId}.json`,
        `targets/${configuration().targetId}.json`,
      ]);
      expect(archivePosts(h.request)[0].url.searchParams.get('ifGenerationMatch')).toBe('0');
      expect(archivePosts(h.request)[0].url.searchParams.get('uploadType')).toBe('media');
      expect(jsonBody(backend.archive(receiptId))).toEqual(terminal);
      expect(backend.archive(receiptId)).toEqual(bytes(archivePosts(h.request)[0].body));
      expect(targetPosts(h.request)[0].url.searchParams.get('ifGenerationMatch')).toBe(
        '9007199254740993',
      );
      expect(jsonBody(targetPosts(h.request)[0].body)).toEqual({ lock: null, receipts: {} });
      expect(backend.state()).toEqual({ lock: null, receipts: {} });
      const fresh = await store(backend);
      expect(await fresh.value.read(configuration().targetId, receiptId)).toEqual({
        lock: null,
        receipts: { [receiptId]: terminal },
      });
      expect(await fresh.value.transact(configuration().targetId, receiptId, noChange())).toEqual(
        terminal,
      );
      expect(posts(fresh.request)).toHaveLength(0);
    },
  );

  it.each([
    ['pending intent', { pendingEffect: { operation: 'switchTraffic', component: 'web' } }],
    ['unknown service state', { serviceStateKnown: false }],
    [
      'operator reconciliation',
      { status: 'reconciliation_required', outcome: 'reconciliation_required' },
    ],
  ])('retains %s under its lock instead of creating a terminal archive', async (_label, extra) => {
    const backend = stateBackend({ state: activeState() });
    const h = await store(backend);
    const desired = activeState(receiptRecord(receiptId, extra));
    const action = vi.fn(() => ({ state: clone(desired), value: 'retained' }));
    expect(await h.value.transact(configuration().targetId, receiptId, action)).toBe('retained');
    expect(action).toHaveBeenCalledTimes(1);
    expect(backend.state()).toEqual(desired);
    expect(archivePosts(h.request)).toHaveLength(0);
    expect(targetPosts(h.request)).toHaveLength(1);
  });

  it('crash 1: recreates before archive write without synthesizing terminal success', async () => {
    const state = activeState(receiptRecord(receiptId, { pendingEffect: { operation: 'notify' } }));
    const backend = stateBackend({ state });
    const h = await store(backend);
    expect(await h.value.read(configuration().targetId, receiptId)).toEqual(state);
    expect(await h.value.transact(configuration().targetId, receiptId, noChange())).toEqual(
      state.receipts[receiptId],
    );
    const rejected = vi.fn(() => {
      throw new Error(canary);
    });
    await denied(() => h.value.transact(configuration().targetId, receiptId, rejected));
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(posts(h.request)).toHaveLength(0);
    expect(backend.archiveCount()).toBe(0);
    expect(backend.state()).toEqual(state);
  });

  it.each([false, true])(
    'archive response loss, server committed=%s: no release or mutation replay',
    async (committed) => {
      const state = activeState();
      const backend = stateBackend({
        state,
        archiveWrite: (_call, server) => {
          if (committed) server.commit();
          return timeout();
        },
      });
      const h = await store(backend);
      await denied(
        () => h.value.transact(configuration().targetId, receiptId, finishReceipt()),
        'UNKNOWN_OUTCOME',
      );
      expect(archivePosts(h.request)).toHaveLength(1);
      expect(targetPosts(h.request)).toHaveLength(0);
      expect(backend.archiveCount()).toBe(committed ? 1 : 0);
      expect(backend.state()).toEqual(state);
      const fresh = await store(backend);
      expect(await fresh.value.read(configuration().targetId, receiptId)).toEqual(state);
      expect(await fresh.value.transact(configuration().targetId, receiptId, noChange())).toEqual(
        state.receipts[receiptId],
      );
      expect(posts(fresh.request)).toHaveLength(0);
    },
  );

  it.each([400, 403, 429, 500, 503])(
    'archive HTTP %s stops before release and never retries the mutation',
    async (status) => {
      const state = activeState();
      const backend = stateBackend({
        state,
        archiveWrite: () => reply({ message: canary }, status),
      });
      const h = await store(backend);
      await denied(() => h.value.transact(configuration().targetId, receiptId, finishReceipt()));
      expect(archivePosts(h.request)).toHaveLength(1);
      expect(targetPosts(h.request)).toHaveLength(0);
      expect(backend.state()).toEqual(state);
      expect(backend.archiveCount()).toBe(0);
    },
  );

  it.each(['running', 'reconciliation_required'])(
    'crash 3: active %s overrides an acknowledged provisional archive',
    async (status) => {
      const state = activeState(receiptRecord(receiptId, { status }));
      const backend = stateBackend({ state, archives: { [receiptId]: finishedReceipt() } });
      const h = await store(backend);
      expect(await h.value.read(configuration().targetId, receiptId)).toEqual(state);
      expect(await h.value.transact(configuration().targetId, receiptId, noChange())).toEqual(
        state.receipts[receiptId],
      );
      expect(posts(h.request)).toHaveLength(0);
      expect(backend.state()).toEqual(state);
    },
  );

  it('active matching receipt remains authoritative even when its provisional archive cannot be decoded', async () => {
    const state = activeState();
    const backend = stateBackend({ state, archives: { [receiptId]: '{not valid JSON' } });
    const h = await store(backend);
    expect(await h.value.read(configuration().targetId, receiptId)).toEqual(state);
    expect(await h.value.transact(configuration().targetId, receiptId, noChange())).toEqual(
      state.receipts[receiptId],
    );
    expect(posts(h.request)).toHaveLength(0);
  });

  it('an explicit archive 412 permits release only after reading identical frozen bytes', async () => {
    const backend = stateBackend({
      state: activeState(),
      archiveWrite: (call, server) => {
        server.setArchive(receiptId, call.body);
        return reply({ message: canary }, 412);
      },
    });
    const h = await store(backend);
    expect(await h.value.transact(configuration().targetId, receiptId, finishReceipt())).toEqual(
      finishedReceipt(),
    );
    const writeIndex = h.request.calls.indexOf(archivePosts(h.request)[0]);
    const compareIndex = h.request.calls.findIndex(
      (call, index) =>
        index > writeIndex &&
        call.options.method === 'GET' &&
        objectPath(call) === `receipts/${receiptId}.json`,
    );
    const releaseIndex = h.request.calls.indexOf(targetPosts(h.request)[0]);
    expect(compareIndex).toBeGreaterThan(writeIndex);
    expect(releaseIndex).toBeGreaterThan(compareIndex);
    expect(backend.archive(receiptId)).toEqual(bytes(archivePosts(h.request)[0].body));
    expect(backend.state()).toEqual({ lock: null, receipts: {} });
  });

  it.each(['whitespace only', 'different outcome', 'missing after conflict', 'read failed'])(
    'archive 412 comparison rejects %s without releasing the target',
    async (kind) => {
      const state = activeState();
      const backend = stateBackend({
        state,
        archiveWrite: (call, server) => {
          if (kind === 'whitespace only') server.setArchive(receiptId, `${text(call.body)}\n`);
          if (kind === 'different outcome')
            server.setArchive(receiptId, {
              ...jsonBody(call.body),
              status: 'failed',
              outcome: 'failed',
            });
          return reply({ message: canary }, 412);
        },
        beforeRead: (call) => {
          if (kind === 'read failed' && objectPath(call).startsWith('receipts/'))
            return reply(bytes(canary), 503);
        },
      });
      const h = await store(backend);
      await denied(() => h.value.transact(configuration().targetId, receiptId, finishReceipt()));
      expect(archivePosts(h.request)).toHaveLength(1);
      expect(
        h.request.calls.filter(
          (call) => call.options.method === 'GET' && objectPath(call).startsWith('receipts/'),
        ).length,
      ).toBeGreaterThan(0);
      expect(targetPosts(h.request)).toHaveLength(0);
      expect(backend.state()).toEqual(state);
    },
  );

  it('crash 4: release 412 reuses frozen terminal bytes while generation and callback clock advance', async () => {
    const backend = stateBackend({ state: activeState(), conflicts: 1 });
    const h = await store(backend);
    let calls = 0;
    const action = vi.fn((state) =>
      finishReceipt(receiptId, { finishedAt: start + ++calls * 1000 })(state),
    );
    const result = await h.value.transact(configuration().targetId, receiptId, action);
    const frozen = bytes(archivePosts(h.request)[0].body);
    expect(jsonBody(frozen).finishedAt).toBe(start + 1000);
    expect(result).toEqual(jsonBody(frozen));
    expect(backend.archive(receiptId)).toEqual(frozen);
    expect(archivePosts(h.request).every((call) => bytes(call.body).equals(frozen))).toBe(true);
    expect(
      targetPosts(h.request).map((call) => call.url.searchParams.get('ifGenerationMatch')),
    ).toEqual(['9007199254740993', '9007199254740994']);
    expect(backend.state()).toEqual({ lock: null, receipts: {} });
  });

  it.each([
    [
      'changed owner',
      (state) => {
        state.lock.ownerId = '33333333-3333-4333-8333-333333333333';
      },
    ],
    [
      'reconciliation',
      (state) => {
        state.receipts[receiptId].status = 'reconciliation_required';
        state.receipts[receiptId].serviceStateKnown = false;
      },
    ],
    [
      'new pending intent',
      (state) => {
        state.receipts[receiptId].pendingEffect = { operation: 'switchTraffic', component: 'api' };
      },
    ],
    [
      'changed source',
      (state) => {
        state.receipts[receiptId].sourceSha = '9'.repeat(40);
      },
    ],
    [
      'successor admitted',
      (state) => {
        Object.assign(state, successorState());
      },
    ],
  ])('release 412 cannot overwrite %s on authoritative reread', async (_label, change) => {
    let changed;
    const backend = stateBackend({
      state: activeState(),
      conflicts: 1,
      conflictState: (state) => {
        change(state);
        changed = clone(state);
        return state;
      },
    });
    const h = await store(backend);
    await denied(() => h.value.transact(configuration().targetId, receiptId, finishReceipt()));
    expect(archivePosts(h.request)).toHaveLength(1);
    expect(targetPosts(h.request)).toHaveLength(1);
    expect(changed).toBeDefined();
    expect(backend.state()).toEqual(changed);
    expect(backend.archiveCount()).toBe(1);
  });

  it('release conflicts exhaust the three-write bound without unfreezing or clearing the lock', async () => {
    const state = activeState();
    const backend = stateBackend({ state, conflicts: 10 });
    const h = await store(backend);
    await denied(() => h.value.transact(configuration().targetId, receiptId, finishReceipt()));
    expect(targetPosts(h.request)).toHaveLength(3);
    expect(archivePosts(h.request).length).toBeGreaterThan(0);
    expect(archivePosts(h.request).length).toBeLessThanOrEqual(3);
    expect(
      archivePosts(h.request).every((call) => bytes(call.body).equals(backend.archive(receiptId))),
    ).toBe(true);
    expect(backend.state()).toEqual(state);
  });

  it.each(['not committed', 'committed', 'committed with successor'])(
    'crash 5: release response lost, %s, reports uncertainty without assuming retained lock',
    async (mode) => {
      const state = activeState();
      const backend = stateBackend({
        state,
        targetWrite: (_call, server) => {
          if (mode !== 'not committed') server.commit();
          if (mode === 'committed with successor') server.setState(successorState());
          return timeout();
        },
      });
      const h = await store(backend);
      await denied(
        () => h.value.transact(configuration().targetId, receiptId, finishReceipt()),
        'UNKNOWN_OUTCOME',
      );
      expect(archivePosts(h.request)).toHaveLength(1);
      expect(targetPosts(h.request)).toHaveLength(1);
      const expectedPersistent =
        mode === 'not committed'
          ? state
          : mode === 'committed'
            ? { lock: null, receipts: {} }
            : successorState();
      expect(backend.state()).toEqual(expectedPersistent);
      const fresh = await store(backend);
      const selected = mode === 'not committed' ? state.receipts[receiptId] : finishedReceipt();
      const expectedView = {
        ...clone(expectedPersistent),
        receipts: { ...expectedPersistent.receipts, [receiptId]: selected },
      };
      expect(await fresh.value.read(configuration().targetId, receiptId)).toEqual(expectedView);
      expect(await fresh.value.transact(configuration().targetId, receiptId, noChange())).toEqual(
        selected,
      );
      expect(posts(fresh.request)).toHaveLength(0);
      expect(backend.state()).toEqual(expectedPersistent);
    },
  );

  it('crash 6: historical no-op returns selected terminal data while preserving successor state and generation', async () => {
    const state = successorState();
    const terminal = finishedReceipt();
    const backend = stateBackend({ state, archives: { [receiptId]: terminal } });
    const generation = backend.generation();
    const h = await store(backend);
    const expected = { ...clone(state), receipts: { ...state.receipts, [receiptId]: terminal } };
    expect(await h.value.read(configuration().targetId, receiptId)).toEqual(expected);
    const action = vi.fn(noChange());
    expect(await h.value.transact(configuration().targetId, receiptId, action)).toEqual(terminal);
    expect(action).toHaveBeenCalledWith(expected);
    expect(await h.value.read(configuration().targetId, successorId)).toEqual(state);
    expect(posts(h.request)).toHaveLength(0);
    expect(backend.generation()).toBe(generation);
    expect(backend.state()).toEqual(state);
  });

  it.each([
    [
      'rewrite selected history',
      (state) => {
        state.receipts[receiptId].outcome = 'failed';
      },
    ],
    [
      'evict selected history',
      (state) => {
        delete state.receipts[receiptId];
      },
    ],
    [
      'clear successor lock',
      (state) => {
        state.lock = null;
      },
    ],
    [
      'evict successor receipt',
      (state) => {
        delete state.receipts[successorId];
      },
    ],
    [
      'mutate successor intent',
      (state) => {
        state.receipts[successorId].pendingEffect = { operation: 'switchTraffic' };
      },
    ],
    [
      'substitute owner',
      (state) => {
        state.lock.ownerId = ownerId;
      },
    ],
  ])('a historical transaction cannot %s', async (_label, change) => {
    const state = successorState();
    const terminal = finishedReceipt();
    const backend = stateBackend({ state, archives: { [receiptId]: terminal } });
    const h = await store(backend);
    const action = vi.fn((view) => {
      change(view);
      return { state: view, value: 'forbidden' };
    });
    await denied(() => h.value.transact(configuration().targetId, receiptId, action));
    expect(action).toHaveBeenCalledTimes(1);
    expect(posts(h.request)).toHaveLength(0);
    expect(backend.state()).toEqual(state);
    expect(jsonBody(backend.archive(receiptId))).toEqual(terminal);
  });

  it.each([undefined, '', '../private', 'a'.repeat(63), 'A'.repeat(64), 123, `${receiptId}/other`])(
    'rejects unsafe or missing receipt identity %s before I/O',
    async (id) => {
      const h = await store(stateBackend());
      await denied(() => h.value.read(configuration().targetId, id));
      await denied(() => h.value.transact(configuration().targetId, id, appendReceipt));
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong receipt identity', () => finishedReceipt(successorId)],
    ['wrong target identity', () => finishedReceipt(receiptId, { targetId: 'isolation-a' })],
    ['nonterminal record', () => receiptRecord()],
    [
      'missing identity',
      () => {
        const value = finishedReceipt();
        delete value.receiptId;
        return value;
      },
    ],
    ['malformed JSON', () => '{bad'],
    [
      'duplicate keys',
      () => JSON.stringify(finishedReceipt()).replace('{', '{"status":"succeeded",'),
    ],
    ['oversized object', () => JSON.stringify(finishedReceipt()).padEnd(1048577)],
    ['array record', () => [finishedReceipt()]],
  ])('denies %s archive before invoking a callback', async (_label, record) => {
    const h = await store(
      stateBackend({ state: { lock: null, receipts: {} }, archives: { [receiptId]: record() } }),
    );
    const action = vi.fn(noChange());
    await denied(() => h.value.transact(configuration().targetId, receiptId, action));
    expect(h.request.calls.some((call) => objectPath(call) === `receipts/${receiptId}.json`)).toBe(
      true,
    );
    expect(action).not.toHaveBeenCalled();
    expect(posts(h.request)).toHaveLength(0);
  });

  it.each([
    [
      'two persisted receipts',
      () => ({
        ...activeState(),
        receipts: { [receiptId]: receiptRecord(), [successorId]: receiptRecord(successorId) },
      }),
    ],
    [
      'key/body mismatch',
      () => ({ ...activeState(), receipts: { [receiptId]: receiptRecord(successorId) } }),
    ],
    [
      'foreign body target',
      () => activeState(receiptRecord(receiptId, { targetId: 'isolation-a' })),
    ],
    ['lock/body mismatch', () => ({ ...activeState(), lock: { receiptId: successorId, ownerId } })],
  ])('denies target %s before executing a callback', async (_label, input) => {
    const h = await store(stateBackend({ state: input() }));
    const action = vi.fn(noChange());
    await denied(() => h.value.transact(configuration().targetId, receiptId, action));
    expect(
      h.request.calls.some(
        (call) => objectPath(call) === `targets/${configuration().targetId}.json`,
      ),
    ).toBe(true);
    expect(action).not.toHaveBeenCalled();
    expect(posts(h.request)).toHaveLength(0);
  });

  it('400 historical receipts exceed 1 MiB collectively without a target history or whole-history load', async () => {
    const records = Array.from({ length: 400 }, (_, index) => {
      const id = hash(`synthetic historical receipt ${index}`);
      return [
        id,
        finishedReceipt(id, {
          reads: Array.from({ length: 64 }, () => ({
            operation: 'loadManifest',
            attempt: 1,
            startedAt: start,
            finishedAt: start + 1,
            outcome: 'succeeded',
          })),
        }),
      ];
    });
    const archives = Object.fromEntries(records);
    expect(records.reduce((sum, [, record]) => sum + bytes(record).length, 0)).toBeGreaterThan(
      1048576,
    );
    expect(records.every(([, record]) => bytes(record).length < 1048576)).toBe(true);
    const backend = stateBackend({ state: { lock: null, receipts: {} }, archives });
    for (const [id, record] of [records[0], records[200], records[399]]) {
      const h = await store(backend);
      expect(await h.value.read(configuration().targetId, id)).toEqual({
        lock: null,
        receipts: { [id]: record },
      });
      expect(await h.value.transact(configuration().targetId, id, noChange(id))).toEqual(record);
      expect(posts(h.request)).toHaveLength(0);
      expect(
        h.request.calls.every((call) =>
          [`targets/${configuration().targetId}.json`, `receipts/${id}.json`].includes(
            objectPath(call),
          ),
        ),
      ).toBe(true);
    }
    const fresh = await store(backend);
    expect(await fresh.value.transact(configuration().targetId, receiptId, appendReceipt)).toBe(
      'committed',
    );
    const active = backend.state();
    const generation = backend.generation();
    const [oldestId, oldest] = records[0];
    const duplicate = await store(backend);
    expect(
      await duplicate.value.transact(configuration().targetId, oldestId, noChange(oldestId)),
    ).toEqual(oldest);
    expect(posts(duplicate.request)).toHaveLength(0);
    expect(backend.state()).toEqual(active);
    expect(backend.generation()).toBe(generation);
    expect(Object.keys(backend.state().receipts)).toEqual([receiptId]);
    expect(
      await fresh.value.transact(configuration().targetId, receiptId, finishReceipt()),
    ).toEqual(finishedReceipt());
    expect(backend.archiveCount()).toBe(401);
    expect(backend.state()).toEqual({ lock: null, receipts: {} });
    expect(
      targetPosts(fresh.request).every(
        (call) =>
          bytes(call.body).length < 1048576 &&
          Object.keys(jsonBody(call.body).receipts).length <= 1,
      ),
    ).toBe(true);
    expect(posts(fresh.request).map(objectPath)).toEqual([
      `targets/${configuration().targetId}.json`,
      `receipts/${receiptId}.json`,
      `targets/${configuration().targetId}.json`,
    ]);
    expect(jsonBody(backend.archive(oldestId))).toEqual(oldest);
  });
});

describe('immutable artifact reads and injected signature verification', () => {
  it('fetches the fixed manifest object and preserves exact bytes for core hashing', async () => {
    const raw = bytes(`${JSON.stringify(manifest())}\n`);
    const h = await adapters(() => reply(raw));
    const args = argumentsFor({ manifestSha256: hash(raw), maxBytes: 65536 });
    const actual = await h.value.loadManifest(args);
    expect(bytes(actual)).toEqual(raw);
    expect(h.request.calls).toHaveLength(1);
    const call = h.request.calls[0];
    expect(call.url.pathname).toContain(`/b/${h.config.artifactBucket}/o/`);
    expect(objectPath(call)).toBe(`manifests/${hash(raw)}.json`);
    expect(call.url.searchParams.get('alt')).toBe('media');
    expect(call.options.responseType).toBe('bytes');
    expect(call.options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(['../private', 'A'.repeat(64), '1'.repeat(63), `https://untrusted.invalid/${canary}`])(
    'rejects unsafe manifest digest %s before I/O',
    async (digest) => {
      const h = await adapters(() => reply(bytes(manifest())));
      await denied(() =>
        h.value.loadManifest(argumentsFor({ manifestSha256: digest, maxBytes: 65536 })),
      );
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it('rejects oversized manifest bytes even with a deceptive Content-Length', async () => {
    const raw = bytes(' '.repeat(65537));
    const h = await adapters(() => reply(raw, 200, { 'content-length': '1' }));
    await denied(() =>
      h.value.loadManifest(argumentsFor({ manifestSha256: hash(raw), maxBytes: 65536 })),
    );
  });

  it.each([301, 302, 307, 308])('does not follow artifact redirect HTTP %s', async (status) => {
    const h = await adapters(() =>
      reply(bytes(canary), status, { location: `https://untrusted.invalid/${canary}` }),
    );
    await denied(() =>
      h.value.loadManifest(argumentsFor({ manifestSha256: '4'.repeat(64), maxBytes: 65536 })),
    );
    expect(h.request.calls).toHaveLength(1);
  });

  it.each([429, 500, 503])(
    'leaves transient artifact read retry HTTP %s to the core',
    async (status) => {
      const h = await adapters(() => reply(bytes({ message: canary }), status));
      await denied(
        () =>
          h.value.loadManifest(argumentsFor({ manifestSha256: '4'.repeat(64), maxBytes: 65536 })),
        'TRANSIENT_READ',
      );
      expect(h.request.calls).toHaveLength(1);
    },
  );

  it.each(['web', 'api'])(
    'hashes %s attestation bytes and delegates actual verification with exact trusted inputs',
    async (component) => {
      const candidate = manifest();
      const bundle = bundleFor(component);
      const h = await adapters(() => reply(bundle));
      const result = await h.value.verifyProvenance(
        argumentsFor({ component, manifest: candidate }),
      );
      expect(h.verifyAttestation).toHaveBeenCalledTimes(1);
      const input = h.verifyAttestation.mock.calls[0][0];
      expect(bytes(input.bundle)).toEqual(bundle);
      expect(input).toMatchObject({
        imageDigest: candidate.images[component].digest,
        sourceSha,
        repositoryId: policy.repositoryId,
        workflowRef: policy.provenanceWorkflowRef,
        runId: candidate.runs.images.id,
        runAttempt: candidate.runs.images.attempt,
      });
      expect(objectPath(h.request.calls[0])).toBe(`attestations/${hash(bundle)}.jsonl`);
      expect(() => validateProvenance(candidate, component, result, policy)).not.toThrow();
    },
  );

  it.each(['wrong bytes', 'oversized bytes'])(
    'does not invoke signature verification for %s',
    async (kind) => {
      const raw = kind === 'wrong bytes' ? bytes(canary) : bytes(' '.repeat(1048577));
      const h = await adapters(() => reply(raw));
      await denied(() =>
        h.value.verifyProvenance(argumentsFor({ component: 'web', manifest: manifest() })),
      );
      expect(h.verifyAttestation).not.toHaveBeenCalled();
    },
  );

  it('propagates sanitized signature failure without claiming verified provenance', async () => {
    const verifyAttestation = vi.fn(async () => {
      throw new Error(canary);
    });
    const h = await adapters(() => reply(bundleFor('web')), { verifyAttestation });
    await denied(() =>
      h.value.verifyProvenance(argumentsFor({ component: 'web', manifest: manifest() })),
    );
    expect(verifyAttestation).toHaveBeenCalledTimes(1);
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
  ])('cannot turn mismatched verifier %s into successful core provenance', async (field) => {
    const candidate = manifest();
    const facts = {
      verified: true,
      sourceSha,
      repositoryId: policy.repositoryId,
      workflowRef: policy.provenanceWorkflowRef,
      imageDigest: candidate.images.web.digest,
      attestationSha256: candidate.images.web.attestationSha256,
      runId: candidate.runs.images.id,
      runAttempt: candidate.runs.images.attempt,
    };
    facts[field] = field === 'verified' ? false : '0'.repeat(64);
    const h = await adapters(() => reply(bundleFor('web')), {
      verifyAttestation: vi.fn(async () => facts),
    });
    await denied(async () =>
      validateProvenance(
        candidate,
        'web',
        await h.value.verifyProvenance(argumentsFor({ component: 'web', manifest: candidate })),
        policy,
      ),
    );
  });

  it('passes the selected image run and retry attempt to signature verification, not CodeQL or checks', async () => {
    const candidate = manifest();
    candidate.runs.images = { id: '987654321', attempt: 3 };
    const h = await adapters(() => reply(bundleFor('web')));
    const facts = await h.value.verifyProvenance(
      argumentsFor({ component: 'web', manifest: candidate }),
    );
    expect(h.verifyAttestation).toHaveBeenCalledTimes(1);
    expect(h.verifyAttestation.mock.calls[0][0]).toMatchObject({
      runId: '987654321',
      runAttempt: 3,
    });
    expect(facts).toMatchObject({ runId: '987654321', runAttempt: 3 });
    expect(() => validateProvenance(candidate, 'web', facts, policy)).not.toThrow();
  });

  it.each([
    [
      'missing run',
      (facts) => {
        delete facts.runId;
      },
    ],
    [
      'missing attempt',
      (facts) => {
        delete facts.runAttempt;
      },
    ],
    [
      'other same-SHA run',
      (facts) => {
        facts.runId = '999';
      },
    ],
    [
      'CodeQL run',
      (facts) => {
        facts.runId = '103';
        facts.runAttempt = 2;
      },
    ],
    [
      'other image attempt',
      (facts) => {
        facts.runAttempt = 2;
      },
    ],
    [
      'numeric run coercion',
      (facts) => {
        facts.runId = 102;
      },
    ],
    [
      'string attempt coercion',
      (facts) => {
        facts.runAttempt = '1';
      },
    ],
  ])(
    'never accepts verifier %s by supplying trusted run identity from the manifest',
    async (_name, mutate) => {
      const candidate = manifest();
      const facts = {
        verified: true,
        sourceSha,
        repositoryId: policy.repositoryId,
        workflowRef: policy.provenanceWorkflowRef,
        imageDigest: candidate.images.web.digest,
        attestationSha256: candidate.images.web.attestationSha256,
        runId: candidate.runs.images.id,
        runAttempt: candidate.runs.images.attempt,
      };
      mutate(facts);
      const h = await adapters(() => reply(bundleFor('web')), {
        verifyAttestation: vi.fn(async () => facts),
      });
      await denied(async () =>
        validateProvenance(
          candidate,
          'web',
          await h.value.verifyProvenance(argumentsFor({ component: 'web', manifest: candidate })),
          policy,
        ),
      );
      expect(h.verifyAttestation).toHaveBeenCalledTimes(1);
    },
  );
});

function evidenceBackend(change = () => {}) {
  const candidate = manifest();
  const repo = {
    id: 1363262992,
    full_name: 'stara-labs/stara',
    default_branch: 'main',
    owner: { id: 293455507, login: 'stara-labs' },
  };
  const model = {
    repo,
    main: sourceSha,
    coverage: coverage(),
    workflows: {
      201: { id: 201, path: '.github/workflows/checks.yml', state: 'active' },
      202: { id: 202, path: '.github/workflows/release.yml', state: 'active' },
      355366692: { id: 355366692, path: 'dynamic/github-code-scanning/codeql', state: 'active' },
    },
    runs: Object.fromEntries(
      Object.entries(candidate.runs).map(([kind, run]) => [
        run.id,
        {
          id: Number(run.id),
          run_attempt: run.attempt,
          run_number: kind === 'codeql' ? 1000 : Number(run.id),
          head_sha: sourceSha,
          event: kind === 'codeql' ? 'dynamic' : 'push',
          status: 'completed',
          conclusion: 'success',
          path:
            kind === 'codeql'
              ? 'dynamic/github-code-scanning/codeql'
              : `.github/workflows/${kind === 'scaffold' ? 'checks' : 'release'}.yml`,
          head_branch: 'main',
          repository: clone(repo),
          head_repository: clone(repo),
          workflow_id: kind === 'codeql' ? 355366692 : kind === 'scaffold' ? 201 : 202,
        },
      ]),
    ),
    jobs: Object.fromEntries(
      Object.entries(candidate.runs).map(([kind, run]) => [
        run.id,
        policy.workflows[kind].jobs.map((name, index) => ({
          id: Number(run.id) * 10 + index,
          run_id: Number(run.id),
          run_attempt: run.attempt,
          name,
          status: 'completed',
          conclusion: 'success',
          head_sha: sourceSha,
        })),
      ]),
    ),
  };
  model.currentRuns = clone(model.runs);
  model.codeqlInventory = { total_count: 1, workflow_runs: [clone(model.runs['103'])] };
  change(model);
  const handler = (call) => {
    const path = call.url.pathname;
    if (call.url.hostname === 'storage.googleapis.com') {
      if (objectPath(call) !== `coverage/${sourceSha}/101-1.json`)
        throw new Error('Unexpected synthetic coverage key');
      return reply(model.rawCoverage ?? bytes(model.coverage));
    }
    if (call.url.hostname !== 'api.github.com')
      throw new Error('Unexpected synthetic evidence host');
    if (path === '/repos/stara-labs/stara') return reply(clone(model.repo));
    if (path === '/repos/stara-labs/stara/commits/main') return reply({ sha: model.main });
    if (path === '/repos/stara-labs/stara/git/ref/heads/main')
      return reply({ ref: 'refs/heads/main', object: { type: 'commit', sha: model.main } });
    if (path === '/repos/stara-labs/stara/actions/workflows/355366692/runs')
      return reply(clone(model.codeqlInventory));
    const match = path.match(
      /^\/repos\/stara-labs\/stara\/actions\/runs\/(101|102|103)(?:\/attempts\/(\d+))?(\/jobs)?$/,
    );
    if (match) {
      const expected = Object.values(candidate.runs).find((run) => run.id === match[1]);
      if (match[2] && Number(match[2]) !== expected.attempt)
        throw new Error('Unexpected synthetic attempt endpoint');
      if (match[3])
        return reply({
          total_count: model.jobs[match[1]].length,
          jobs: clone(model.jobs[match[1]]),
        });
      return reply(clone(match[2] ? model.runs[match[1]] : model.currentRuns[match[1]]));
    }
    const workflow = path.match(
      /^\/repos\/stara-labs\/stara\/actions\/workflows\/(201|202|355366692)$/,
    );
    if (workflow) return reply(clone(model.workflows[workflow[1]]));
    throw new Error('Unexpected synthetic evidence route');
  };
  return { model, handler };
}

const codeqlInventoryPath = '/repos/stara-labs/stara/actions/workflows/355366692/runs';
const inventoryReads = (request) =>
  request.calls.filter((call) => call.url.pathname === codeqlInventoryPath);
function setCodeqlInventory(model, runs) {
  model.codeqlInventory = { total_count: runs.length, workflow_runs: clone(runs) };
}
const otherCodeqlRun = (model, extra = {}) => ({
  ...clone(model.runs['103']),
  id: 104,
  run_number: 1001,
  run_attempt: 1,
  ...extra,
});

describe('latest CodeQL workflow inventory: distinct-run eligibility, synthetic HTTP', () => {
  it('collects dynamic CodeQL without narrowing inventory by event', async () => {
    const fixture = evidenceBackend();
    const h = await adapters((call) =>
      call.url.pathname === codeqlInventoryPath &&
      call.url.searchParams.has('event') &&
      call.url.searchParams.get('event') !== 'dynamic'
        ? reply({ total_count: 0, workflow_runs: [] })
        : fixture.handler(call),
    );
    const candidate = manifest();
    const actual = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, actual, policy)).not.toThrow();
    expect(inventoryReads(h.request)[0].url.searchParams.has('event')).toBe(false);
    expect(actual.runs.map((run) => [run.id, run.event])).toEqual([
      ['101', 'push'],
      ['103', 'dynamic'],
      ['102', 'push'],
    ]);
  });

  it.each(['inventory', 'current', 'attempt', 'all'])(
    'rejects push-labelled CodeQL at the %s boundary even when every other field matches',
    async (phase) => {
      const fixture = evidenceBackend((model) => {
        if (['inventory', 'all'].includes(phase))
          model.codeqlInventory.workflow_runs[0].event = 'push';
        if (['current', 'all'].includes(phase)) model.currentRuns['103'].event = 'push';
        if (['attempt', 'all'].includes(phase)) model.runs['103'].event = 'push';
      });
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      const selected = h.request.calls.filter((call) =>
        call.url.pathname.includes('/actions/runs/103'),
      );
      if (phase === 'inventory' || phase === 'all') expect(selected).toEqual([]);
      else
        expect(
          selected.some((call) =>
            call.url.pathname.endsWith(
              phase === 'current' ? '/actions/runs/103' : '/actions/runs/103/attempts/2',
            ),
          ),
        ).toBe(true);
    },
  );

  it.each([
    ['scaffold', 'currentRuns'],
    ['scaffold', 'runs'],
    ['images', 'currentRuns'],
    ['images', 'runs'],
  ])('still rejects dynamic %s %s evidence', async (kind, field) => {
    const candidate = manifest();
    const id = candidate.runs[kind].id;
    const fixture = evidenceBackend((model) => {
      model[field][id].event = 'dynamic';
    });
    const h = await adapters(fixture.handler);
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })));
    const suffix = `/actions/runs/${id}${field === 'runs' ? `/attempts/${candidate.runs[kind].attempt}` : ''}`;
    expect(h.request.calls.some((call) => call.url.pathname.endsWith(suffix))).toBe(true);
  });

  it('denies a newer unsupported push CodeQL run instead of hiding it with an event filter', async () => {
    const fixture = evidenceBackend((model) =>
      setCodeqlInventory(model, [model.runs['103'], otherCodeqlRun(model, { event: 'push' })]),
    );
    const h = await adapters((call) => {
      if (call.url.pathname !== codeqlInventoryPath) return fixture.handler(call);
      const entries = fixture.model.codeqlInventory.workflow_runs.filter(
        (run) =>
          !call.url.searchParams.has('event') || run.event === call.url.searchParams.get('event'),
      );
      return reply({ total_count: entries.length, workflow_runs: clone(entries) });
    });
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(inventoryReads(h.request)).toHaveLength(1);
    expect(inventoryReads(h.request)[0].url.searchParams.has('event')).toBe(false);
    expect(h.request.calls.at(-1).url.pathname).toBe(codeqlInventoryPath);
  });

  it('reads complete exact-source main inventory without filtering event, failures or pending runs', async () => {
    const fixture = evidenceBackend();
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    const actual = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, actual, policy)).not.toThrow();
    expect(inventoryReads(h.request)).toHaveLength(1);
    const call = inventoryReads(h.request)[0];
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      head_sha: sourceSha,
      branch: 'main',
      per_page: '100',
      page: '1',
    });
    expect([...call.url.searchParams]).toHaveLength(4);
    expect(call.options).toMatchObject({ method: 'GET', responseType: 'json' });
    expect(call.url.hostname).toBe('api.github.com');
    for (const suffix of [
      '/actions/runs/103',
      '/actions/runs/103/attempts/2',
      '/actions/runs/103/attempts/2/jobs',
      '/actions/workflows/355366692',
    ]) {
      expect(h.request.calls.some((request) => request.url.pathname.endsWith(suffix))).toBe(true);
    }
  });

  it.each(['old first', 'new first'])(
    'accepts an older failed run and newest successful manifest run, %s, ordered by run_number not ID',
    async (order) => {
      const fixture = evidenceBackend((model) => {
        const older = otherCodeqlRun(model, { id: 999999, run_number: 999, conclusion: 'failure' });
        const newest = clone(model.runs['103']);
        setCodeqlInventory(model, order === 'old first' ? [older, newest] : [newest, older]);
      });
      const h = await adapters(fixture.handler);
      const candidate = manifest();
      const actual = await h.value.collectEvidence(
        argumentsFor({ manifest: candidate, sourceSha }),
      );
      expect(() => validateEvidence(candidate, actual, policy)).not.toThrow();
      expect(actual.runs.find((run) => run.id === '103')).toMatchObject({
        attempt: 2,
        status: 'completed',
        conclusion: 'success',
      });
      expect(inventoryReads(h.request)).toHaveLength(1);
      expect(
        h.request.calls.some((call) => call.url.pathname.includes('/actions/runs/999999')),
      ).toBe(false);
    },
  );

  it.each([
    ['failed', 'completed', 'failure'],
    ['queued', 'queued', null],
    ['in progress', 'in_progress', null],
    ['cancelled', 'completed', 'cancelled'],
    ['successful but unbound', 'completed', 'success'],
  ])(
    'denies newer run 104 %s instead of accepting manifest run 103 success',
    async (_label, status, conclusion) => {
      const fixture = evidenceBackend((model) =>
        setCodeqlInventory(model, [
          model.runs['103'],
          otherCodeqlRun(model, { status, conclusion }),
        ]),
      );
      expect(fixture.model.currentRuns['103']).toMatchObject({
        status: 'completed',
        conclusion: 'success',
        run_attempt: 2,
      });
      expect(fixture.model.runs['103']).toMatchObject({
        status: 'completed',
        conclusion: 'success',
        run_attempt: 2,
      });
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(inventoryReads(h.request)).toHaveLength(1);
      expect(h.request.calls.every((call) => call.options.method === 'GET')).toBe(true);
    },
  );

  it('reversing a stale inventory cannot make the old successful manifest run newest', async () => {
    const fixture = evidenceBackend((model) =>
      setCodeqlInventory(model, [
        otherCodeqlRun(model, { conclusion: 'failure' }),
        model.runs['103'],
      ]),
    );
    const h = await adapters(fixture.handler);
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(inventoryReads(h.request)).toHaveLength(1);
  });

  it('rereads inventory before traffic and denies a separate newer failed run arriving after admission', async () => {
    const fixture = evidenceBackend();
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    const first = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, first, policy)).not.toThrow();
    setCodeqlInventory(fixture.model, [
      otherCodeqlRun(fixture.model, { conclusion: 'failure' }),
      fixture.model.runs['103'],
    ]);
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })));
    expect(inventoryReads(h.request)).toHaveLength(2);
    expect(fixture.model.currentRuns['103'].conclusion).toBe('success');
    expect(h.request.calls.every((call) => call.options.method === 'GET')).toBe(true);
  });

  it.each([
    ['empty', (model) => setCodeqlInventory(model, [])],
    [
      'missing count',
      (model) => {
        delete model.codeqlInventory.total_count;
      },
    ],
    [
      'string count',
      (model) => {
        model.codeqlInventory.total_count = '1';
      },
    ],
    [
      'partial count',
      (model) => {
        model.codeqlInventory.total_count = 2;
      },
    ],
    [
      'underreported count',
      (model) => {
        model.codeqlInventory.total_count = 0;
      },
    ],
    [
      'over bounded count',
      (model) => {
        model.codeqlInventory.total_count = 101;
      },
    ],
    [
      'missing runs',
      (model) => {
        delete model.codeqlInventory.workflow_runs;
      },
    ],
    [
      'non-array runs',
      (model) => {
        model.codeqlInventory.workflow_runs = {};
      },
    ],
    [
      'duplicate ID',
      (model) =>
        setCodeqlInventory(model, [model.runs['103'], { ...model.runs['103'], run_number: 999 }]),
    ],
    [
      'ambiguous maximum ordinal',
      (model) =>
        setCodeqlInventory(model, [model.runs['103'], otherCodeqlRun(model, { run_number: 1000 })]),
    ],
    ['missing manifest run', (model) => setCodeqlInventory(model, [otherCodeqlRun(model)])],
  ])(
    'denies %s inventory rather than claiming it complete or selecting older success',
    async (_label, change) => {
      const fixture = evidenceBackend(change);
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(inventoryReads(h.request)).toHaveLength(1);
    },
  );

  it.each([undefined, null, 0, -1, 1.5, '1000', Number.MAX_SAFE_INTEGER + 1])(
    'denies invalid workflow run_number %s without falling back to ID or response order',
    async (number) => {
      const fixture = evidenceBackend((model) => {
        model.codeqlInventory.workflow_runs[0].run_number = number;
      });
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(inventoryReads(h.request)).toHaveLength(1);
    },
  );

  it.each([
    [
      'workflow ID',
      (run) => {
        run.workflow_id = 666;
      },
    ],
    [
      'native workflow path',
      (run) => {
        run.path = '.github/workflows/codeql.yml';
      },
    ],
    [
      'repository ID',
      (run) => {
        run.repository.id = 666;
      },
    ],
    [
      'head repository ID',
      (run) => {
        run.head_repository.id = 666;
      },
    ],
    [
      'source SHA',
      (run) => {
        run.head_sha = 'f'.repeat(40);
      },
    ],
    [
      'branch',
      (run) => {
        run.head_branch = 'feature';
      },
    ],
    [
      'event',
      (run) => {
        run.event = 'pull_request';
      },
    ],
    [
      'noncanonical ID',
      (run) => {
        run.id = '0104';
      },
    ],
    [
      'unsafe numeric ID',
      (run) => {
        run.id = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'zero ID',
      (run) => {
        run.id = 0;
      },
    ],
    [
      'missing attempt',
      (run) => {
        delete run.run_attempt;
      },
    ],
    [
      'nonpositive attempt',
      (run) => {
        run.run_attempt = 0;
      },
    ],
  ])('validates %s even on an older unselected inventory entry', async (_label, change) => {
    const fixture = evidenceBackend((model) => {
      const older = otherCodeqlRun(model, { run_number: 999, conclusion: 'failure' });
      change(older);
      setCodeqlInventory(model, [model.runs['103'], older]);
    });
    const h = await adapters(fixture.handler);
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(inventoryReads(h.request)).toHaveLength(1);
  });

  it.each([
    ['changed attempt', { run_attempt: 3 }],
    ['pending selected run', { status: 'in_progress', conclusion: null }],
    ['failed selected run', { status: 'completed', conclusion: 'failure' }],
  ])(
    'denies inventory %s despite still-successful exact/current endpoints',
    async (_label, extra) => {
      const fixture = evidenceBackend((model) =>
        Object.assign(model.codeqlInventory.workflow_runs[0], extra),
      );
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(inventoryReads(h.request)).toHaveLength(1);
    },
  );

  it.each(['currentRuns', 'runs'])(
    'requires %s workflow ordinal to match the selected inventory record',
    async (field) => {
      const fixture = evidenceBackend((model) => {
        model[field]['103'].run_number = 1001;
      });
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(inventoryReads(h.request)).toHaveLength(1);
      const suffix = field === 'currentRuns' ? '/actions/runs/103' : '/actions/runs/103/attempts/2';
      expect(h.request.calls.some((call) => call.url.pathname.endsWith(suffix))).toBe(true);
    },
  );

  it.each([
    `<https://api.github.com${codeqlInventoryPath}?page=2>; rel="next"`,
    `<https://untrusted.invalid/private>; rel="next"`,
  ])('denies a pagination link without following it: %s', async (link) => {
    const fixture = evidenceBackend();
    const h = await adapters((call) =>
      call.url.pathname === codeqlInventoryPath
        ? reply(clone(fixture.model.codeqlInventory), 200, { Link: link })
        : fixture.handler(call),
    );
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(inventoryReads(h.request)).toHaveLength(1);
    expect(
      h.request.calls.every(
        (call) => !call.url.searchParams.has('page') || call.url.searchParams.get('page') === '1',
      ),
    ).toBe(true);
    expect(h.request.calls.every((call) => call.url.hostname !== 'untrusted.invalid')).toBe(true);
  });

  it.each([404, 429, 500, 503])(
    'inventory HTTP %s cannot fall back to successful current/exact run data',
    async (status) => {
      const fixture = evidenceBackend();
      const h = await adapters((call) =>
        call.url.pathname === codeqlInventoryPath
          ? reply({ message: canary }, status)
          : fixture.handler(call),
      );
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(inventoryReads(h.request)).toHaveLength(1);
    },
  );

  it('accepts a complete 100-run inventory and selects only the greatest workflow ordinal', async () => {
    const fixture = evidenceBackend((model) =>
      setCodeqlInventory(model, [
        ...Array.from({ length: 99 }, (_, index) =>
          otherCodeqlRun(model, { id: 2000 + index, run_number: index + 1, conclusion: 'failure' }),
        ),
        model.runs['103'],
      ]),
    );
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    const actual = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, actual, policy)).not.toThrow();
    expect(inventoryReads(h.request)).toHaveLength(1);
    expect(
      h.request.calls.some((call) => /\/actions\/runs\/2[0-9]{3}/.test(call.url.pathname)),
    ).toBe(false);
  });

  it('denies a complete 101-run inventory instead of expanding the fixed read bound', async () => {
    const fixture = evidenceBackend((model) =>
      setCodeqlInventory(model, [
        ...Array.from({ length: 100 }, (_, index) =>
          otherCodeqlRun(model, { id: 2000 + index, run_number: index + 1 }),
        ),
        model.runs['103'],
      ]),
    );
    const h = await adapters(fixture.handler);
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(inventoryReads(h.request)).toHaveLength(1);
  });
});

describe('independent GitHub and coverage evidence: real core validation, synthetic HTTP', () => {
  it('reads repository, main, exact runs/jobs and immutable raw coverage before returning evidence', async () => {
    const fixture = evidenceBackend();
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    const actual = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, actual, policy)).not.toThrow();
    expect(actual.coverage).toEqual(coverage());
    expect(actual.currentMainSha).toBe(sourceSha);
    const paths = h.request.calls.map((call) => call.url.pathname);
    expect(paths).toContain('/repos/stara-labs/stara');
    expect(paths.some((path) => /\/(?:commits\/main|git\/ref\/heads\/main)$/.test(path))).toBe(
      true,
    );
    for (const { id, attempt } of Object.values(candidate.runs)) {
      expect(paths).toContain(`/repos/stara-labs/stara/actions/runs/${id}`);
      expect(
        paths.some((path) => new RegExp(`/actions/runs/${id}/attempts/${attempt}$`).test(path)),
      ).toBe(true);
      expect(
        paths.some((path) =>
          new RegExp(`/actions/runs/${id}/attempts/${attempt}/jobs$`).test(path),
        ),
      ).toBe(true);
    }
    expect(paths).toContain('/repos/stara-labs/stara/actions/workflows/355366692');
    expect(actual.runs).toHaveLength(3);
    expect(actual.runs.find((run) => run.id === candidate.runs.codeql.id)).toMatchObject({
      attempt: 2,
      workflowRef: 'dynamic/github-code-scanning/codeql',
      headSha: sourceSha,
      event: 'dynamic',
      status: 'completed',
      conclusion: 'success',
      jobs: policy.workflows.codeql.jobs.map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    });
    const storage = h.request.calls.filter(
      (call) => call.url.hostname === 'storage.googleapis.com',
    );
    expect(storage).toHaveLength(1);
    expect(objectPath(storage[0])).toBe(`coverage/${sourceSha}/101-1.json`);
    expect(storage[0].options.responseType).toBe('bytes');
  });

  it.each([
    [
      'run ID',
      (model) => {
        model.runs['103'].id = 999;
      },
    ],
    [
      'run attempt',
      (model) => {
        model.runs['103'].run_attempt = 1;
      },
    ],
    [
      'workflow ID',
      (model) => {
        model.runs['103'].workflow_id = 666;
      },
    ],
    [
      'workflow path',
      (model) => {
        model.runs['103'].path = '.github/workflows/codeql.yml';
      },
    ],
    [
      'source SHA',
      (model) => {
        model.runs['103'].head_sha = 'f'.repeat(40);
      },
    ],
    [
      'repository',
      (model) => {
        model.runs['103'].repository.id = 666;
      },
    ],
    [
      'fork head',
      (model) => {
        model.runs['103'].head_repository.id = 666;
      },
    ],
    [
      'branch',
      (model) => {
        model.runs['103'].head_branch = 'feature';
      },
    ],
    [
      'PR event',
      (model) => {
        model.runs['103'].event = 'pull_request';
      },
    ],
    [
      'queued run',
      (model) => {
        model.runs['103'].status = 'queued';
        model.runs['103'].conclusion = null;
      },
    ],
    [
      'failed run',
      (model) => {
        model.runs['103'].conclusion = 'failure';
      },
    ],
    [
      'cancelled run',
      (model) => {
        model.runs['103'].conclusion = 'cancelled';
      },
    ],
    [
      'skipped run',
      (model) => {
        model.runs['103'].conclusion = 'skipped';
      },
    ],
    [
      'workflow metadata ID',
      (model) => {
        model.workflows['355366692'].id = 666;
      },
    ],
    [
      'workflow metadata path',
      (model) => {
        model.workflows['355366692'].path = 'dynamic/foreign/codeql';
      },
    ],
    [
      'disabled workflow',
      (model) => {
        model.workflows['355366692'].state = 'disabled_manually';
      },
    ],
    [
      'missing JavaScript job',
      (model) => {
        model.jobs['103'].shift();
      },
    ],
    [
      'missing Actions job',
      (model) => {
        model.jobs['103'].pop();
      },
    ],
    [
      'duplicate job',
      (model) => {
        model.jobs['103'].push(clone(model.jobs['103'][0]));
      },
    ],
    [
      'skipped Actions job',
      (model) => {
        model.jobs['103'][1].conclusion = 'skipped';
      },
    ],
    [
      'failed JavaScript job',
      (model) => {
        model.jobs['103'][0].conclusion = 'failure';
      },
    ],
    [
      'in-progress job',
      (model) => {
        model.jobs['103'][1].status = 'in_progress';
        model.jobs['103'][1].conclusion = null;
      },
    ],
    [
      'job run ID',
      (model) => {
        model.jobs['103'][0].run_id = 101;
      },
    ],
    [
      'job attempt',
      (model) => {
        model.jobs['103'][0].run_attempt = 1;
      },
    ],
    [
      'job source',
      (model) => {
        model.jobs['103'][0].head_sha = 'f'.repeat(40);
      },
    ],
  ])(
    'rejects mismatched CodeQL %s even when checks, images and coverage pass',
    async (_name, change) => {
      const fixture = evidenceBackend(change);
      const h = await adapters(fixture.handler);
      const candidate = manifest();
      await denied(async () =>
        validateEvidence(
          candidate,
          await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })),
          policy,
        ),
      );
      expect(
        h.request.calls.some((call) => call.url.pathname.endsWith('/actions/runs/103/attempts/2')),
      ).toBe(true);
    },
  );

  it('rereads CodeQL on the second evidence check and denies newly failed Actions analysis', async () => {
    const fixture = evidenceBackend();
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    const first = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, first, policy)).not.toThrow();
    fixture.model.jobs['103'][1].conclusion = 'failure';
    await denied(async () =>
      validateEvidence(
        candidate,
        await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })),
        policy,
      ),
    );
    for (const path of [
      '/actions/runs/103',
      '/actions/runs/103/attempts/2',
      '/actions/runs/103/attempts/2/jobs',
      '/actions/workflows/355366692',
    ]) {
      expect(h.request.calls.filter((call) => call.url.pathname.endsWith(path))).toHaveLength(2);
    }
  });

  it.each([
    [
      'run ID',
      (run) => {
        run.id = 999;
      },
    ],
    [
      'attempt',
      (run) => {
        run.run_attempt = 3;
      },
    ],
    [
      'workflow ID',
      (run) => {
        run.workflow_id = 666;
      },
    ],
    [
      'native path',
      (run) => {
        run.path = '.github/workflows/codeql.yml';
      },
    ],
    [
      'source',
      (run) => {
        run.head_sha = 'f'.repeat(40);
      },
    ],
    [
      'repository',
      (run) => {
        run.repository.id = 666;
      },
    ],
    [
      'fork head',
      (run) => {
        run.head_repository.id = 666;
      },
    ],
    [
      'branch',
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
      'in-progress rerun',
      (run) => {
        run.status = 'in_progress';
        run.conclusion = null;
      },
    ],
    [
      'failed rerun',
      (run) => {
        run.conclusion = 'failure';
      },
    ],
    [
      'cancelled rerun',
      (run) => {
        run.conclusion = 'cancelled';
      },
    ],
  ])(
    'denies current CodeQL %s even while the historical exact attempt remains successful',
    async (_name, mutate) => {
      const fixture = evidenceBackend((model) => mutate(model.currentRuns['103']));
      expect(fixture.model.runs['103']).toMatchObject({
        run_attempt: 2,
        status: 'completed',
        conclusion: 'success',
      });
      const h = await adapters(fixture.handler);
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
      expect(h.request.calls.some((call) => call.url.pathname.endsWith('/actions/runs/103'))).toBe(
        true,
      );
    },
  );

  it.each(['scaffold', 'images', 'codeql'])(
    'does not hide a newer failed %s attempt behind cached historical success',
    async (kind) => {
      const candidate = manifest();
      const id = candidate.runs[kind].id;
      const fixture = evidenceBackend((model) => {
        model.currentRuns[id].run_attempt = candidate.runs[kind].attempt + 1;
        model.currentRuns[id].conclusion = 'failure';
      });
      const h = await adapters(fixture.handler);
      await denied(() => h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })));
      expect(
        h.request.calls.some((call) => call.url.pathname.endsWith(`/actions/runs/${id}`)),
      ).toBe(true);
    },
  );

  it('rechecks current CodeQL on the pre-traffic collection and rejects a later failed attempt', async () => {
    const fixture = evidenceBackend();
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    const first = await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha }));
    expect(() => validateEvidence(candidate, first, policy)).not.toThrow();
    fixture.model.currentRuns['103'].run_attempt = 3;
    fixture.model.currentRuns['103'].conclusion = 'failure';
    expect(fixture.model.runs['103']).toMatchObject({
      run_attempt: 2,
      status: 'completed',
      conclusion: 'success',
    });
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })));
    expect(
      h.request.calls.filter((call) => call.url.pathname.endsWith('/actions/runs/103')),
    ).toHaveLength(2);
    expect(h.request.calls.every((call) => call.options.method === 'GET')).toBe(true);
  });

  it('does not substitute a successful historical CodeQL attempt after the current-run read fails', async () => {
    const fixture = evidenceBackend();
    const h = await adapters((call) =>
      call.url.pathname.endsWith('/actions/runs/103')
        ? reply({ message: canary }, 404)
        : fixture.handler(call),
    );
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(h.request.calls.some((call) => call.url.pathname.endsWith('/actions/runs/103'))).toBe(
      true,
    );
  });

  it('refuses a manifest without the required CodeQL run instead of fetching an arbitrary latest run', async () => {
    const fixture = evidenceBackend();
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    delete candidate.runs.codeql;
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })));
    expect(h.request.calls).toHaveLength(0);
  });

  it.each(['run', 'workflow', 'jobs'])(
    'denies missing or partial CodeQL %s evidence',
    async (kind) => {
      const fixture = evidenceBackend();
      const h = await adapters((call) => {
        const path = call.url.pathname;
        if (kind === 'run' && path.endsWith('/actions/runs/103/attempts/2'))
          return reply({ message: canary }, 404);
        if (kind === 'workflow' && path.endsWith('/actions/workflows/355366692'))
          return reply({ message: canary }, 404);
        if (kind === 'jobs' && path.endsWith('/actions/runs/103/attempts/2/jobs'))
          return reply({ total_count: 101, jobs: fixture.model.jobs['103'] });
        return fixture.handler(call);
      });
      await denied(() =>
        h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })),
      );
    },
  );

  it.each([
    [
      'repository identity',
      (model) => {
        model.repo.id = 666;
      },
    ],
    [
      'current main',
      (model) => {
        model.main = 'f'.repeat(40);
      },
    ],
    [
      'run source',
      (model) => {
        model.runs['101'].head_sha = 'f'.repeat(40);
      },
    ],
    [
      'run attempt',
      (model) => {
        model.runs['101'].run_attempt = 2;
      },
    ],
    [
      'run ID',
      (model) => {
        model.runs['101'].id = 999;
      },
    ],
    [
      'workflow identity',
      (model) => {
        model.runs['101'].path = '.github/workflows/unapproved.yml';
      },
    ],
    [
      'run repository',
      (model) => {
        model.runs['101'].repository.id = 666;
      },
    ],
    [
      'fork head',
      (model) => {
        model.runs['101'].head_repository.id = 666;
      },
    ],
    [
      'run branch',
      (model) => {
        model.runs['101'].head_branch = 'feature';
      },
    ],
    [
      'PR event',
      (model) => {
        model.runs['101'].event = 'pull_request';
      },
    ],
    [
      'in-progress images',
      (model) => {
        model.runs['102'].status = 'in_progress';
        model.runs['102'].conclusion = null;
      },
    ],
    [
      'cancelled run',
      (model) => {
        model.runs['101'].conclusion = 'cancelled';
      },
    ],
    [
      'missing job',
      (model) => {
        model.jobs['101'] = [];
      },
    ],
    [
      'duplicate job',
      (model) => {
        model.jobs['101'].push(clone(model.jobs['101'][0]));
      },
    ],
    [
      'skipped job',
      (model) => {
        model.jobs['101'][0].conclusion = 'skipped';
      },
    ],
    [
      'selected coverage',
      (model) => {
        model.coverage[0].complete = false;
      },
    ],
    [
      'missing target coverage',
      (model) => {
        model.coverage.pop();
      },
    ],
    [
      'stale coverage source',
      (model) => {
        model.coverage[0].sourceSha = 'f'.repeat(40);
      },
    ],
    [
      'low coverage',
      (model) => {
        model.coverage[0].branches = 84.99;
      },
    ],
    [
      'missing percentage',
      (model) => {
        delete model.coverage[0].lines;
      },
    ],
    [
      'string coverage',
      (model) => {
        model.coverage[0].lines = '100';
      },
    ],
  ])('does not invent successful evidence for %s', async (_label, change) => {
    const fixture = evidenceBackend(change);
    const h = await adapters(fixture.handler);
    const candidate = manifest();
    await denied(async () =>
      validateEvidence(
        candidate,
        await h.value.collectEvidence(argumentsFor({ manifest: candidate, sourceSha })),
        policy,
      ),
    );
  });

  it.each([
    [
      'duplicate coverage keys',
      () => bytes(JSON.stringify(coverage()).replace('{', '{"complete":true,')),
    ],
    ['invalid coverage JSON', () => bytes(`{"data":"${canary}"`)],
    ['oversized coverage', () => bytes(' '.repeat(1048577))],
  ])('rejects %s in the actual downloaded bytes', async (_label, raw) => {
    const fixture = evidenceBackend((model) => {
      model.rawCoverage = raw();
    });
    const h = await adapters(fixture.handler);
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
  });

  it('does not treat a partial job page as complete or follow its foreign pagination URL', async () => {
    const fixture = evidenceBackend();
    const h = await adapters((call) => {
      if (/\/jobs$/.test(call.url.pathname))
        return reply({ total_count: 101, jobs: fixture.model.jobs['101'] }, 200, {
          link: '<https://untrusted.invalid/jobs?page=2>; rel="next"',
        });
      return fixture.handler(call);
    });
    await denied(() => h.value.collectEvidence(argumentsFor({ manifest: manifest(), sourceSha })));
    expect(h.request.calls.every((call) => call.url.hostname !== 'untrusted.invalid')).toBe(true);
    expect(h.request.calls.length).toBeLessThan(100);
  });
});

function cloudRunBackend({ afterPatch, getService, getRevision, getOperation } = {}) {
  const config = configuration();
  const model = Object.fromEntries(
    ['web', 'api'].map((component) => [
      component,
      {
        name: serviceName(config, component),
        etag: `etag-${component}-current`,
        ingress: 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
        invokerIamDisabled: false,
        defaultUriDisabled: true,
        template: {
          serviceAccount: config.runtimeServiceAccounts[component],
          containers: [
            {
              image: `${config.imageRepositories[component]}@sha256:${'0'.repeat(64)}`,
              env: [{ name: 'STARA_ENVIRONMENT', value: 'staging' }],
              resources: { limits: { cpu: '1', memory: '256Mi' } },
            },
          ],
          scaling: { minInstanceCount: 0, maxInstanceCount: 2 },
        },
        traffic: [
          {
            type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
            revision: `${config.services[component]}-old`,
            percent: 100,
          },
        ],
        trafficStatuses: [
          {
            type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
            revision: revisionName(config, component, 'old'),
            percent: 100,
          },
        ],
        latestReadyRevision: revisionName(config, component, 'old'),
        latestCreatedRevision: revisionName(config, component, 'old'),
      },
    ]),
  );
  let latest;
  const handler = async (call) => {
    if (call.url.hostname !== 'run.googleapis.com')
      throw new Error('Unexpected synthetic Cloud Run host');
    const name = decodeURIComponent(call.url.pathname.replace(/^\/v2\//, ''));
    if (/\/operations\//.test(name)) {
      if (getOperation) return getOperation(call, latest);
      return reply({ name: operationName(config), done: true, response: clone(latest) });
    }
    const component = ['web', 'api'].find(
      (part) =>
        name === serviceName(config, part) ||
        name.startsWith(`${serviceName(config, part)}/revisions/`),
    );
    if (!component) throw new Error('Unexpected synthetic Cloud Run resource');
    if (name.includes('/revisions/')) {
      return getRevision
        ? getRevision(call, component)
        : reply({
            name,
            conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }],
            containers: [
              {
                image: `${config.imageRepositories[component]}@${manifest().images[component].digest}`,
              },
            ],
          });
    }
    if (call.options.method === 'GET')
      return getService
        ? getService(call, component, model[component])
        : reply(clone(model[component]));
    if (call.options.method !== 'PATCH') throw new Error('Unexpected synthetic Cloud Run method');
    const input = jsonBody(call.body);
    latest = clone(model[component]);
    if (input.template) {
      latest.template = clone(input.template);
      const revision = input.template.revision ?? `${config.services[component]}-candidate`;
      latest.latestCreatedRevision = revision.startsWith('projects/')
        ? revision
        : `${serviceName(config, component)}/revisions/${revision}`;
    }
    if (input.traffic) latest.traffic = clone(input.traffic);
    const operation = { name: operationName(config), done: false };
    if (afterPatch) return afterPatch(call, component, operation, latest);
    return reply(operation);
  };
  return { handler, model, config };
}

describe('Cloud Run adapters: fixed target, guarded mutations and bounded operation polling', () => {
  it('preserves writable runtime attributes but omits output-only container buildInfo on PATCH', async () => {
    const backend = cloudRunBackend();
    backend.model.web.template.containers[0].buildInfo = {
      functionTarget: 'synthetic',
      sourceLocation: `gs://private-source/${canary}`,
    };
    const h = await adapters(backend.handler);
    await h.value.createRevision(
      argumentsFor({ component: 'web', imageDigest: manifest().images.web.digest }),
    );
    const patch = jsonBody(h.request.calls.find((call) => call.options.method === 'PATCH').body);
    expect(patch.template.containers[0]).not.toHaveProperty('buildInfo');
    expect(patch.template.containers[0].resources).toEqual(
      backend.model.web.template.containers[0].resources,
    );
    expect(JSON.stringify(patch)).not.toContain(canary);
  });
  it.each(['web', 'api'])(
    'creates %s revision with fixed image/account while preserving current traffic and etag',
    async (component) => {
      const backend = cloudRunBackend();
      const h = await adapters(backend.handler);
      const args = argumentsFor({ component, imageDigest: manifest().images[component].digest });
      const result = await h.value.createRevision(args);
      expect(result.revision).toBeTypeOf('string');
      expect(result.revision).toMatch(
        new RegExp(
          `^(?:${serviceName(h.config, component)}/revisions/)?${h.config.services[component]}-[a-z0-9-]+$`,
        ),
      );
      const writes = h.request.calls.filter((call) => call.options.method === 'PATCH');
      expect(writes).toHaveLength(1);
      const patch = jsonBody(writes[0].body);
      expect(writes[0].url.pathname).toBe(`/v2/${serviceName(h.config, component)}`);
      expect(writes[0].url.searchParams.get('allowMissing') ?? 'false').toBe('false');
      expect(writes[0].url.searchParams.get('updateMask')).toContain('template');
      expect(patch.etag).toBe(`etag-${component}-current`);
      expect(patch.template.serviceAccount).toBe(h.config.runtimeServiceAccounts[component]);
      expect(patch.template.containers).toHaveLength(1);
      expect(patch.template.containers[0].image).toBe(
        `${h.config.imageRepositories[component]}@${args.imageDigest}`,
      );
      expect(patch.template.scaling).toEqual({ minInstanceCount: 0, maxInstanceCount: 2 });
      expect(patch.traffic).toEqual(backend.model[component].traffic);
      expect(patch.template.containers[0].env).toContainEqual({
        name: 'STARA_ENVIRONMENT',
        value: 'staging',
      });
      expect(
        h.request.calls.filter((call) => /\/operations\//.test(call.url.pathname)).length,
      ).toBeGreaterThan(0);
    },
  );

  it('pins previously LATEST traffic to observed serving revisions before changing the template', async () => {
    const backend = cloudRunBackend();
    backend.model.web.traffic = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }];
    const h = await adapters(backend.handler);
    await h.value.createRevision(
      argumentsFor({ component: 'web', imageDigest: manifest().images.web.digest }),
    );
    const patch = jsonBody(h.request.calls.find((call) => call.options.method === 'PATCH').body);
    expect(patch.traffic).toHaveLength(1);
    expect(patch.traffic[0].percent).toBe(100);
    expect(patch.traffic[0].type).toBe('TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION');
    expect(patch.traffic[0].revision.split('/').at(-1)).toBe('stara-web-old');
    expect(JSON.stringify(patch.traffic)).not.toContain('LATEST');
  });

  it('does not mutate when existing traffic cannot be resolved safely', async () => {
    const backend = cloudRunBackend();
    backend.model.web.traffic = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }];
    backend.model.web.trafficStatuses = [];
    delete backend.model.web.latestReadyRevision;
    const h = await adapters(backend.handler);
    await denied(
      () =>
        h.value.createRevision(
          argumentsFor({ component: 'web', imageDigest: manifest().images.web.digest }),
        ),
      'NO_EFFECT',
    );
    expect(h.request.calls.filter((call) => call.options.method === 'PATCH')).toEqual([]);
  });

  it('reads both traffic allocations from the configured services', async () => {
    const backend = cloudRunBackend();
    const h = await adapters(backend.handler);
    const result = await h.value.readTraffic(argumentsFor());
    expect(result).toEqual({ web: backend.model.web.traffic, api: backend.model.api.traffic });
    expect(h.request.calls).toHaveLength(2);
    expect(h.request.calls.every((call) => call.options.method === 'GET')).toBe(true);
  });

  it.each(['web', 'api'])(
    'switches %s only to an explicit revision at 100 percent with a fresh etag',
    async (component) => {
      const backend = cloudRunBackend();
      const h = await adapters(backend.handler);
      const revision = revisionName(h.config, component);
      const result = await h.value.switchTraffic(argumentsFor({ component, revision }));
      expect(result.operationId).toBe(operationName(h.config));
      const patchCall = h.request.calls.find((call) => call.options.method === 'PATCH');
      expect(patchCall.url.searchParams.get('updateMask')).toBe('traffic');
      const patch = jsonBody(patchCall.body);
      expect(patch.etag).toBe(`etag-${component}-current`);
      expect(patch).not.toHaveProperty('template');
      expect(patch.traffic).toHaveLength(1);
      expect(patch.traffic[0]).toMatchObject({
        type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',
        percent: 100,
      });
      expect(patch.traffic[0].revision.split('/').at(-1)).toBe(revision.split('/').at(-1));
      expect(JSON.stringify(patch)).not.toContain('LATEST');
    },
  );

  it.each([400, 403, 412])(
    'reports explicit mutation rejection HTTP %s as NO_EFFECT without retry',
    async (status) => {
      const backend = cloudRunBackend({
        afterPatch: () => reply({ error: { message: canary } }, status),
      });
      const h = await adapters(backend.handler);
      await denied(
        () =>
          h.value.switchTraffic(
            argumentsFor({ component: 'web', revision: revisionName(h.config, 'web') }),
          ),
        'NO_EFFECT',
      );
      expect(h.request.calls.filter((call) => call.options.method === 'PATCH')).toHaveLength(1);
    },
  );

  it.each(['timeout', 'server-error', 'foreign-operation', 'operation-error'])(
    'retains unknown mutation outcome for %s without replay',
    async (kind) => {
      const backend = cloudRunBackend({
        afterPatch: (_call, _component, operation) => {
          if (kind === 'timeout') throw new Error(canary);
          if (kind === 'server-error') return reply({ error: { message: canary } }, 503);
          return reply({
            ...operation,
            name:
              kind === 'foreign-operation'
                ? `projects/foreign-target/locations/us-central1/operations/${canary}`
                : operation.name,
          });
        },
        getOperation: () =>
          reply({
            name: operationName(configuration()),
            done: true,
            error: { code: 13, message: canary },
          }),
      });
      const h = await adapters(backend.handler);
      await denied(
        () =>
          h.value.switchTraffic(
            argumentsFor({ component: 'web', revision: revisionName(h.config, 'web') }),
          ),
        'UNKNOWN_OUTCOME',
      );
      expect(h.request.calls.filter((call) => call.options.method === 'PATCH')).toHaveLength(1);
      expect(h.request.calls.every((call) => !call.url.pathname.includes('foreign-target'))).toBe(
        true,
      );
    },
  );

  it.each([
    '../other',
    'projects/foreign-target/locations/us-central1/services/stara-web/revisions/foreign',
    'https://untrusted.invalid/revision',
    'stara-api-candidate',
  ])('rejects foreign or unsafe web revision %s before I/O', async (revision) => {
    const h = await adapters(cloudRunBackend().handler);
    await denied(() => h.value.waitReady(argumentsFor({ component: 'web', revision })));
    await denied(
      () => h.value.switchTraffic(argumentsFor({ component: 'web', revision })),
      'NO_EFFECT',
    );
    expect(h.request).not.toHaveBeenCalled();
  });

  it('requires an explicit succeeded Ready condition from the exact revision', async () => {
    const h = await adapters(cloudRunBackend().handler);
    expect(
      await h.value.waitReady(
        argumentsFor({ component: 'web', revision: revisionName(h.config, 'web') }),
      ),
    ).toEqual({ ready: true });
    expect(h.request.calls).toHaveLength(1);
    expect(h.request.calls[0].url.pathname).toBe(`/v2/${revisionName(h.config, 'web')}`);
  });

  it.each(['missing', 'failed', 'foreign-name'])(
    'does not claim readiness for %s revision evidence',
    async (kind) => {
      const backend = cloudRunBackend({
        getRevision: () =>
          reply({
            name:
              kind === 'foreign-name'
                ? revisionName(configuration(), 'api')
                : revisionName(configuration(), 'web'),
            conditions:
              kind === 'missing'
                ? []
                : [
                    {
                      type: 'Ready',
                      state: kind === 'failed' ? 'CONDITION_FAILED' : 'CONDITION_SUCCEEDED',
                    },
                  ],
          }),
      });
      const h = await adapters(backend.handler);
      await denied(() =>
        h.value.waitReady(
          argumentsFor({
            component: 'web',
            revision: revisionName(h.config, 'web'),
            deadline: start + 1000,
          }),
        ),
      );
    },
  );

  it('bounds in-progress revision polling to the original deadline', async () => {
    const backend = cloudRunBackend({
      getRevision: () =>
        reply({
          name: revisionName(configuration(), 'web'),
          conditions: [{ type: 'Ready', state: 'CONDITION_PENDING' }],
        }),
    });
    const h = await adapters(backend.handler);
    await denied(() =>
      h.value.waitReady(
        argumentsFor({
          component: 'web',
          revision: revisionName(h.config, 'web'),
          deadline: start + 1000,
        }),
      ),
    );
    expect(h.clock.sleep).toHaveBeenCalled();
    expect(h.request.calls.length).toBeLessThan(100);
    expect(h.clock.now()).toBeGreaterThanOrEqual(start + 1000);
  });

  it('does not poll or replay an in-progress mutation after its original deadline', async () => {
    const backend = cloudRunBackend({
      getOperation: () => reply({ name: operationName(configuration()), done: false }),
    });
    const h = await adapters(backend.handler);
    await denied(
      () =>
        h.value.switchTraffic(
          argumentsFor({
            component: 'web',
            revision: revisionName(h.config, 'web'),
            deadline: start + 1000,
          }),
        ),
      'UNKNOWN_OUTCOME',
    );
    expect(h.clock.sleep).toHaveBeenCalled();
    expect(h.request.calls.filter((call) => call.options.method === 'PATCH')).toHaveLength(1);
    expect(h.request.calls.length).toBeLessThan(100);
  });
});

function probeBackend({ replace = {} } = {}) {
  const config = configuration();
  const html =
    '<!doctype html><html><head><title>Stara</title><link rel="stylesheet" href="/assets/app-123.css"></head><body><div id="root"></div><script type="module" src="/assets/app-123.js"></script></body></html>';
  const responses = {
    '/': reply(bytes(html), 200, { 'content-type': 'text/html; charset=utf-8' }),
    '/api/health': reply({ status: 'ok' }, 200, { 'content-type': 'application/json' }),
    '/api/runtime-config': reply({ schemaVersion: 1, environment: 'staging' }, 200, {
      'content-type': 'application/json',
    }),
    '/assets/app-123.js': reply(bytes('export const synthetic = true;'), 200, {
      'content-type': 'text/javascript',
    }),
    '/assets/app-123.css': reply(bytes('body { color: #111; }'), 200, {
      'content-type': 'text/css',
    }),
    ...replace,
  };
  return {
    html,
    handler: (call) => {
      if (call.url.hostname === 'iamcredentials.googleapis.com')
        return reply({ keyId: 'synthetic-key-id', signedJwt: token });
      if (call.url.origin !== config.stagingOrigin)
        throw new Error('Unexpected synthetic probe origin');
      const response = responses[call.url.pathname];
      if (!response) throw new Error('Unexpected synthetic probe route');
      if (call.options.responseType === 'bytes' && !(response.body instanceof Uint8Array))
        return { ...response, body: bytes(response.body) };
      return response;
    },
  };
}

describe('IAP probes: own-account JWT and exact configured-origin application checks', () => {
  it('signs a short-lived wildcard-audience JWT and probes health/config/HTML/JS/CSS with that JWT only', async () => {
    const h = await adapters(probeBackend().handler);
    const args = argumentsFor({ deadline: start + 240_000 });
    expect(await h.value.probe(args)).toEqual({ ok: true });
    const signing = h.request.calls.filter(
      (call) => call.url.hostname === 'iamcredentials.googleapis.com',
    );
    expect(signing).toHaveLength(1);
    expect(signing[0].options.method).toBe('POST');
    expect(decodeURIComponent(signing[0].url.pathname)).toBe(
      `/v1/projects/-/serviceAccounts/${h.config.executorServiceAccount}:signJwt`,
    );
    const requestBody = jsonBody(signing[0].body);
    expect(Object.keys(requestBody)).toEqual(['payload']);
    const payload = JSON.parse(requestBody.payload);
    expect(payload).toMatchObject({
      iss: h.config.executorServiceAccount,
      sub: h.config.executorServiceAccount,
      aud: `${h.config.stagingOrigin}/*`,
      iat: Math.floor(start / 1000),
    });
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp).toBeLessThanOrEqual(payload.iat + 300);
    expect(payload.exp).toBeLessThanOrEqual(Math.floor(args.deadline / 1000));
    const probes = h.request.calls.filter((call) => call.url.origin === h.config.stagingOrigin);
    expect(probes.map((call) => call.url.pathname).sort()).toEqual(
      [
        '/',
        '/api/health',
        '/api/runtime-config',
        '/assets/app-123.css',
        '/assets/app-123.js',
      ].sort(),
    );
    for (const call of probes) {
      expect(call.options.method).toBe('GET');
      expect(header(call.options.headers, 'authorization')).toBe(`Bearer ${token}`);
      expect(call.options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(header(signing[0].options.headers, 'authorization')).not.toBe(`Bearer ${token}`);
  });

  it.each([
    [
      'health response',
      '/api/health',
      reply({ status: 'ok', private: canary }, 200, { 'content-type': 'application/json' }),
    ],
    [
      'health status',
      '/api/health',
      reply({ status: 'ok' }, 503, { 'content-type': 'application/json' }),
    ],
    [
      'development runtime',
      '/api/runtime-config',
      reply({ schemaVersion: 1, environment: 'development' }, 200, {
        'content-type': 'application/json',
      }),
    ],
    [
      'unknown runtime field',
      '/api/runtime-config',
      reply({ schemaVersion: 1, environment: 'staging', private: canary }, 200, {
        'content-type': 'application/json',
      }),
    ],
    [
      'login HTML',
      '/',
      reply(bytes('<html><body>Login</body></html>'), 200, { 'content-type': 'text/html' }),
    ],
    [
      'HTML as script',
      '/assets/app-123.js',
      reply(bytes('<html>Denied</html>'), 200, { 'content-type': 'text/html' }),
    ],
    [
      'empty script',
      '/assets/app-123.js',
      reply(bytes(''), 200, { 'content-type': 'text/javascript' }),
    ],
    ['asset denied', '/assets/app-123.js', reply(bytes(canary), 403)],
    ['stylesheet missing', '/assets/app-123.css', reply(bytes(canary), 404)],
    [
      'stylesheet wrong content type',
      '/assets/app-123.css',
      reply(bytes('<html>Denied</html>'), 200, { 'content-type': 'text/html' }),
    ],
    [
      'redirect',
      '/api/health',
      reply(bytes(canary), 302, { location: 'https://untrusted.invalid/login' }),
    ],
  ])('does not report a successful probe for %s', async (_label, path, response) => {
    const h = await adapters(probeBackend({ replace: { [path]: response } }).handler);
    await denied(() => h.value.probe(argumentsFor()));
    expect(h.request.calls.filter((call) => call.url.pathname === path)).toHaveLength(1);
  });

  it.each([
    'https://untrusted.invalid/app.js',
    '//untrusted.invalid/app.js',
    'http://staging.app.stara.co/app.js',
    'data:text/javascript,alert(1)',
  ])('does not send a JWT to foreign/unsafe module asset %s', async (asset) => {
    const html = `<!doctype html><html><body><div id="root"></div><script type="module" src="${asset}"></script></body></html>`;
    const h = await adapters(
      probeBackend({ replace: { '/': reply(bytes(html), 200, { 'content-type': 'text/html' }) } })
        .handler,
    );
    await denied(() => h.value.probe(argumentsFor()));
    expect(
      h.request.calls
        .filter((call) => call.url.hostname !== 'iamcredentials.googleapis.com')
        .every((call) => call.url.origin === h.config.stagingOrigin),
    ).toBe(true);
  });

  it.each([403, 503])(
    'does not probe application content after JWT signing HTTP %s failure',
    async (status) => {
      const h = await adapters(() => reply({ error: { message: `${token} ${canary}` } }, status));
      await denied(() => h.value.probe(argumentsFor()));
      expect(h.request.calls).toHaveLength(1);
      expect(h.request.calls[0].url.hostname).toBe('iamcredentials.googleapis.com');
    },
  );

  it('denies a missing signedJwt instead of sending a fabricated Authorization header', async () => {
    const h = await adapters(() => reply({ keyId: 'synthetic-key-id' }));
    await denied(() => h.value.probe(argumentsFor()));
    expect(h.request.calls).toHaveLength(1);
  });
});

describe('terminal notification: private structured log submission, no incident-delivery fiction', () => {
  it.each(['succeeded', 'failed', 'degraded', 'reconciliation_required'])(
    'submits only allowlisted %s receipt/source data to delivery logging',
    async (status) => {
      const h = await adapters(() => reply({}));
      const args = argumentsFor({
        status,
        diagnostics: canary,
        bearerToken: token,
        correctiveAction: 'reviewed_forward_fix',
      });
      const result = await h.value.notify(args);
      expect(h.request.calls).toHaveLength(1);
      const call = h.request.calls[0];
      expect(call.url.href).toBe('https://logging.googleapis.com/v2/entries:write');
      expect(call.options.method).toBe('POST');
      const input = jsonBody(call.body);
      expect(input.entries).toHaveLength(1);
      const entry = input.entries[0];
      expect(entry.jsonPayload).toEqual({
        event: 'release_terminal',
        status,
        receiptId,
        sourceSha,
      });
      expect(entry.insertId).toBeTypeOf('string');
      expect(entry.insertId.length).toBeGreaterThan(0);
      expect(entry.logName ?? input.logName).toMatch(
        new RegExp(`^projects/${h.config.loggingProjectId}/logs/[^/]+$`),
      );
      expect(JSON.stringify(input)).not.toContain(canary);
      expect(JSON.stringify(input)).not.toContain(token);
      expect(JSON.stringify(result) ?? '').not.toMatch(
        /incidentCreated|emailDelivered|issueCreated|github\.com\/.*\/issues/,
      );
    },
  );

  it('reuses the notification insertId for the same receipt/status and distinguishes changed receipts', async () => {
    const h = await adapters(() => reply({}));
    await h.value.notify(argumentsFor({ status: 'failed' }));
    await h.value.notify(argumentsFor({ status: 'failed' }));
    await h.value.notify(argumentsFor({ status: 'failed', receiptId: 'b'.repeat(64) }));
    const identities = h.request.calls.map((call) => jsonBody(call.body).entries[0].insertId);
    expect(identities[0]).toBe(identities[1]);
    expect(identities[2]).not.toBe(identities[0]);
  });

  it.each(['running', 'unknown', '', undefined])(
    'denies nonterminal/missing notification status %s before I/O',
    async (status) => {
      const h = await adapters(() => reply({}));
      await denied(() => h.value.notify(argumentsFor({ status })), 'NO_EFFECT');
      expect(h.request).not.toHaveBeenCalled();
    },
  );

  it.each([400, 403])(
    'reports explicit log write rejection HTTP %s as NO_EFFECT',
    async (status) => {
      const h = await adapters(() => reply({ error: { message: canary } }, status));
      await denied(() => h.value.notify(argumentsFor({ status: 'failed' })), 'NO_EFFECT');
      expect(h.request.calls).toHaveLength(1);
    },
  );

  it.each(['timeout', '503'])(
    'does not retry or claim incident creation after ambiguous log write %s',
    async (kind) => {
      const h = await adapters(() => {
        if (kind === 'timeout') throw new Error(`${canary} ${token}`);
        return reply({ error: { message: canary } }, 503);
      });
      await denied(() => h.value.notify(argumentsFor({ status: 'degraded' })), 'UNKNOWN_OUTCOME');
      expect(h.request.calls).toHaveLength(1);
    },
  );
});

const operationArguments = {
  loadManifest: () => ({ manifestSha256: hash(bytes(manifest())), maxBytes: 65536 }),
  collectEvidence: () => ({ manifest: manifest(), sourceSha }),
  verifyProvenance: () => ({ component: 'web', manifest: manifest() }),
  createRevision: () => ({ component: 'web', imageDigest: manifest().images.web.digest }),
  waitReady: () => ({ component: 'web', revision: revisionName(configuration(), 'web') }),
  readTraffic: () => ({}),
  switchTraffic: () => ({ component: 'web', revision: revisionName(configuration(), 'web') }),
  probe: () => ({}),
  notify: () => ({ status: 'failed', sourceSha }),
};

describe('adapter authority and deadlines: reject before issuing an HTTP request', () => {
  for (const [name, extra] of Object.entries(operationArguments)) {
    it(`${name} rejects a different target before I/O`, async () => {
      const h = await adapters(() => reply({}));
      await denied(() => h.value[name](argumentsFor({ ...extra(), targetId: 'another-target' })));
      expect(h.request).not.toHaveBeenCalled();
    });

    it(`${name} rejects an expired deadline before I/O`, async () => {
      const h = await adapters(() => reply({}));
      await denied(() => h.value[name](argumentsFor({ ...extra(), deadline: start })));
      expect(h.request).not.toHaveBeenCalled();
    });

    it(`${name} respects an already aborted signal before I/O`, async () => {
      const h = await adapters(() => reply({}));
      const controller = new AbortController();
      controller.abort();
      await denied(() => h.value[name](argumentsFor({ ...extra(), signal: controller.signal })));
      expect(h.request).not.toHaveBeenCalled();
    });
  }

  it.each([
    'latest',
    'sha256:short',
    `sha256:${'A'.repeat(64)}`,
    'https://untrusted.invalid/image',
  ])('rejects unsafe revision image digest %s before I/O', async (imageDigest) => {
    const h = await adapters(cloudRunBackend().handler);
    await denied(
      () => h.value.createRevision(argumentsFor({ component: 'web', imageDigest })),
      'NO_EFFECT',
    );
    expect(h.request).not.toHaveBeenCalled();
  });

  it('does not let later mutation of input configuration change artifact authority', async () => {
    const config = configuration();
    const raw = bytes(manifest());
    const h = await adapters(() => reply(raw), { configuration: config });
    config.artifactBucket = 'different-private-bucket';
    config.services.web = 'another-service';
    config.policy.repositoryId = '666';
    await h.value.loadManifest(argumentsFor({ manifestSha256: hash(raw), maxBytes: 65536 }));
    expect(h.request.calls[0].url.pathname).toContain(`/b/${configuration().artifactBucket}/o/`);
  });

  it('factories reject an unvalidated production configuration without network access', async () => {
    const api = await implementation();
    const request = transport(() => reply({}));
    const config = { ...configuration(), environment: 'production' };
    await denied(() => api.createCloudStore({ configuration: config, request }));
    await denied(() =>
      api.createCloudAdapters({
        configuration: config,
        request,
        clock: controlledClock(),
        verifyAttestation: vi.fn(),
      }),
    );
    expect(request).not.toHaveBeenCalled();
  });
});
