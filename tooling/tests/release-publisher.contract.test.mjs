import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDispatch } from '../release/contract.mjs';

let publisher;
beforeEach(async () => {
  const url = new URL('../release/publisher.mjs', import.meta.url);
  try {
    await access(url);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      'Missing implementation: tooling/release/publisher.mjs; behavior not executed',
      { cause: error },
    );
  }
  publisher ??= await import(/* @vite-ignore */ url.href);
  expect(publisher.createArtifactPublisher).toBeTypeOf('function');
  expect(publisher.createStagingDispatcher).toBeTypeOf('function');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const sha = '1'.repeat(40);
const digest = `sha256:${'2'.repeat(64)}`;
const repositoryId = '1363262992';
const workflowRef = 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main';
const dispatchWorkflow = 'stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main';
const imageRepository = 'us-central1-docker.pkg.dev/synthetic-private-delivery/app';
const bucket = 'synthetic-private-release-artifacts';
const topic = 'projects/synthetic-private-delivery/topics/staging-candidates';
const canary = 'synthetic-publisher-private-canary';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const bytes = (value) => Buffer.from(JSON.stringify(value));
const clone = (value) => structuredClone(value);
const minute = 60_000;

function environment(kind = 'publisher') {
  return {
    GITHUB_EVENT_NAME: kind === 'publisher' ? 'push' : 'workflow_run',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_REPOSITORY: 'stara-labs/stara',
    GITHUB_REPOSITORY_ID: repositoryId,
    GITHUB_REPOSITORY_OWNER_ID: '293455507',
    GITHUB_WORKFLOW_REF: kind === 'publisher' ? workflowRef : dispatchWorkflow,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '103',
    GITHUB_RUN_ATTEMPT: '2',
    GH_TOKEN: 'synthetic-gh-token',
    STARA_IMAGE_REPOSITORY: imageRepository,
    STARA_ARTIFACT_BUCKET: bucket,
    STARA_STAGING_TOPIC: topic,
    UNRELATED_PRIVATE: canary,
  };
}
function clock() {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    sleep: vi.fn(async (ms) => {
      offset += ms;
    }),
    advance: (ms) => {
      offset += ms;
    },
  };
}
function signedBundle(component = 'web') {
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: 'c3ludGhldGljLW5vdC1hLWNlcnRpZmljYXRl' },
      tlogEntries: [{ logIndex: '1' }],
    },
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: bytes({
        _type: 'https://in-toto.io/Statement/v1',
        subject: [{ name: `stara/${component}`, digest: { sha256: digest.slice(7) } }],
        predicateType: 'https://slsa.dev/provenance/v1',
        predicate: { synthetic: true },
      }).toString('base64'),
      signatures: [{ sig: 'c3ludGhldGljLW5vdC1hLXNpZ25hdHVyZQ==' }],
    },
  };
}
function coverage() {
  return ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'].map((target) => ({
    target,
    sourceSha: sha,
    complete: true,
    lines: 90,
    branches: 85,
  }));
}
function manifest() {
  return {
    schemaVersion: 1,
    sourceSha: sha,
    repositoryId,
    images: {
      web: { digest, attestationSha256: '3'.repeat(64) },
      api: { digest: `sha256:${'4'.repeat(64)}`, attestationSha256: '5'.repeat(64) },
    },
    runs: {
      scaffold: { id: '101', attempt: 1 },
      images: { id: '103', attempt: 2 },
      codeql: { id: '102', attempt: 1 },
    },
  };
}
function object(kind = 'attestations') {
  const raw = bytes(
    kind === 'attestations' ? signedBundle() : kind === 'manifests' ? manifest() : coverage(),
  );
  return {
    key:
      kind === 'coverage'
        ? `coverage/${sha}/101-1.json`
        : `${kind}/${hash(raw)}.${kind === 'attestations' ? 'jsonl' : 'json'}`,
    bytes: raw,
    ifAbsent: true,
  };
}
function dispatch() {
  return {
    schemaVersion: 1,
    sourceSha: sha,
    manifestSha256: '6'.repeat(64),
    configurationSha256: '7'.repeat(64),
  };
}
function harness(kind = 'publisher', options = {}) {
  const env = { ...environment(kind), ...options.env };
  const time = clock();
  const calls = [];
  const request = vi.fn(async (input) => {
    calls.push(input);
    if (options.request) return options.request(input);
    if (kind === 'dispatcher') return { status: 200, data: { messageIds: ['synthetic-message'] } };
    const url = new URL(input.url);
    return { status: 200, data: { name: url.searchParams.get('name'), bucket, generation: '123' } };
  });
  const attest = vi.fn(async (input) => {
    if (options.attest) return options.attest(input);
    return {
      bundle: signedBundle(input.subjects[0].name.split('/')[1]),
      certificate: 'synthetic-not-a-real-certificate',
    };
  });
  const verifyBundle = vi.fn(async (input) => {
    if (options.verifyBundle) return options.verifyBundle(input);
    return {
      verified: true,
      sourceSha: sha,
      repositoryId,
      workflowRef,
      imageDigest: digest,
      attestationSha256: hash(input.bundle),
      runId: '103',
      runAttempt: 2,
    };
  });
  const args =
    kind === 'publisher'
      ? { env, request, attest, verifyBundle, clock: time }
      : { env, request, clock: time };
  const create = () =>
    kind === 'publisher'
      ? publisher.createArtifactPublisher(args)
      : publisher.createStagingDispatcher(args);
  return { env, clock: time, request, attest, verifyBundle, calls, args, create };
}
function attestInput(component = 'web') {
  return {
    component,
    subjectName: `${imageRepository}/${component}`,
    subjectDigest: digest,
    sourceSha: sha,
    runId: '103',
    runAttempt: 2,
    runtime: { untrusted: canary },
  };
}
async function denies(work) {
  let error;
  try {
    await work();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toBe('');
  expect(error.message).not.toContain(canary);
  expect(error.stack).not.toContain(canary);
  expect(error.cause).toBeUndefined();
  expect(JSON.stringify(error)).not.toContain(canary);
}
function boundedRequest(input) {
  expect(input.method).toBe('POST');
  expect(input.retry).toBe(false);
  expect(input.signal).toBeInstanceOf(AbortSignal);
  expect(input.timeout).toBeGreaterThan(0);
  expect(input.timeout).toBeLessThanOrEqual(30_000);
  expect(input.maxContentLength).toBeGreaterThan(0);
  expect(input.maxContentLength).toBeLessThanOrEqual(1024 * 1024);
}

describe('REL-02/04 publisher and dispatcher role separation', () => {
  it('returns only the target-neutral artifact facade and separately only a dispatcher function', () => {
    const p = harness();
    delete p.env.STARA_STAGING_TOPIC;
    const facade = p.create();
    expect(Object.keys(facade).sort()).toEqual(['registry', 'storage']);
    expect(Object.keys(facade.registry).sort()).toEqual(['api', 'attest', 'web']);
    expect(Object.keys(facade.storage)).toEqual(['put']);
    expect(facade.registry.web).toBe(`${imageRepository}/web`);
    expect(facade.registry.api).toBe(`${imageRepository}/api`);
    const d = harness('dispatcher');
    delete d.env.STARA_IMAGE_REPOSITORY;
    delete d.env.STARA_ARTIFACT_BUCKET;
    delete d.env.GH_TOKEN;
    const publish = d.create();
    expect(publish).toBeTypeOf('function');
    expect(publish).not.toHaveProperty('storage');
    expect(publish).not.toHaveProperty('registry');
    expect(p.request).not.toHaveBeenCalled();
    expect(d.request).not.toHaveBeenCalled();
  });

  for (const kind of ['publisher', 'dispatcher']) {
    it.each([
      'GITHUB_EVENT_NAME',
      'GITHUB_REF',
      'GITHUB_REPOSITORY',
      'GITHUB_REPOSITORY_ID',
      'GITHUB_REPOSITORY_OWNER_ID',
      'GITHUB_WORKFLOW_REF',
    ])(`${kind} denies substituted %s before returning authority`, async (field) => {
      const f = harness(kind, { env: { [field]: canary } });
      await denies(() => f.create());
      expect(f.request).not.toHaveBeenCalled();
      expect(f.attest).not.toHaveBeenCalled();
    });
  }
  it.each([
    'GITHUB_SHA',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_ATTEMPT',
    'GH_TOKEN',
    'STARA_IMAGE_REPOSITORY',
    'STARA_ARTIFACT_BUCKET',
  ])('publisher denies missing %s at construction', async (field) => {
    const f = harness();
    delete f.env[field];
    await denies(() => f.create());
    expect(f.request).not.toHaveBeenCalled();
    expect(f.attest).not.toHaveBeenCalled();
  });
  it.each([
    ['STARA_IMAGE_REPOSITORY', `${imageRepository}/other`],
    ['STARA_IMAGE_REPOSITORY', `${imageRepository}:mutable`],
    ['STARA_IMAGE_REPOSITORY', 'https://synthetic-attacker.example/app'],
    ['STARA_IMAGE_REPOSITORY', 'us-east1-docker.pkg.dev/synthetic-private-delivery/app'],
    ['STARA_ARTIFACT_BUCKET', `${bucket}/outside`],
    ['STARA_ARTIFACT_BUCKET', 'https://synthetic-attacker.example'],
  ])('denies malformed configured target %#', async (field, value) => {
    const f = harness('publisher', { env: { [field]: value } });
    await denies(() => f.create());
    expect(f.calls).toEqual([]);
  });
});

describe('REL-03/10 original SDK bundle and canonical public subject', () => {
  it('denies provenance without certified image-run identity even when source and digest match', async () => {
    const f = harness('publisher', {
      verifyBundle: async (input) => ({
        verified: true,
        sourceSha: sha,
        repositoryId,
        workflowRef,
        imageDigest: digest,
        attestationSha256: hash(input.bundle),
      }),
    });
    await denies(() => f.create().registry.attest(attestInput()));
    expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['web', 'api'])(
    'signs %s canonical public subject, verifies exact original bytes with private lookup only',
    async (component) => {
      const f = harness();
      const result = await f.create().registry.attest(attestInput(component));
      expect(f.attest).toHaveBeenCalledExactlyOnceWith({
        subjects: [{ name: `stara/${component}`, digest: { sha256: digest.slice(7) } }],
        token: f.env.GH_TOKEN,
        sigstore: 'public-good',
      });
      expect(JSON.stringify(f.attest.mock.calls[0][0].subjects)).not.toContain('synthetic-private');
      expect(JSON.stringify(f.attest.mock.calls[0][0])).not.toContain(canary);
      expect(result.bundle).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(result.bundle)).toEqual(bytes(signedBundle(component)));
      expect(Object.keys(result).sort()).toEqual(['bundle', 'verification']);
      expect(f.verifyBundle).toHaveBeenCalledOnce();
      const input = f.verifyBundle.mock.calls[0][0];
      expect(Object.keys(input).sort()).toEqual([
        'bundle',
        'component',
        'deadline',
        'imageDigest',
        'imageRepository',
        'repositoryId',
        'runAttempt',
        'runId',
        'signal',
        'sourceSha',
        'subjectName',
        'workflowRef',
      ]);
      expect(input).toMatchObject({
        component,
        subjectName: `stara/${component}`,
        imageRepository: `${imageRepository}/${component}`,
        imageDigest: digest,
        sourceSha: sha,
        repositoryId,
        workflowRef,
        runId: '103',
        runAttempt: 2,
      });
      expect(Buffer.from(input.bundle)).toEqual(Buffer.from(result.bundle));
      expect(input.signal).toBeInstanceOf(AbortSignal);
      expect(input.deadline).toBeLessThanOrEqual(f.clock.now() + 10 * minute);
      expect(result.verification.attestationSha256).toBe(hash(result.bundle));
      expect(result.verification).toMatchObject({ runId: '103', runAttempt: 2 });
      expect(f.request).not.toHaveBeenCalled();
    },
  );

  it.each(['component', 'subjectName', 'subjectDigest', 'sourceSha', 'runId', 'runAttempt'])(
    'rejects substituted attestation %s before signing',
    async (field) => {
      const f = harness();
      const input = attestInput();
      input[field] = field === 'runAttempt' ? 3 : canary;
      await denies(() => f.create().registry.attest(input));
      expect(f.attest).not.toHaveBeenCalled();
      expect(f.verifyBundle).not.toHaveBeenCalled();
      expect(f.calls).toEqual([]);
    },
  );

  it.each([
    undefined,
    {},
    { bundle: null },
    { bundle: {} },
    { bundle: { oversized: 'x'.repeat(1024 * 1024 + 1) } },
  ])('denies missing or oversized SDK proof case %#', async (result) => {
    const f = harness('publisher', { attest: async () => result });
    await denies(() => f.create().registry.attest(attestInput()));
    expect(f.verifyBundle).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
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
    'extra',
  ])('denies mismatched or unknown verification fact %s', async (field) => {
    const f = harness('publisher', {
      verifyBundle: async (input) => {
        const facts = {
          verified: true,
          sourceSha: sha,
          repositoryId,
          workflowRef,
          imageDigest: digest,
          attestationSha256: hash(input.bundle),
          runId: '103',
          runAttempt: 2,
        };
        facts[field] = field === 'verified' ? false : canary;
        return facts;
      },
    });
    await denies(() => f.create().registry.attest(attestInput()));
    expect(f.attest).toHaveBeenCalledOnce();
    expect(f.request).not.toHaveBeenCalled();
  });

  it.each(['attest', 'verifyBundle'])(
    'sanitizes %s failures without retry or logging private diagnostics',
    async (operation) => {
      const logs = ['log', 'warn', 'error'].map((name) =>
        vi.spyOn(console, name).mockImplementation(() => {}),
      );
      const f = harness('publisher', {
        [operation]: async () => {
          throw new Error(canary);
        },
      });
      await denies(() => f.create().registry.attest(attestInput()));
      expect(f[operation]).toHaveBeenCalledOnce();
      for (const log of logs) expect(JSON.stringify(log.mock.calls)).not.toContain(canary);
    },
  );
});

describe('REL-03/04/10/11 immutable fixed-bucket uploads', () => {
  it.each(['attestations', 'coverage', 'manifests'])(
    'uploads only original %s bytes under an immutable precondition',
    async (kind) => {
      const f = harness();
      const input = object(kind);
      const result = await f.create().storage.put(input);
      expect(result).toEqual({ created: true });
      expect(f.request).toHaveBeenCalledOnce();
      const call = f.calls[0];
      const url = new URL(call.url);
      boundedRequest(call);
      expect(url.origin).toBe('https://storage.googleapis.com');
      expect(url.pathname).toBe(`/upload/storage/v1/b/${bucket}/o`);
      expect([...url.searchParams.keys()].sort()).toEqual([
        'ifGenerationMatch',
        'name',
        'uploadType',
      ]);
      expect(url.searchParams.get('uploadType')).toBe('media');
      expect(url.searchParams.get('ifGenerationMatch')).toBe('0');
      expect(url.searchParams.get('name')).toBe(input.key);
      expect(Buffer.from(call.data)).toEqual(input.bytes);
      expect(f.attest).not.toHaveBeenCalled();
      expect(f.verifyBundle).not.toHaveBeenCalled();
    },
  );

  it.each([
    '../manifests/x.json',
    'targets/staging.json',
    'receipts/staging.json',
    'raw/browser.json',
    'terraform.tfstate',
    'credentials.json',
    'https://synthetic-attacker.example/object',
    'attestations/%2e%2e/secret.jsonl',
    'manifests/x.json',
    `coverage/${sha}/0-1.json`,
    `coverage/${sha}/101-01.json`,
  ])('denies unapproved object key %s before a request', async (key) => {
    const f = harness();
    await denies(() => f.create().storage.put({ ...object(), key }));
    expect(f.calls).toEqual([]);
  });
  it.each(['overwrite', 'changed-hash', 'oversized', 'not-bytes', 'extra-authority'])(
    'rejects %s upload input before mutation',
    async (scenario) => {
      const f = harness();
      const input = object();
      if (scenario === 'overwrite') input.ifAbsent = false;
      if (scenario === 'changed-hash') input.bytes = bytes({ changed: true });
      if (scenario === 'oversized') input.bytes = Buffer.alloc(1024 * 1024 + 1);
      if (scenario === 'not-bytes') input.bytes = input.bytes.toString();
      if (scenario === 'extra-authority') input.bucket = 'synthetic-other-bucket';
      await denies(() => f.create().storage.put(input));
      expect(f.calls).toEqual([]);
    },
  );

  it.each(['source', 'repository', 'extra'])(
    'denies correctly hashed manifest with wrong %s authority',
    async (field) => {
      const f = harness();
      const value = manifest();
      if (field === 'source') value.sourceSha = 'a'.repeat(40);
      if (field === 'repository') value.repositoryId = '999';
      if (field === 'extra') value.configuration = canary;
      const raw = bytes(value);
      await denies(() =>
        f.create().storage.put({ key: `manifests/${hash(raw)}.json`, bytes: raw, ifAbsent: true }),
      );
      expect(f.calls).toEqual([]);
    },
  );

  it.each([
    'missing-target',
    'duplicate-target',
    'selected',
    'wrong-source',
    'low-lines',
    'low-branches',
  ])('rejects %s coverage without uploading', async (scenario) => {
    const f = harness();
    const value = coverage();
    if (scenario === 'missing-target') value.pop();
    if (scenario === 'duplicate-target') value[1] = clone(value[0]);
    if (scenario === 'selected') value[0].complete = false;
    if (scenario === 'wrong-source') value[0].sourceSha = 'a'.repeat(40);
    if (scenario === 'low-lines') value[0].lines = 89.99;
    if (scenario === 'low-branches') value[0].branches = 84.99;
    await denies(() => f.create().storage.put({ ...object('coverage'), bytes: bytes(value) }));
    expect(f.calls).toEqual([]);
  });

  it.each([201, 204, 301, 400, 401, 403, 409, 412, 429, 500])(
    'treats HTTP %s as denied or unknown, never created and never retried',
    async (status) => {
      const f = harness('publisher', {
        request: async () => ({ status, data: { detail: canary } }),
      });
      await denies(() => f.create().storage.put(object()));
      expect(f.request).toHaveBeenCalledOnce();
    },
  );
  it.each(['empty', 'wrong-name', 'wrong-bucket', 'missing-generation', 'zero-generation'])(
    'denies status200 with %s receipt',
    async (scenario) => {
      const f = harness('publisher', {
        request: async (input) => {
          const data = {
            name: new URL(input.url).searchParams.get('name'),
            bucket,
            generation: '123',
          };
          if (scenario === 'empty') return { status: 200, data: {} };
          if (scenario === 'wrong-name') data.name = canary;
          if (scenario === 'wrong-bucket') data.bucket = canary;
          if (scenario === 'missing-generation') delete data.generation;
          if (scenario === 'zero-generation') data.generation = '0';
          return { status: 200, data };
        },
      });
      await denies(() => f.create().storage.put(object()));
      expect(f.request).toHaveBeenCalledOnce();
    },
  );
  it('does not retry an uncertain write or infer a prior immutable object exists', async () => {
    const f = harness('publisher', {
      request: async () => {
        throw new Error(canary);
      },
    });
    await denies(() => f.create().storage.put(object('coverage')));
    expect(f.request).toHaveBeenCalledOnce();
  });
});

describe('REL-02/04/10/11 fixed staging PubSub dispatch', () => {
  it('publishes exactly one intentionally double-encoded strict signal and no provider authority', async () => {
    const f = harness('dispatcher');
    const data = bytes(dispatch()).toString('base64');
    expect(await f.create()({ topic, data })).toEqual({ messageIds: ['synthetic-message'] });
    expect(f.request).toHaveBeenCalledOnce();
    const call = f.calls[0];
    boundedRequest(call);
    expect(call.url).toBe(`https://pubsub.googleapis.com/v1/${topic}:publish`);
    expect(Object.keys(call.data)).toEqual(['messages']);
    expect(call.data.messages).toHaveLength(1);
    expect(Object.keys(call.data.messages[0])).toEqual(['data']);
    const envelope = JSON.parse(Buffer.from(call.data.messages[0].data, 'base64').toString('utf8'));
    expect(envelope).toEqual({ payload: data });
    expect(parseDispatch(Buffer.from(envelope.payload, 'base64'))).toEqual(dispatch());
    expect(JSON.stringify(call.data)).not.toContain(canary);
  });

  it.each([
    undefined,
    'https://synthetic-attacker.example/topic',
    'projects/x/topics/a/extra',
    'projects/x/topics/a?override=true',
  ])('denies malformed configured topic case %#', async (value) => {
    const f = harness('dispatcher', { env: { STARA_STAGING_TOPIC: value } });
    await denies(() => f.create());
    expect(f.calls).toEqual([]);
  });

  it.each([
    'wrong-topic',
    'unknown-option',
    'missing-config-hash',
    'extra-dispatch',
    'duplicate-key',
    'noncanonical-base64',
    'invalid-utf8',
    'oversized',
  ])('denies %s before PubSub', async (scenario) => {
    const f = harness('dispatcher');
    const input = { topic, data: bytes(dispatch()).toString('base64') };
    if (scenario === 'wrong-topic') input.topic = 'projects/synthetic-other/topics/other';
    if (scenario === 'unknown-option') input.url = 'https://synthetic-attacker.example';
    if (scenario === 'missing-config-hash') {
      const value = dispatch();
      delete value.configurationSha256;
      input.data = bytes(value).toString('base64');
    }
    if (scenario === 'extra-dispatch')
      input.data = bytes({ ...dispatch(), approval: canary }).toString('base64');
    if (scenario === 'duplicate-key')
      input.data = Buffer.from(
        `{"schemaVersion":1,${JSON.stringify(dispatch()).slice(1)}`,
      ).toString('base64');
    if (scenario === 'noncanonical-base64') input.data += '\n';
    if (scenario === 'invalid-utf8') input.data = Buffer.from([0xff, 0xfe]).toString('base64');
    if (scenario === 'oversized') input.data = Buffer.alloc(4097, 32).toString('base64');
    await denies(() => f.create()(input));
    expect(f.calls).toEqual([]);
  });

  it.each([
    { status: 200, data: {} },
    { status: 200, data: { messageIds: [] } },
    { status: 200, data: { messageIds: [''] } },
    { status: 200, data: { messageIds: ['a', 'b'] } },
    { status: 500, data: { detail: canary } },
    { status: 429, data: {} },
  ])('denies failed or empty PubSub response case %# without retry', async (result) => {
    const f = harness('dispatcher', { request: async () => result });
    await denies(() => f.create()({ topic, data: bytes(dispatch()).toString('base64') }));
    expect(f.request).toHaveBeenCalledOnce();
  });
  it('does not retry an unknown publish', async () => {
    const f = harness('dispatcher', {
      request: async () => {
        throw new Error(canary);
      },
    });
    await denies(() => f.create()({ topic, data: bytes(dispatch()).toString('base64') }));
    expect(f.request).toHaveBeenCalledOnce();
  });
});

describe('REL-11 fixed factory and operation deadlines', () => {
  it.each(['publisher', 'dispatcher'])(
    '%s cannot reset its fifteen-minute lifetime between calls',
    async (kind) => {
      const f = harness(kind);
      const facade = f.create();
      f.clock.advance(16 * minute);
      await denies(() =>
        kind === 'publisher'
          ? facade.storage.put(object())
          : facade({ topic, data: bytes(dispatch()).toString('base64') }),
      );
      expect(f.request).not.toHaveBeenCalled();
      expect(f.attest).not.toHaveBeenCalled();
    },
  );
  it.each(['publisher', 'dispatcher'])(
    'settles a hung %s Google request at thirty seconds without retry',
    async (kind) => {
      vi.useFakeTimers();
      const f = harness(kind, { request: () => new Promise(() => {}) });
      const facade = f.create();
      const pending = denies(() =>
        kind === 'publisher'
          ? facade.storage.put(object())
          : facade({ topic, data: bytes(dispatch()).toString('base64') }),
      );
      await vi.advanceTimersByTimeAsync(30_001);
      await pending;
      expect(f.request).toHaveBeenCalledOnce();
      expect(f.calls[0].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(['attest', 'verifyBundle'])(
    'settles hung %s under the original signing deadline',
    async (operation) => {
      vi.useFakeTimers();
      const f = harness('publisher', { [operation]: () => new Promise(() => {}) });
      const pending = denies(() => f.create().registry.attest(attestInput()));
      await vi.advanceTimersByTimeAsync(10 * minute + 1);
      await pending;
      expect(f[operation]).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
