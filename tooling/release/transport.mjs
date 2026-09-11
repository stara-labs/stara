import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { GoogleAuth } from 'google-auth-library';
import { parseDocument } from 'yaml';
import { createCloudAdapters, createCloudStore, readPrivateConfiguration } from './adapters.mjs';
import { parseDispatch } from './contract.mjs';
import { createExecutor } from './executor.mjs';

const MiB = 1024 * 1024;
const googleHosts = new Set([
  'storage.googleapis.com',
  'run.googleapis.com',
  'iamcredentials.googleapis.com',
  'logging.googleapis.com',
]);
const stagingHost = 'staging.app.stara.co';
const repository = 'stara-labs/stara';
const repositoryURI = `https://github.com/${repository}`;
const workflowRef = `${repository}/.github/workflows/release.yml@refs/heads/main`;
const certificateIdentity = `https://github.com/${workflowRef}`;
const issuer = 'https://token.actions.githubusercontent.com';
const registryHost = 'us-central1-docker.pkg.dev';
const systemClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function failure() {
  return new Error('Release transport denied');
}

function requireValue(condition) {
  if (!condition) throw failure();
}

function matches(value, pattern) {
  return typeof value === 'string' && value.match(pattern)?.[0] === value;
}

function originalBytes(value, limit) {
  requireValue(value instanceof Uint8Array || typeof value === 'string');
  if (typeof value === 'string') requireValue(value.isWellFormed());
  const size = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
  requireValue(size > 0 && size <= limit);
  return Buffer.from(value);
}

function strictJson(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const value = JSON.parse(text);
  const document = parseDocument(text, {
    schema: 'json',
    uniqueKeys: true,
    strict: true,
    prettyErrors: false,
  });
  requireValue(document.errors.length === 0);
  return value;
}

function accessToken(value) {
  requireValue(matches(value, /^[\x21-\x7e]{1,16384}$/));
  return value;
}

function defaultAuth() {
  return new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
}

// One budget covers credentials, headers and streamed bodies, including peers
// that do not honor AbortSignal. Continuations must check before further I/O.
async function bounded({ clock = systemClock, deadline, signal }, action) {
  const start = clock.now();
  requireValue(Number.isSafeInteger(start) && start >= 0);
  requireValue(deadline === undefined || (Number.isSafeInteger(deadline) && deadline > start));
  requireValue(signal === undefined || (signal instanceof AbortSignal && !signal.aborted));
  const end = Math.min(deadline ?? start + 30_000, start + 30_000);
  const controller = new AbortController();
  let cancelResource = () => {};
  let rejectCancellation;
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject;
  });
  function cancel() {
    if (controller.signal.aborted) return;
    controller.abort();
    try {
      cancelResource();
    } catch {
      /* Cancellation cannot expose peer diagnostics. */
    }
    rejectCancellation(failure());
  }
  const timer = setTimeout(cancel, end - start);
  signal?.addEventListener('abort', cancel, { once: true });
  const scope = {
    signal: controller.signal,
    remaining() {
      const now = clock.now();
      requireValue(
        Number.isSafeInteger(now) && now >= start && now < end && !controller.signal.aborted,
      );
      return Math.min(end - now, end - start);
    },
    onCancel(callback) {
      cancelResource = callback;
      if (controller.signal.aborted) callback();
    },
  };
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        scope.remaining();
        return action(scope);
      }),
      cancellation,
    ]);
  } catch {
    cancel();
    throw failure();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export function createAuthenticatedRequest({
  auth,
  fetch = globalThis.fetch,
  clock = systemClock,
} = {}) {
  return async function request(rawUrl, options) {
    try {
      requireValue(matches(rawUrl, /^https:\/\/[^\s\\#]+$/));
      const url = new URL(rawUrl);
      requireValue(!url.username && !url.password && !url.hash && !url.port);
      const google = googleHosts.has(url.hostname);
      requireValue(google || url.hostname === 'api.github.com' || url.hostname === stagingHost);
      requireValue(options && ['GET', 'POST', 'PATCH'].includes(options.method));
      requireValue(['bytes', 'json'].includes(options.responseType));
      const allowed = [
        'method',
        'headers',
        'body',
        'signal',
        'responseType',
        'deadline',
        'maxBytes',
      ];
      requireValue(Reflect.ownKeys(options).every((key) => allowed.includes(key)));
      const maxBytes = options.maxBytes === undefined ? MiB : options.maxBytes;
      requireValue(
        Number.isSafeInteger(maxBytes) &&
          maxBytes > 0 &&
          maxBytes <= (options.responseType === 'bytes' ? 5 * MiB : MiB),
      );
      const headers = new globalThis.Headers(options.headers);
      for (const name of headers.keys()) {
        requireValue(
          ['accept', 'content-type', 'if-match', 'x-github-api-version', 'authorization'].includes(
            name,
          ),
        );
      }
      if (url.hostname === stagingHost) {
        requireValue(
          matches(
            headers.get('authorization'),
            /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
          ),
        );
      } else {
        requireValue(!headers.has('authorization'));
      }
      let body;
      if (options.body !== undefined) {
        requireValue(options.method !== 'GET');
        if (options.body instanceof Uint8Array) body = originalBytes(options.body, MiB);
        else {
          requireValue(options.body !== null && typeof options.body === 'object');
          body = JSON.stringify(options.body);
          originalBytes(body, MiB);
          headers.set('content-type', 'application/json');
        }
      }
      return await bounded(
        { clock, deadline: options.deadline, signal: options.signal },
        async (scope) => {
          if (google) {
            auth ??= defaultAuth();
            const token = accessToken(await auth.getAccessToken());
            scope.remaining();
            headers.set('authorization', `Bearer ${token}`);
          }
          scope.remaining();
          const response = await fetch(rawUrl, {
            method: options.method,
            headers,
            ...(body === undefined ? {} : { body }),
            signal: scope.signal,
            redirect: 'error',
            credentials: 'omit',
          });
          const reader = response.body?.getReader();
          if (reader)
            scope.onCancel(() => {
              void reader.cancel().catch(() => {});
            });
          scope.remaining();
          requireValue(
            Number.isInteger(response.status) && response.status >= 200 && response.status <= 599,
          );
          requireValue(!response.redirected && !(response.status >= 300 && response.status < 400));
          const chunks = [];
          let size = 0;
          if (reader) {
            for (;;) {
              const chunk = await reader.read();
              scope.remaining();
              if (chunk.done) break;
              requireValue(chunk.value instanceof Uint8Array);
              size += chunk.value.byteLength;
              requireValue(size <= maxBytes);
              chunks.push(Buffer.from(chunk.value));
            }
          }
          const raw = Buffer.concat(chunks, size);
          return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body:
              options.responseType === 'bytes'
                ? raw
                : response.status === 204 && size === 0
                  ? null
                  : strictJson(raw),
          };
        },
      );
    } catch {
      throw failure();
    }
  };
}

function runProcess(command, argv, options) {
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      { ...options, encoding: 'buffer', windowsHide: true, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
          stdout,
          stderr,
          signal: error?.signal,
        });
      },
    );
  });
}

function outside(directory, parent) {
  const relative = path.relative(parent, directory);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function processOutput(result) {
  requireValue(result?.code === 0 && !result.signal);
  return originalBytes(result.stdout, MiB);
}

function verifiedFacts(raw, input, bundle) {
  const results = strictJson(raw);
  requireValue(Array.isArray(results) && results.length > 0);
  for (const result of results) {
    const verification = result?.verificationResult;
    const cert = verification?.signature?.certificate;
    requireValue(cert && typeof cert === 'object');
    const expected = {
      subjectAlternativeName: certificateIdentity,
      issuer,
      buildSignerURI: certificateIdentity,
      buildSignerDigest: input.sourceSha,
      runnerEnvironment: 'github-hosted',
      sourceRepositoryURI: repositoryURI,
      sourceRepositoryDigest: input.sourceSha,
      sourceRepositoryRef: 'refs/heads/main',
      sourceRepositoryIdentifier: '1363262992',
      sourceRepositoryOwnerURI: 'https://github.com/stara-labs',
      sourceRepositoryOwnerIdentifier: '293455507',
      buildConfigURI: certificateIdentity,
      buildConfigDigest: input.sourceSha,
      buildTrigger: 'push',
      sourceRepositoryVisibilityAtSigning: 'public',
    };
    requireValue(Object.entries(expected).every(([key, value]) => cert[key] === value));
    requireValue(
      cert.runInvocationURI ===
        `https://github.com/stara-labs/stara/actions/runs/${input.runId}/attempts/${input.runAttempt}`,
    );
    requireValue(
      Array.isArray(verification.verifiedTimestamps) && verification.verifiedTimestamps.length > 0,
    );
    requireValue(
      verification.verifiedTimestamps.every(
        (entry) =>
          ['Tlog', 'TimestampAuthority'].includes(entry?.type) &&
          typeof entry.uri === 'string' &&
          matches(
            entry.timestamp,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
          ) &&
          Number.isFinite(Date.parse(entry.timestamp)),
      ),
    );
    const statement = verification.statement;
    requireValue(
      statement?._type === 'https://in-toto.io/Statement/v1' &&
        statement.predicateType === 'https://slsa.dev/provenance/v1',
    );
    requireValue(Array.isArray(statement.subject) && statement.subject.length === 1);
    const subject = statement.subject[0];
    requireValue(
      subject.name === input.subjectName && subject.digest?.sha256 === input.imageDigest.slice(7),
    );
    requireValue(Object.keys(subject.digest).length === 1);
  }
  const verified = results[0].verificationResult;
  return {
    verified: true,
    sourceSha: verified.signature.certificate.sourceRepositoryDigest,
    repositoryId: verified.signature.certificate.sourceRepositoryIdentifier,
    workflowRef: verified.signature.certificate.buildConfigURI.slice('https://github.com/'.length),
    imageDigest: `sha256:${verified.statement.subject[0].digest.sha256}`,
    attestationSha256: createHash('sha256').update(bundle).digest('hex'),
    runId: input.runId,
    runAttempt: input.runAttempt,
  };
}

export async function verifyBundle(
  input,
  { auth, run = runProcess, files = { mkdtemp, writeFile, rm }, clock = systemClock } = {},
) {
  let directory;
  let result;
  let failed = false;
  try {
    requireValue(input && ['web', 'api'].includes(input.component));
    requireValue(input.subjectName === `stara/${input.component}`);
    requireValue(
      matches(
        input.imageRepository,
        /^us-central1-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z][a-z0-9-]*\/(web|api)$/,
      ),
    );
    requireValue(input.imageRepository.endsWith(`/${input.component}`));
    requireValue(matches(input.imageDigest, /^sha256:[0-9a-f]{64}$/));
    requireValue(matches(input.sourceSha, /^[0-9a-f]{40}$/));
    requireValue(matches(input.runId, /^[1-9][0-9]*$/));
    requireValue(Number.isSafeInteger(input.runAttempt) && input.runAttempt > 0);
    requireValue(input.repositoryId === '1363262992' && input.workflowRef === workflowRef);
    requireValue(input.bundle instanceof Uint8Array);
    const bundle = originalBytes(input.bundle, MiB);
    input = { ...input, bundle };
    result = await bounded(
      { clock, deadline: input.deadline, signal: input.signal },
      async (scope) => {
        const prefix = path.join(tmpdir(), 'stara-release-');
        const workspace = fileURLToPath(new URL('../..', import.meta.url));
        requireValue(outside(prefix, process.cwd()) && outside(prefix, workspace));
        const owned = await files.mkdtemp(prefix);
        requireValue(
          typeof owned === 'string' &&
            path.isAbsolute(owned) &&
            owned.startsWith(prefix) &&
            owned.length > prefix.length,
        );
        requireValue(path.dirname(owned) === path.dirname(prefix));
        directory = owned;
        if (scope.signal.aborted) {
          directory = undefined;
          await files.rm(owned, { recursive: true, force: true });
          throw failure();
        }
        const env = {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          GH_HOST: 'github.com',
          HOME: owned,
          DOCKER_CONFIG: owned,
        };
        const settings = () => ({
          env,
          shell: false,
          signal: scope.signal,
          timeout: scope.remaining(),
          maxBuffer: MiB,
        });
        const version = new TextDecoder('utf-8', { fatal: true }).decode(
          processOutput(await run('gh', ['--version'], settings())),
        );
        requireValue(/^gh version 2\.100\.0(?: \([^\r\n]*\))?(?:\r?\n|$)/.test(version));
        scope.remaining();
        auth ??= defaultAuth();
        const token = accessToken(await auth.getAccessToken());
        scope.remaining();
        const docker = {
          auths: {
            [registryHost]: { auth: Buffer.from(`oauth2accesstoken:${token}`).toString('base64') },
          },
        };
        await files.writeFile(
          path.join(owned, 'config.json'),
          Buffer.from(JSON.stringify(docker)),
          { mode: 0o600, flag: 'wx' },
        );
        scope.remaining();
        const bundleFile = path.join(owned, 'bundle.jsonl');
        await files.writeFile(bundleFile, bundle, { mode: 0o600, flag: 'wx' });
        const output = processOutput(
          await run(
            'gh',
            [
              'attestation',
              'verify',
              `oci://${input.imageRepository}@${input.imageDigest}`,
              '--bundle',
              bundleFile,
              '--repo',
              repository,
              '--cert-identity',
              certificateIdentity,
              '--cert-oidc-issuer',
              issuer,
              '--source-digest',
              input.sourceSha,
              '--source-ref',
              'refs/heads/main',
              '--signer-digest',
              input.sourceSha,
              '--deny-self-hosted-runners',
              '--format',
              'json',
            ],
            settings(),
          ),
        );
        scope.remaining();
        return verifiedFacts(output, input, bundle);
      },
    );
  } catch {
    failed = true;
  }
  if (directory) {
    try {
      // Even after a verification deadline, attempt credential removal with a
      // separate bounded grace period. Cleanup failure cannot become success.
      await bounded({ clock, deadline: clock.now() + 5000 }, () =>
        files.rm(directory, { recursive: true, force: true }),
      );
    } catch {
      failed = true;
    }
  }
  if (failed) throw failure();
  return result;
}

export async function executeCLI({
  argv,
  env,
  request,
  verifyAttestation = verifyBundle,
  clock = systemClock,
  factories = {},
} = {}) {
  try {
    requireValue(Array.isArray(argv) && argv.length === 1 && argv[0] === 'execute');
    const uri = env?.STARA_CONFIGURATION_URI;
    requireValue(matches(uri, /^gs:\/\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/targets\/staging\.json$/));
    const encoded = env?.STARA_DISPATCH_PAYLOAD;
    requireValue(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 5464);
    const rawDispatch = Buffer.from(encoded, 'base64');
    requireValue(rawDispatch.toString('base64') === encoded);
    const dispatch = parseDispatch(rawDispatch);
    request ??= createAuthenticatedRequest({ clock });
    const bucket = uri.slice('gs://'.length).split('/')[0];
    const response = await bounded({ clock }, (scope) =>
      request(
        `https://storage.googleapis.com/storage/v1/b/${bucket}/o/targets%2Fstaging.json?alt=media`,
        {
          method: 'GET',
          headers: {},
          responseType: 'bytes',
          maxBytes: 65536,
          signal: scope.signal,
          deadline: clock.now() + scope.remaining(),
        },
      ),
    );
    requireValue(response?.status === 200 && response.body instanceof Uint8Array);
    const rawConfig = originalBytes(response.body, 65536);
    const configurationSha256 = createHash('sha256').update(rawConfig).digest('hex');
    requireValue(configurationSha256 === dispatch.configurationSha256);
    const configuration = (factories.readPrivateConfiguration ?? readPrivateConfiguration)(
      rawConfig,
    );
    const store = (factories.createCloudStore ?? createCloudStore)({ configuration, request });
    const adapters = (factories.createCloudAdapters ?? createCloudAdapters)({
      configuration,
      request,
      verifyAttestation,
      clock,
    });
    const executor = (factories.createExecutor ?? createExecutor)({
      config: {
        targetId: configuration.targetId,
        environment: configuration.environment,
        configurationSha256,
        policy: configuration.policy,
      },
      store,
      adapters,
      clock,
    });
    const result = await executor.run(rawDispatch);
    requireValue(
      ['running', 'succeeded', 'failed', 'degraded', 'reconciliation_required'].includes(
        result?.status,
      ),
    );
    return { status: result.status };
  } catch {
    throw failure();
  }
}
