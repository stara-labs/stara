import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forbidden = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Uninjected network or process execution is forbidden in transport tests');
  }),
);
vi.mock('node:child_process', () => ({
  exec: forbidden,
  execFile: forbidden,
  execSync: forbidden,
  execFileSync: forbidden,
  spawn: forbidden,
  spawnSync: forbidden,
  fork: forbidden,
}));
vi.mock('node:http', async (original) => ({
  ...(await original()),
  request: forbidden,
  get: forbidden,
}));
vi.mock('node:https', async (original) => ({
  ...(await original()),
  request: forbidden,
  get: forbidden,
}));
vi.mock('google-auth-library', () => ({ GoogleAuth: forbidden }));

const canary = 'synthetic-private-transport-canary-DO-NOT-PUBLISH';
const googleToken = `google-${canary}`;
const jwt = `synthetic.${Buffer.from(canary).toString('base64url')}.signature`;
const start = 1_800_000_000_000;
const MiB = 1024 * 1024;
const bytes = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const emitted = [];
const { Headers, ReadableStream, Response } = globalThis;
let transportModule;

async function implementation() {
  const url = new URL('../release/transport.mjs', import.meta.url);
  try {
    await access(url);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      'Missing implementation: tooling/release/transport.mjs; behavior not executed',
      {
        cause: error,
      },
    );
  }
  transportModule ??= await import(/* @vite-ignore */ url.href);
  for (const name of ['createAuthenticatedRequest', 'verifyBundle', 'executeCLI'])
    expect(
      transportModule[name],
      `Missing transport export ${name}; behavior not executed`,
    ).toBeTypeOf('function');
  return transportModule;
}

function clean(error) {
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toMatch(/\S/);
  for (let item = error, depth = 0; item && depth < 8; item = item.cause, depth++) {
    const diagnostic = `${item.message ?? ''}\n${item.stack ?? ''}\n${JSON.stringify(item)}`;
    for (const secret of [canary, googleToken, jwt]) expect(diagnostic).not.toContain(secret);
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
  return failure;
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
  const diagnostics = emitted.splice(0).join('\n');
  for (const secret of [canary, googleToken, jwt]) expect(diagnostics).not.toContain(secret);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const clock = () => ({ now: () => start, sleep: vi.fn(async () => {}) });
const options = (extra = {}) => ({ method: 'GET', responseType: 'json', ...extra });
const googleUrl = 'https://storage.googleapis.com/storage/v1/b/synthetic/o/config?alt=media';
const syntheticCredentialDestination = new URL('https://storage.googleapis.com/x');
syntheticCredentialDestination.username = 'private';
syntheticCredentialDestination.password = 'secret';

async function http(handler = () => new Response('{"ok":true}'), extra = {}) {
  const api = await implementation();
  const auth = extra.auth ?? { getAccessToken: vi.fn(async () => googleToken) };
  const fetch = vi.fn(handler);
  const time = extra.clock ?? clock();
  return { auth, fetch, request: api.createAuthenticatedRequest({ auth, fetch, clock: time }) };
}

describe('authenticated request: fixed authority and explicit credentials', () => {
  it.each([
    'storage.googleapis.com',
    'run.googleapis.com',
    'iamcredentials.googleapis.com',
    'logging.googleapis.com',
  ])('adds Google auth only to exact %s', async (host) => {
    const h = await http();
    const result = await h.request(`https://${host}/synthetic`, options());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(h.auth.getAccessToken).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0];
    expect(String(url)).toBe(`https://${host}/synthetic`);
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${googleToken}`);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not acquire or forward Google credentials to GitHub, even after a Google request', async () => {
    const h = await http();
    await h.request(googleUrl, options());
    await h.request('https://api.github.com/repos/stara-labs/stara', options());
    expect(h.auth.getAccessToken).toHaveBeenCalledTimes(1);
    expect(new Headers(h.fetch.mock.calls[1][1].headers).has('authorization')).toBe(false);
  });

  it('forwards only the explicitly supplied JWT to the exact staging origin', async () => {
    const h = await http();
    await h.request(
      'https://staging.app.stara.co/api/health',
      options({ headers: { Authorization: `Bearer ${jwt}` } }),
    );
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
    expect(new Headers(h.fetch.mock.calls[0][1].headers).get('authorization')).toBe(
      `Bearer ${jwt}`,
    );
  });

  it.each([
    'http://storage.googleapis.com/x',
    'https://storage.googleapis.com.attacker.invalid/x',
    'https://storage.googleapis.com./x',
    'https://storage.googleapis.com:444/x',
    syntheticCredentialDestination.href,
    'https://storage.googleapis.com/x#fragment',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'http://metadata.google.internal/computeMetadata/v1/',
    'https://169.254.169.254/',
    'https://run.app/',
    'https://app.stara.co/',
    'https://staging.app.stara.co.attacker.invalid/',
    'file:///private/config',
    'data:application/json,{}',
    '//storage.googleapis.com/x',
    'not a URL',
  ])('denies unapproved destination %s before auth or fetch', async (url) => {
    const h = await http();
    await denied(() => h.request(url, options()));
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(['HEAD', 'PUT', 'DELETE', 'OPTIONS', 'CONNECT', 'get', '', undefined])(
    'denies unsupported or missing method %s before I/O',
    async (method) => {
      const h = await http();
      await denied(() => h.request(googleUrl, options({ method })));
      expect(h.auth.getAccessToken).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['text', 'stream', '', undefined])(
    'denies invalid response type %s',
    async (responseType) => {
      const h = await http();
      await denied(() => h.request(googleUrl, options({ responseType })));
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['follow', 'manual'])('cannot override redirect policy with %s', async (redirect) => {
    const h = await http();
    await denied(() => h.request(googleUrl, options({ redirect })));
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [googleUrl, { authorization: `Bearer ${jwt}` }],
    ['https://api.github.com/user', { Authorization: `Bearer ${googleToken}` }],
    ['https://staging.app.stara.co/', {}],
    ['https://staging.app.stara.co/', { Authorization: `Basic ${canary}` }],
    [googleUrl, { Cookie: canary }],
    [googleUrl, { 'Proxy-Authorization': canary }],
    [googleUrl, { Host: 'attacker.invalid' }],
  ])('denies credential/routing override %s', async (url, headers) => {
    const h = await http();
    await denied(() => h.request(url, options({ headers })));
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each([null, undefined, '', { token: googleToken }, `token\r\n${canary}`])(
    'denies unusable Google token without forwarding it',
    async (token) => {
      const h = await http(undefined, { auth: { getAccessToken: vi.fn(async () => token) } });
      await denied(() => h.request(googleUrl, options()));
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it('sanitizes auth errors and does not attempt a request', async () => {
    const h = await http(undefined, {
      auth: {
        getAccessToken: vi.fn(async () => {
          throw new Error(canary);
        }),
      },
    });
    await denied(() => h.request(googleUrl, options()));
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PATCH'])(
    'serializes a JSON %s body without mutating caller headers',
    async (method) => {
      const h = await http();
      const headers = { 'If-Match': 'synthetic-etag' };
      const body = { safe: ['synthetic'] };
      await h.request(googleUrl, options({ method, headers, body }));
      const init = h.fetch.mock.calls[0][1];
      expect(JSON.parse(init.body)).toEqual(body);
      expect(new Headers(init.headers).get('content-type')).toMatch(/^application\/json\b/);
      expect(headers).toEqual({ 'If-Match': 'synthetic-etag' });
      expect(body).toEqual({ safe: ['synthetic'] });
    },
  );

  it('preserves original upload bytes including insignificant JSON whitespace', async () => {
    const h = await http();
    const body = bytes(' { "state": null }\n');
    await h.request(googleUrl, options({ method: 'POST', body }));
    expect(Buffer.from(h.fetch.mock.calls[0][1].body)).toEqual(body);
  });
});

describe('response handling: no redirects, no retries and bounded original bytes', () => {
  it('returns original bytes and case-insensitive service metadata as a plain header object', async () => {
    const body = bytes(' { "synthetic": true }\r\n');
    const h = await http(
      () => new Response(body, { headers: { 'X-Goog-Generation': '9007199254740993' } }),
    );
    const result = await h.request(googleUrl, options({ responseType: 'bytes' }));
    expect(Buffer.from(result.body)).toEqual(body);
    expect(hash(result.body)).toBe(hash(body));
    expect(Object.getPrototypeOf(result.headers)).toBe(Object.prototype);
    expect(new Headers(result.headers).get('x-goog-generation')).toBe('9007199254740993');
  });

  it.each([301, 302, 303, 307, 308])(
    'denies HTTP %s without following Location',
    async (status) => {
      const h = await http(
        () => new Response(canary, { status, headers: { Location: 'https://attacker.invalid/' } }),
      );
      await denied(() => h.request(googleUrl, options()));
      expect(h.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([400, 403, 404, 409, 412, 429, 500, 503])(
    'returns HTTP %s for adapter classification without retries',
    async (status) => {
      const h = await http(() => new Response('{"error":"synthetic"}', { status }));
      expect((await h.request(googleUrl, options())).status).toBe(status);
      expect(h.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [0, 'bytes'],
    [-1, 'bytes'],
    [1.5, 'bytes'],
    [NaN, 'bytes'],
    [Infinity, 'bytes'],
    [5 * MiB + 1, 'bytes'],
    [MiB + 1, 'json'],
    ['1024', 'bytes'],
  ])('rejects invalid byte limit %s for %s before I/O', async (maxBytes, responseType) => {
    const h = await http();
    await denied(() => h.request(googleUrl, options({ maxBytes, responseType })));
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
  });

  it('accepts the exact default byte boundary and explicitly bounded 5MiB assets', async () => {
    for (const size of [MiB, 5 * MiB]) {
      const h = await http(() => new Response(new Uint8Array(size)));
      const result = await h.request(
        googleUrl,
        options({ responseType: 'bytes', ...(size > MiB ? { maxBytes: size } : {}) }),
      );
      expect(result.body.byteLength).toBe(size);
    }
  });

  it.each([undefined, '1', '1048576'])(
    'bounds streamed bytes regardless of Content-Length %s',
    async (contentLength) => {
      const cancel = vi.fn();
      const h = await http(
        () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(512));
              },
              cancel,
            }),
            { headers: contentLength === undefined ? {} : { 'Content-Length': contentLength } },
          ),
      );
      await denied(() => h.request(googleUrl, options({ responseType: 'bytes', maxBytes: 1024 })));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    },
  );

  it.each([
    bytes('{"ok":true,"ok":false}'),
    bytes('{"ok":true,"\\u006fk":false}'),
    bytes('{"nested":{"x":1,"x":2}}'),
    bytes('{}{}'),
    bytes(`<html>${canary}</html>`),
    Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d]),
  ])(
    'denies malformed or ambiguous structured response without diagnostic leakage',
    async (raw) => {
      const h = await http(() => new Response(raw));
      await denied(() => h.request(googleUrl, options()));
      expect(h.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['GET', 'POST', 'PATCH'])('never retries a thrown %s transport error', async (method) => {
    const h = await http(() => {
      throw new Error(`${canary} ${googleToken}`);
    });
    await denied(() => h.request(googleUrl, options({ method })));
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('transport cancellation: original deadlines include auth and body reads', () => {
  it.each([start, start - 1, NaN, Infinity, '1800000000001'])(
    'rejects invalid or expired deadline %s before I/O',
    async (deadline) => {
      const h = await http();
      await denied(() => h.request(googleUrl, options({ deadline })));
      expect(h.auth.getAccessToken).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );

  it('denies an already aborted signal without acquiring credentials', async () => {
    const controller = new AbortController();
    controller.abort(new Error(canary));
    const h = await http();
    await denied(() => h.request(googleUrl, options({ signal: controller.signal })));
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(['auth', 'fetch', 'body'])(
    'bounds a hung %s even if it ignores AbortSignal',
    async (stage) => {
      vi.useFakeTimers();
      vi.setSystemTime(start);
      const cancel = vi.fn();
      const h = await http(
        () =>
          stage === 'fetch' ? new Promise(() => {}) : new Response(new ReadableStream({ cancel })),
        {
          auth: {
            getAccessToken: vi.fn(() =>
              stage === 'auth' ? new Promise(() => {}) : Promise.resolve(googleToken),
            ),
          },
          clock: { now: Date.now },
        },
      );
      const rejection = denied(() => h.request(googleUrl, options({ deadline: start + 1000 })));
      await vi.advanceTimersByTimeAsync(1001);
      await rejection;
      if (stage === 'auth') expect(h.fetch).not.toHaveBeenCalled();
      else expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      if (stage === 'body') expect(cancel).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([undefined, start + 60_000])(
    'caps a request at 30 seconds for deadline %s',
    async (deadline) => {
      vi.useFakeTimers();
      vi.setSystemTime(start);
      const h = await http(() => new Promise(() => {}), { clock: { now: Date.now } });
      const rejection = denied(() =>
        h.request(googleUrl, options(deadline === undefined ? {} : { deadline })),
      );
      await vi.advanceTimersByTimeAsync(30_001);
      await rejection;
      expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('propagates caller cancellation after headers while sanitizing its reason', async () => {
    const cancel = vi.fn();
    const h = await http(() => new Response(new ReadableStream({ cancel })));
    const controller = new AbortController();
    const rejection = denied(() => h.request(googleUrl, options({ signal: controller.signal })));
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    controller.abort(new Error(canary));
    await rejection;
    expect(h.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

const sourceSha = '1'.repeat(40);
const workflowRef = 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main';
function configuration() {
  return {
    schemaVersion: 1,
    targetId: 'staging-a',
    environment: 'staging',
    policy: { repositoryId: '1363262992', provenanceWorkflowRef: workflowRef },
    projectId: 'stara-synthetic-target',
    artifactBucket: 'stara-synthetic-artifacts',
    stateBucket: 'stara-synthetic-state',
  };
}
function dispatch(rawConfig) {
  return {
    schemaVersion: 1,
    sourceSha,
    manifestSha256: '2'.repeat(64),
    configurationSha256: hash(rawConfig),
  };
}

async function cli(extra = {}) {
  const api = await implementation();
  const rawConfig = extra.rawConfig ?? bytes(` ${JSON.stringify(configuration())}\n`);
  const rawDispatch = extra.rawDispatch ?? bytes(dispatch(rawConfig));
  const request = vi.fn(async () => ({ status: 200, headers: {}, body: rawConfig }));
  const store = { read: vi.fn(), transact: vi.fn() };
  const adapters = { syntheticAdapter: true };
  const core = {
    run: vi.fn(async () => ({ status: 'succeeded', diagnostics: canary, token: jwt })),
  };
  const factories = {
    readPrivateConfiguration: vi.fn(() => configuration()),
    createCloudStore: vi.fn(() => store),
    createCloudAdapters: vi.fn(() => adapters),
    createExecutor: vi.fn(() => core),
  };
  const input = {
    argv: ['execute'],
    env: {
      STARA_CONFIGURATION_URI: 'gs://stara-synthetic-config/targets/staging.json',
      STARA_DISPATCH_PAYLOAD: rawDispatch.toString('base64'),
      GOOGLE_APPLICATION_CREDENTIALS: canary,
      GH_TOKEN: canary,
      NODE_OPTIONS: `--require=${canary}`,
      STARA_TARGET: 'production',
    },
    request,
    verifyAttestation: vi.fn(),
    clock: clock(),
    factories,
  };
  return {
    api,
    rawConfig,
    rawDispatch,
    request,
    store,
    adapters,
    core,
    factories,
    input,
    run: () => api.executeCLI(input),
  };
}

function noCore(h) {
  expect(h.factories.createCloudStore).not.toHaveBeenCalled();
  expect(h.factories.createCloudAdapters).not.toHaveBeenCalled();
  expect(h.factories.createExecutor).not.toHaveBeenCalled();
  expect(h.core.run).not.toHaveBeenCalled();
}

describe('executeCLI: fixed environment inputs, strict decode and original-byte hash', () => {
  it('wires validated config and original dispatch into the real-core boundary without forwarding environment', async () => {
    const h = await cli();
    expect(await h.run()).toEqual({ status: 'succeeded' });
    expect(h.request).toHaveBeenCalledTimes(1);
    const [url, init] = h.request.mock.calls[0];
    expect(String(url)).toBe(
      'https://storage.googleapis.com/storage/v1/b/stara-synthetic-config/o/targets%2Fstaging.json?alt=media',
    );
    expect(init).toMatchObject({ method: 'GET', responseType: 'bytes', maxBytes: 65536 });
    expect(init.deadline).toBeGreaterThan(start);
    expect(init.deadline).toBeLessThanOrEqual(start + 30_000);
    expect(Buffer.from(h.factories.readPrivateConfiguration.mock.calls[0][0])).toEqual(h.rawConfig);
    expect(h.factories.createCloudStore).toHaveBeenCalledWith({
      configuration: configuration(),
      request: h.request,
    });
    expect(h.factories.createCloudAdapters).toHaveBeenCalledWith({
      configuration: configuration(),
      request: h.request,
      verifyAttestation: h.input.verifyAttestation,
      clock: h.input.clock,
    });
    const coreInput = h.factories.createExecutor.mock.calls[0][0];
    expect(coreInput).toEqual({
      config: {
        targetId: 'staging-a',
        environment: 'staging',
        policy: configuration().policy,
        configurationSha256: hash(h.rawConfig),
      },
      store: h.store,
      adapters: h.adapters,
      clock: h.input.clock,
    });
    expect(h.core.run).toHaveBeenCalledTimes(1);
    expect(Buffer.from(h.core.run.mock.calls[0][0])).toEqual(h.rawDispatch);
    expect(JSON.stringify(coreInput)).not.toContain(canary);
  });

  it.each([
    [],
    ['execute', '--target', 'production'],
    ['publish'],
    ['sh', '-c', canary],
    ['execute', canary],
  ])('denies argv %j before request or core construction', async (argv) => {
    const h = await cli();
    h.input.argv = argv;
    await denied(h.run);
    expect(h.request).not.toHaveBeenCalled();
    noCore(h);
  });

  it.each(['STARA_CONFIGURATION_URI', 'STARA_DISPATCH_PAYLOAD'])(
    'requires fixed environment field %s',
    async (name) => {
      const h = await cli();
      delete h.input.env[name];
      await denied(h.run);
      expect(h.request).not.toHaveBeenCalled();
      noCore(h);
    },
  );

  it.each([
    'https://attacker.invalid/config',
    'file:///private/config',
    'gs://stara-synthetic-config/targets/../staging.json',
    'gs://stara-synthetic-config/targets/%2e%2e/staging.json',
    'gs://stara-synthetic-config/targets/production.json',
    'gs://stara-synthetic-config/targets/staging.json?generation=1',
    'gs://stara-synthetic-config/targets/staging.json#fragment',
    'gs://user:secret@stara-synthetic-config/targets/staging.json',
    'gs://stara-synthetic-config:443/targets/staging.json',
    '',
  ])('rejects unapproved private configuration locator %s', async (uri) => {
    const h = await cli();
    h.input.env.STARA_CONFIGURATION_URI = uri;
    await denied(h.run);
    expect(h.request).not.toHaveBeenCalled();
    noCore(h);
  });

  it.each(['', 'not base64!', 'e30', 'e30=\n', ' e30=', 'e30===', 'e31=', '____'])(
    'rejects noncanonical base64 %s before I/O',
    async (encoded) => {
      const h = await cli();
      h.input.env.STARA_DISPATCH_PAYLOAD = encoded;
      await denied(h.run);
      expect(h.request).not.toHaveBeenCalled();
      noCore(h);
    },
  );

  it.each([
    (value) => bytes({ ...value, command: canary }),
    (value) => bytes({ ...value, sourceSha: 'short' }),
    (value) => bytes(JSON.stringify(value).replace('{', '{"schemaVersion":1,')),
    (value) => bytes(JSON.stringify(value).replace('{', '{"\\u0073chemaVersion":1,')),
    (value) => bytes(`${JSON.stringify(value)}{}`),
    (value) => bytes(JSON.stringify(value).padEnd(4097)),
    () => Buffer.from([0xc3, 0x28]),
    () => bytes(null),
  ])('denies malformed decoded dispatch before config access', async (change) => {
    const h = await cli();
    h.input.env.STARA_DISPATCH_PAYLOAD = change(dispatch(h.rawConfig)).toString('base64');
    await denied(h.run);
    expect(h.request).not.toHaveBeenCalled();
    noCore(h);
  });

  it('accepts exactly 4KiB dispatch and 64KiB original configuration', async () => {
    const rawConfig = bytes(JSON.stringify(configuration()).padEnd(65536));
    const rawDispatch = bytes(JSON.stringify(dispatch(rawConfig)).padEnd(4096));
    const h = await cli({ rawConfig, rawDispatch });
    expect(await h.run()).toEqual({ status: 'succeeded' });
    expect(Buffer.from(h.core.run.mock.calls[0][0])).toEqual(rawDispatch);
  });

  it('rejects a whitespace-only configuration-byte change before state/adapters/core effects', async () => {
    const h = await cli();
    h.request.mockResolvedValue({ status: 200, headers: {}, body: bytes(configuration()) });
    await denied(h.run);
    noCore(h);
  });

  it('independently enforces config length when an injected request returns excess bytes', async () => {
    const h = await cli({ rawConfig: bytes(JSON.stringify(configuration()).padEnd(65537)) });
    await denied(h.run);
    noCore(h);
  });

  it.each([301, 302, 403, 404, 503])(
    'denies config HTTP %s without initializing core state',
    async (status) => {
      const h = await cli();
      h.request.mockResolvedValue({ status, headers: {}, body: bytes(canary) });
      await denied(h.run);
      noCore(h);
    },
  );

  it('honors private configuration parser rejection and sanitizes its diagnostics', async () => {
    const h = await cli();
    h.factories.readPrivateConfiguration.mockImplementation(() => {
      throw new Error(canary);
    });
    await denied(h.run);
    noCore(h);
  });

  it.each(['succeeded', 'failed', 'degraded', 'reconciliation_required'])(
    'exposes only finite terminal %s, not private receipt fields',
    async (status) => {
      const h = await cli();
      h.core.run.mockResolvedValue({
        status,
        reason: canary,
        receiptId: 'a'.repeat(64),
        effects: [{ authorization: jwt }],
        targetId: canary,
      });
      expect(await h.run()).toEqual({ status });
    },
  );

  it('acknowledges a duplicate owned running receipt without leaking or replaying work', async () => {
    const h = await cli();
    h.core.run.mockResolvedValue({ status: 'running', receiptId: canary, effects: [canary] });
    expect(await h.run()).toEqual({ status: 'running' });
    expect(h.core.run).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, {}, { status: 'published' }, { status: canary }])(
    'denies unknown or missing executor outcome',
    async (result) => {
      const h = await cli();
      h.core.run.mockResolvedValue(result);
      await denied(h.run);
    },
  );

  it.each(['request', 'createCloudStore', 'createCloudAdapters', 'createExecutor', 'run'])(
    'sanitizes a thrown %s failure without replay',
    async (name) => {
      const h = await cli();
      const operation =
        name === 'request' ? h.request : name === 'run' ? h.core.run : h.factories[name];
      operation.mockImplementation(() => {
        throw new Error(`${canary} ${googleToken}`);
      });
      await denied(h.run);
      expect(operation).toHaveBeenCalledTimes(1);
    },
  );
});

const certificateIdentity = `https://github.com/${workflowRef}`;
const issuer = 'https://token.actions.githubusercontent.com';
const predicateType = 'https://slsa.dev/provenance/v1';
const repositoryURI = 'https://github.com/stara-labs/stara';
function bundleInput() {
  return {
    component: 'web',
    bundle: bytes(' {"syntheticBundle":true}\n'),
    subjectName: 'stara/web',
    imageRepository: 'us-central1-docker.pkg.dev/stara-synthetic-private/app/web',
    imageDigest: `sha256:${'3'.repeat(64)}`,
    sourceSha,
    repositoryId: '1363262992',
    workflowRef,
    runId: '102',
    runAttempt: 1,
    deadline: start + 30_000,
  };
}
function verification(input = bundleInput()) {
  return [
    {
      verificationResult: {
        signature: {
          certificate: {
            subjectAlternativeName: certificateIdentity,
            issuer,
            buildSignerURI: certificateIdentity,
            buildSignerDigest: sourceSha,
            runnerEnvironment: 'github-hosted',
            sourceRepositoryURI: repositoryURI,
            sourceRepositoryDigest: sourceSha,
            sourceRepositoryRef: 'refs/heads/main',
            sourceRepositoryIdentifier: '1363262992',
            sourceRepositoryOwnerURI: 'https://github.com/stara-labs',
            sourceRepositoryOwnerIdentifier: '293455507',
            buildConfigURI: certificateIdentity,
            buildConfigDigest: sourceSha,
            buildTrigger: 'push',
            runInvocationURI: `${repositoryURI}/actions/runs/${input.runId}/attempts/${input.runAttempt}`,
            sourceRepositoryVisibilityAtSigning: 'public',
          },
        },
        verifiedTimestamps: [
          { type: 'Tlog', uri: 'https://rekor.sigstore.dev', timestamp: '2026-09-10T00:00:00Z' },
        ],
        statement: {
          _type: 'https://in-toto.io/Statement/v1',
          subject: [{ name: input.subjectName, digest: { sha256: input.imageDigest.slice(7) } }],
          predicateType,
          predicate: {},
        },
      },
    },
  ];
}

async function gh(extra = {}) {
  const api = await implementation();
  const input = { ...bundleInput(), ...extra.input };
  const writes = new Map();
  const files = {
    mkdtemp: vi.fn(async (prefix) => `${prefix}synthetic-owned`),
    writeFile: vi.fn(async (name, data) => {
      writes.set(name, Buffer.from(data));
    }),
    rm: vi.fn(async () => {}),
  };
  const auth = { getAccessToken: vi.fn(async () => googleToken) };
  const run = vi.fn(async (_file, argv) =>
    argv[0] === '--version'
      ? {
          code: 0,
          stdout:
            'gh version 2.100.0-stara.1 (2026-09-03)\nhttps://github.com/cli/cli/releases/tag/v2.100.0\n',
          stderr: '',
        }
      : { code: 0, stdout: JSON.stringify(verification(input)), stderr: '' },
  );
  const deps = { auth, run, files, clock: extra.clock ?? clock() };
  return { input, deps, files, auth, run, writes, invoke: () => api.verifyBundle(input, deps) };
}

function cleanedTemporaryFiles(h) {
  expect(h.files.mkdtemp).toHaveBeenCalledTimes(1);
  const root = h.files.mkdtemp.mock.results[0].value;
  return Promise.resolve(root).then((directory) => {
    expect(h.files.rm).toHaveBeenCalledExactlyOnceWith(directory, { recursive: true, force: true });
    for (const [name, _data, settings] of h.files.writeFile.mock.calls) {
      const relative = path.relative(directory, name);
      expect(relative).not.toMatch(/^\.\./);
      expect(path.isAbsolute(relative)).toBe(false);
      expect(settings).toMatchObject({ mode: 0o600, flag: 'wx' });
    }
  });
}

describe('verifyBundle: pinned real-tool boundary and private registry credentials', () => {
  it.each(['web', 'api'])(
    'binds canonical %s subject and certificate identities before returning only verified facts',
    async (component) => {
      const h = await gh({
        input: {
          component,
          subjectName: `stara/${component}`,
          imageRepository: `us-central1-docker.pkg.dev/stara-synthetic-private/app/${component}`,
        },
      });
      const result = await h.invoke();
      expect(result).toEqual({
        verified: true,
        sourceSha,
        repositoryId: '1363262992',
        workflowRef,
        runId: h.input.runId,
        runAttempt: h.input.runAttempt,
        imageDigest: h.input.imageDigest,
        attestationSha256: hash(h.input.bundle),
      });
      expect(h.run).toHaveBeenCalledTimes(2);
      expect(h.run.mock.calls[0][0]).toBe('gh');
      expect(h.run.mock.calls[0][1]).toEqual(['--version']);
      const [command, argv, settings] = h.run.mock.calls[1];
      const root = await h.files.mkdtemp.mock.results[0].value;
      const bundleFile = argv[argv.indexOf('--bundle') + 1];
      expect(command).toBe('gh');
      expect(argv).toEqual([
        'attestation',
        'verify',
        `oci://${h.input.imageRepository}@${h.input.imageDigest}`,
        '--bundle',
        bundleFile,
        '--repo',
        'stara-labs/stara',
        '--cert-identity',
        certificateIdentity,
        '--cert-oidc-issuer',
        issuer,
        '--source-digest',
        sourceSha,
        '--source-ref',
        'refs/heads/main',
        '--signer-digest',
        sourceSha,
        '--deny-self-hosted-runners',
        '--format',
        'json',
      ]);
      expect(settings.env).toEqual({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        GH_HOST: 'github.com',
        HOME: root,
        DOCKER_CONFIG: root,
      });
      for (const call of h.run.mock.calls) {
        expect(call[2].shell).toBe(false);
        expect(call[2].signal).toBeInstanceOf(AbortSignal);
        expect(call[2].timeout).toBeGreaterThan(0);
        expect(call[2].timeout).toBeLessThanOrEqual(30_000);
        expect(call[2].maxBuffer).toBeGreaterThan(0);
        expect(call[2].maxBuffer).toBeLessThanOrEqual(MiB);
        expect(JSON.stringify(call)).not.toContain(googleToken);
      }
      expect(h.writes.get(bundleFile)).toEqual(h.input.bundle);
      const dockerPath = [...h.writes.keys()].find((name) => path.basename(name) === 'config.json');
      const docker = JSON.parse(h.writes.get(dockerPath).toString('utf8'));
      expect(docker).toEqual({
        auths: {
          'us-central1-docker.pkg.dev': {
            auth: Buffer.from(`oauth2accesstoken:${googleToken}`).toString('base64'),
          },
        },
      });
      expect(h.auth.getAccessToken).toHaveBeenCalledTimes(1);
      const prefix = h.files.mkdtemp.mock.calls[0][0];
      expect(path.isAbsolute(prefix)).toBe(true);
      const fromWorkspace = path.relative(process.cwd(), prefix);
      expect(fromWorkspace.startsWith('..') || path.isAbsolute(fromWorkspace)).toBe(true);
      await cleanedTemporaryFiles(h);
    },
  );

  it('does not inherit credentials, proxy settings, runtime preload options or executable overrides', async () => {
    for (const key of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GH_HOST',
      'GH_CONFIG_DIR',
      'DOCKER_CONFIG',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NODE_OPTIONS',
      'BASH_ENV',
      'STARA_GH_PATH',
    ])
      vi.stubEnv(key, canary);
    const h = await gh();
    await h.invoke();
    for (const [, , settings] of h.run.mock.calls)
      expect(JSON.stringify(settings.env)).not.toContain(canary);
    await cleanedTemporaryFiles(h);
    vi.unstubAllEnvs();
  });

  it.each([
    '2.99.0',
    '2.100.0',
    '2.100.1',
    '2.100.0-rc.1',
    '2.100.0evil',
    '2.100.0-stara.2',
    '2.100.0-stara.1evil',
    '',
  ])('rejects unpinned gh version %s before verification', async (version) => {
    const h = await gh();
    h.run.mockResolvedValue({ code: 0, stdout: `gh version ${version}\n${canary}`, stderr: '' });
    await denied(h.invoke);
    expect(h.run).toHaveBeenCalledTimes(1);
    if (h.files.mkdtemp.mock.calls.length) await cleanedTemporaryFiles(h);
  });

  it.each([
    ['subjectName', 'us-central1-docker.pkg.dev/private-project/app/web'],
    ['subjectName', 'stara/api'],
    ['imageRepository', 'us-central1-docker.pkg.dev/stara-synthetic-private/app/web:latest'],
    ['imageRepository', 'https://attacker.invalid/image'],
    ['imageRepository', '--command=private'],
    ['imageDigest', 'latest'],
    ['imageDigest', `sha256:${'A'.repeat(64)}`],
    ['sourceSha', 'short'],
    ['sourceSha', 'A'.repeat(40)],
    ['repositoryId', '666'],
    ['workflowRef', workflowRef.replace('main', 'feature')],
    ['runId', undefined],
    ['runId', null],
    ['runId', 102],
    ['runId', ''],
    ['runId', '0'],
    ['runId', '0102'],
    ['runId', '-102'],
    ['runId', '102/attempts/2'],
    ['runId', '102\n'],
    ['runId', canary],
    ['runAttempt', undefined],
    ['runAttempt', null],
    ['runAttempt', '1'],
    ['runAttempt', 0],
    ['runAttempt', -1],
    ['runAttempt', 1.5],
    ['runAttempt', NaN],
    ['runAttempt', Infinity],
    ['runAttempt', Number.MAX_SAFE_INTEGER + 1],
    ['bundle', Buffer.alloc(0)],
    ['bundle', Buffer.alloc(MiB + 1)],
    ['bundle', { untrusted: canary }],
    ['deadline', start],
  ])('denies invalid verification input %s before auth, files or process', async (field, value) => {
    const h = await gh({ input: { [field]: value } });
    await denied(h.invoke);
    expect(h.auth.getAccessToken).not.toHaveBeenCalled();
    expect(h.files.mkdtemp).not.toHaveBeenCalled();
    expect(h.run).not.toHaveBeenCalled();
  });

  it.each(['version', 'verify', 'write', 'auth'])(
    'sanitizes %s failure and cleans every created credential directory',
    async (stage) => {
      const h = await gh();
      if (stage === 'version') h.run.mockRejectedValue(new Error(canary));
      if (stage === 'verify')
        h.run.mockImplementation(async (_file, args) => {
          if (args[0] === '--version')
            return { code: 0, stdout: 'gh version 2.100.0-stara.1\n', stderr: '' };
          throw new Error(`${canary} ${googleToken}`);
        });
      if (stage === 'write') h.files.writeFile.mockRejectedValue(new Error(canary));
      if (stage === 'auth') h.auth.getAccessToken.mockRejectedValue(new Error(canary));
      await denied(h.invoke);
      if (h.files.mkdtemp.mock.calls.length) await cleanedTemporaryFiles(h);
    },
  );

  it('does not report success if credential cleanup fails', async () => {
    const h = await gh();
    h.files.rm.mockRejectedValue(new Error(canary));
    await denied(h.invoke);
    expect(h.files.rm).toHaveBeenCalledTimes(1);
  });

  it('stops after bounded cleanup grace if credential removal never settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const h = await gh({ clock: { now: Date.now }, input: { deadline: start + 1000 } });
    h.files.rm.mockImplementation(() => new Promise(() => {}));
    const rejection = denied(h.invoke);
    await vi.advanceTimersByTimeAsync(6001);
    await rejection;
    expect(h.files.rm).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reset the remaining deadline after version and authentication', async () => {
    let now = start;
    const h = await gh({ clock: { now: () => now } });
    const ordinary = h.run.getMockImplementation();
    h.run.mockImplementation(async (...args) => {
      const result = await ordinary(...args);
      if (args[1][0] === '--version') now += 10_000;
      return result;
    });
    h.auth.getAccessToken.mockImplementation(async () => {
      now += 5000;
      return googleToken;
    });
    await h.invoke();
    expect(h.run.mock.calls[1][2].timeout).toBeLessThanOrEqual(15_000);
    await cleanedTemporaryFiles(h);
  });

  it('settles and cleans credentials when a verifier ignores its timeout/signal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const h = await gh({ clock: { now: Date.now }, input: { deadline: start + 1000 } });
    h.run.mockImplementation(async (_file, args) =>
      args[0] === '--version'
        ? { code: 0, stdout: 'gh version 2.100.0-stara.1\n', stderr: '' }
        : new Promise(() => {}),
    );
    const rejection = denied(h.invoke);
    await vi.advanceTimersByTimeAsync(1001);
    await rejection;
    expect(h.run.mock.calls.at(-1)[2].signal.aborted).toBe(true);
    await cleanedTemporaryFiles(h);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('verified GH output: certificate facts, never predicate identity assertions', () => {
  it.each([
    ['runId', '203'],
    ['runAttempt', 2],
  ])(
    'does not allow caller mutation of %s during verification to retarget the trusted run',
    async (field, value) => {
      const h = await gh();
      h.run.mockImplementation(async (_file, args) => {
        if (args[0] === '--version') {
          h.input[field] = value;
          return { code: 0, stdout: 'gh version 2.100.0-stara.1\n', stderr: '' };
        }
        return { code: 0, stdout: JSON.stringify(verification(h.input)), stderr: '' };
      });
      await denied(h.invoke);
      await cleanedTemporaryFiles(h);
    },
  );

  it.each([
    ['102', 2],
    ['203', 1],
    ['203', 4],
  ])('returns the exact independently verified run %s attempt %s', async (runId, runAttempt) => {
    const h = await gh({ input: { runId, runAttempt } });
    expect(await h.invoke()).toEqual({
      verified: true,
      sourceSha,
      repositoryId: '1363262992',
      workflowRef,
      runId,
      runAttempt,
      imageDigest: h.input.imageDigest,
      attestationSha256: hash(h.input.bundle),
    });
    await cleanedTemporaryFiles(h);
  });

  it.each([
    `${repositoryURI}/actions/runs/103/attempts/1`,
    `${repositoryURI}/actions/runs/102/attempts/2`,
    `${repositoryURI}/actions/runs/103/attempts/2`,
    `${repositoryURI}/actions/runs/102/attempts/1/`,
    `${repositoryURI}/actions/runs/102/attempts/1?run=102`,
    `${repositoryURI}/actions/runs/102/attempts/1#1`,
    `${repositoryURI}/actions/runs/0102/attempts/1`,
    `${repositoryURI}/actions/runs/102/attempts/01`,
    `${repositoryURI}/actions/runs/102/attempts/%31`,
    `${repositoryURI}/actions/runs/102`,
    `https://github.com:443/stara-labs/stara/actions/runs/102/attempts/1`,
  ])(
    'rejects nonexact certificate invocation %s even when predicate matches',
    async (invocation) => {
      const h = await gh();
      const result = verification();
      const verified = result[0].verificationResult;
      const exact = verified.signature.certificate.runInvocationURI;
      verified.statement.predicate = {
        runId: h.input.runId,
        runAttempt: h.input.runAttempt,
        runInvocationURI: exact,
        runDetails: { metadata: { invocationId: exact } },
      };
      verified.signature.certificate.runInvocationURI = invocation;
      h.run.mockImplementation(async (_file, args) => ({
        code: 0,
        stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
        stderr: '',
      }));
      await denied(h.invoke);
      await cleanedTemporaryFiles(h);
    },
  );

  it('does not accept a buildInvocationURI alias in place of the official certificate field', async () => {
    const h = await gh();
    const result = verification();
    const cert = result[0].verificationResult.signature.certificate;
    cert.buildInvocationURI = cert.runInvocationURI;
    delete cert.runInvocationURI;
    h.run.mockImplementation(async (_file, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
      stderr: '',
    }));
    await denied(h.invoke);
    await cleanedTemporaryFiles(h);
  });

  it('rejects an additional verified signature from a different attempt', async () => {
    const h = await gh();
    const results = [...verification(), ...verification({ ...h.input, runAttempt: 2 })];
    h.run.mockImplementation(async (_file, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(results),
      stderr: '',
    }));
    await denied(h.invoke);
    await cleanedTemporaryFiles(h);
  });

  it.each(['Tlog', 'TimestampAuthority'])(
    'accepts the official Sigstore verified timestamp type %s',
    async (type) => {
      const h = await gh();
      const result = verification();
      result[0].verificationResult.verifiedTimestamps[0].type = type;
      h.run.mockImplementation(async (_file, args) => ({
        code: 0,
        stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
        stderr: '',
      }));
      expect((await h.invoke()).verified).toBe(true);
      await cleanedTemporaryFiles(h);
    },
  );

  it.each([
    { type: 'CurrentTime' },
    { type: 'tlog' },
    { type: 'timestamp-authority' },
    { type: 'unverified' },
    { timestamp: 'not-a-date' },
    { timestamp: '' },
    { timestamp: null },
    { timestamp: 0 },
    { timestamp: undefined },
  ])('rejects an unverified or invalid timestamp record', async (change) => {
    const h = await gh();
    const result = verification();
    Object.assign(result[0].verificationResult.verifiedTimestamps[0], change);
    h.run.mockImplementation(async (_file, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
      stderr: '',
    }));
    await denied(h.invoke);
    await cleanedTemporaryFiles(h);
  });

  it.each([
    [
      'subjectAlternativeName',
      'https://github.com/attacker/repo/.github/workflows/release.yml@refs/heads/main',
    ],
    ['issuer', 'https://attacker.invalid'],
    ['buildSignerURI', certificateIdentity.replace('release.yml', 'checks.yml')],
    ['buildSignerDigest', '4'.repeat(40)],
    ['runnerEnvironment', 'self-hosted'],
    ['sourceRepositoryURI', 'https://github.com/attacker/repo'],
    ['sourceRepositoryDigest', '4'.repeat(40)],
    ['sourceRepositoryRef', 'refs/pull/1/merge'],
    ['sourceRepositoryIdentifier', '666'],
    ['sourceRepositoryOwnerURI', 'https://github.com/attacker'],
    ['sourceRepositoryOwnerIdentifier', '666'],
    ['buildConfigURI', certificateIdentity.replace('main', 'feature')],
    ['buildConfigDigest', '4'.repeat(40)],
    ['buildTrigger', 'pull_request'],
    ['runInvocationURI', 'https://github.com/attacker/repo/actions/runs/102/attempts/1'],
    ['sourceRepositoryVisibilityAtSigning', 'private'],
  ])('rejects mismatched certificate %s even with a matching predicate', async (field, value) => {
    const h = await gh();
    const result = verification();
    const verified = result[0].verificationResult;
    verified.statement.predicate = { ...verified.signature.certificate };
    verified.signature.certificate[field] = value;
    h.run.mockImplementation(async (_file, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
      stderr: '',
    }));
    await denied(h.invoke);
    await cleanedTemporaryFiles(h);
  });

  it.each(Object.keys(verification()[0].verificationResult.signature.certificate))(
    'rejects absent certificate field %s',
    async (field) => {
      const h = await gh();
      const result = verification();
      delete result[0].verificationResult.signature.certificate[field];
      h.run.mockImplementation(async (_file, args) => ({
        code: 0,
        stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
        stderr: '',
      }));
      await denied(h.invoke);
      await cleanedTemporaryFiles(h);
    },
  );

  it.each([
    (value) => {
      value[0].verificationResult.signature = {};
    },
    (value) => {
      value[0].verificationResult.signature.certificate = null;
    },
    (value) => {
      value[0].verificationResult.verifiedTimestamps = [];
    },
    (value) => {
      delete value[0].verificationResult.verifiedTimestamps;
    },
    (value) => {
      value[0].verificationResult.statement.predicateType = 'https://attacker.invalid';
    },
    (value) => {
      value[0].verificationResult.statement.subject[0].name = bundleInput().imageRepository;
    },
    (value) => {
      value[0].verificationResult.statement.subject[0].digest.sha256 = '4'.repeat(64);
    },
    (value) => {
      value[0].verificationResult.statement.subject = [];
    },
    (value) => {
      value[0].verificationResult.statement.subject.push({
        name: 'other',
        digest: { sha256: '4'.repeat(64) },
      });
    },
    (value) => {
      value[0].verificationResult.statement.subject[0].digest = { sha512: '3'.repeat(128) };
    },
  ])('rejects missing or mismatched verified structure', async (change) => {
    const h = await gh();
    const result = verification();
    change(result);
    h.run.mockImplementation(async (_file, args) => ({
      code: 0,
      stdout: args[0] === '--version' ? 'gh version 2.100.0-stara.1\n' : JSON.stringify(result),
      stderr: '',
    }));
    await denied(h.invoke);
    await cleanedTemporaryFiles(h);
  });

  it.each([
    { code: 1, stdout: JSON.stringify(verification()), stderr: canary },
    { code: 0, signal: 'SIGTERM', stdout: JSON.stringify(verification()), stderr: canary },
    { stdout: JSON.stringify(verification()), stderr: '' },
    { code: 0, stdout: '{}', stderr: canary },
    { code: 0, stdout: '[]', stderr: '' },
    { code: 0, stdout: `not json ${canary}`, stderr: '' },
    { code: 0, stdout: JSON.stringify(verification()).padEnd(MiB + 1), stderr: '' },
    { code: 0, stdout: `${JSON.stringify(verification())}[]`, stderr: '' },
    {
      code: 0,
      stdout: JSON.stringify(verification()).replace(
        '"issuer":',
        '"issuer":"https://attacker.invalid","issuer":',
      ),
      stderr: '',
    },
  ])(
    'rejects nonzero, interrupted, malformed, oversized or ambiguous verifier output',
    async (result) => {
      const h = await gh();
      h.run.mockImplementation(async (_file, args) =>
        args[0] === '--version'
          ? { code: 0, stdout: 'gh version 2.100.0-stara.1\n', stderr: '' }
          : result,
      );
      await denied(h.invoke);
      await cleanedTemporaryFiles(h);
    },
  );
});
