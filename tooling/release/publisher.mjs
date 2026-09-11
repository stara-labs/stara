import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { URLSearchParams } from 'node:url';
import { parseDocument } from 'yaml';
import { parseDispatch, parseManifest } from './contract.mjs';

const repositoryId = '1363262992';
const workflowRef = 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main';
const dispatchRef = 'stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main';
const targets = ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'];
const sourcePattern = /^[0-9a-f]{40}$/;
const decimalPattern = /^[1-9][0-9]*$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const project = '[a-z][a-z0-9-]{4,28}[a-z0-9]';
const maximumBytes = 1024 * 1024;
const denied = () => new Error('Release publication denied or outcome unknown');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function requireValue(condition) {
  if (!condition) throw denied();
}

function matches(value, expression) {
  return typeof value === 'string' && value.match(expression)?.[0] === value;
}

function shape(value, keys) {
  requireValue(value && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  requireValue(Reflect.ownKeys(value).length === keys.length);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
  }
}

function originalBytes(value) {
  requireValue(value instanceof Uint8Array && value.byteLength > 0);
  requireValue(value.byteLength <= maximumBytes);
  return Buffer.from(value);
}

function strictJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
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

function authority(env, kind) {
  requireValue(env && typeof env === 'object');
  requireValue(env.GITHUB_REPOSITORY === 'stara-labs/stara');
  requireValue(env.GITHUB_REPOSITORY_ID === repositoryId);
  requireValue(env.GITHUB_REPOSITORY_OWNER_ID === '293455507');
  requireValue(env.GITHUB_REF === 'refs/heads/main');
  requireValue(env.GITHUB_EVENT_NAME === (kind === 'publisher' ? 'push' : 'workflow_run'));
  requireValue(env.GITHUB_WORKFLOW_REF === (kind === 'publisher' ? workflowRef : dispatchRef));
}

function lifetime(clock) {
  requireValue(clock && typeof clock.now === 'function');
  const started = clock.now();
  requireValue(Number.isFinite(started));
  const expires = started + 15 * 60_000;
  return async (limit, operation) => {
    let timer;
    const controller = new AbortController();
    try {
      const now = clock.now();
      requireValue(Number.isFinite(now) && now >= started && now < expires);
      const duration = Math.min(limit, expires - now);
      const deadline = now + duration;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(denied());
        }, duration);
      });
      const result = await Promise.race([
        Promise.resolve().then(() => operation(controller.signal, deadline, duration)),
        timeout,
      ]);
      requireValue(clock.now() < deadline && !controller.signal.aborted);
      return result;
    } catch {
      throw denied();
    } finally {
      clearTimeout(timer);
    }
  };
}

function googlePost(request, bound) {
  requireValue(typeof request === 'function');
  return (url, data, headers) =>
    bound(30_000, (signal, _deadline, timeout) =>
      request({
        url,
        method: 'POST',
        data,
        ...(headers ? { headers } : {}),
        signal,
        timeout,
        retry: false,
        redirect: 'error',
        maxContentLength: maximumBytes,
      }),
    );
}

function checkCoverage(raw, sourceSha) {
  const reports = strictJson(raw);
  requireValue(Array.isArray(reports) && reports.length === targets.length);
  const seen = new Set();
  for (const report of reports) {
    shape(report, ['target', 'sourceSha', 'complete', 'lines', 'branches']);
    requireValue(targets.includes(report.target) && !seen.has(report.target));
    seen.add(report.target);
    requireValue(report.sourceSha === sourceSha && report.complete === true);
    requireValue(Number.isFinite(report.lines) && report.lines >= 90 && report.lines <= 100);
    requireValue(
      Number.isFinite(report.branches) && report.branches >= 85 && report.branches <= 100,
    );
  }
}

function checkBundle(bundle) {
  shape(bundle, ['mediaType', 'verificationMaterial', 'dsseEnvelope']);
  requireValue(
    typeof bundle.mediaType === 'string' &&
      bundle.mediaType.startsWith('application/vnd.dev.sigstore.bundle.'),
  );
  requireValue(bundle.verificationMaterial && bundle.dsseEnvelope);
}

export function createArtifactPublisher({ env, request, attest, verifyBundle, clock }) {
  try {
    authority(env, 'publisher');
    const sourceSha = env.GITHUB_SHA;
    const runId = env.GITHUB_RUN_ID;
    const runAttempt = Number(env.GITHUB_RUN_ATTEMPT);
    const token = env.GH_TOKEN;
    const imageRepository = env.STARA_IMAGE_REPOSITORY;
    const bucket = env.STARA_ARTIFACT_BUCKET;
    requireValue(matches(sourceSha, sourcePattern) && matches(runId, decimalPattern));
    requireValue(matches(env.GITHUB_RUN_ATTEMPT, decimalPattern));
    requireValue(Number.isSafeInteger(runAttempt));
    requireValue(typeof token === 'string' && token.trim().length > 0);
    requireValue(
      matches(imageRepository, new RegExp(`^us-central1-docker\\.pkg\\.dev/${project}/app$`)),
    );
    requireValue(matches(bucket, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/));
    requireValue(typeof attest === 'function' && typeof verifyBundle === 'function');
    const bound = lifetime(clock);
    const post = googlePost(request, bound);
    return {
      registry: {
        web: `${imageRepository}/web`,
        api: `${imageRepository}/api`,
        attest: async (input) => {
          try {
            shape(input, [
              'component',
              'subjectName',
              'subjectDigest',
              'sourceSha',
              'runId',
              'runAttempt',
              'runtime',
            ]);
            const { component, subjectDigest } = input;
            requireValue(['web', 'api'].includes(component));
            requireValue(input.subjectName === `${imageRepository}/${component}`);
            requireValue(matches(subjectDigest, digestPattern));
            requireValue(input.sourceSha === sourceSha && input.runId === runId);
            requireValue(input.runAttempt === runAttempt);
            return await bound(10 * 60_000, async (signal, deadline) => {
              const result = await attest({
                subjects: [
                  { name: `stara/${component}`, digest: { sha256: subjectDigest.slice(7) } },
                ],
                token,
                sigstore: 'public-good',
              });
              checkBundle(result?.bundle);
              const bundle = originalBytes(Buffer.from(JSON.stringify(result.bundle), 'utf8'));
              requireValue(!signal.aborted && clock.now() < deadline);
              const verification = await verifyBundle({
                bundle,
                component,
                subjectName: `stara/${component}`,
                imageRepository: `${imageRepository}/${component}`,
                imageDigest: subjectDigest,
                sourceSha,
                runId,
                runAttempt,
                repositoryId,
                workflowRef,
                signal,
                deadline,
              });
              shape(verification, [
                'verified',
                'sourceSha',
                'repositoryId',
                'workflowRef',
                'imageDigest',
                'attestationSha256',
                'runId',
                'runAttempt',
              ]);
              requireValue(verification.verified === true && verification.sourceSha === sourceSha);
              requireValue(verification.repositoryId === repositoryId);
              requireValue(verification.workflowRef === workflowRef);
              requireValue(verification.imageDigest === subjectDigest);
              requireValue(verification.attestationSha256 === hash(bundle));
              requireValue(verification.runId === runId && verification.runAttempt === runAttempt);
              return { bundle, verification };
            });
          } catch {
            throw denied();
          }
        },
      },
      storage: {
        put: async (input) => {
          try {
            shape(input, ['key', 'bytes', 'ifAbsent']);
            requireValue(input.ifAbsent === true);
            const raw = originalBytes(input.bytes);
            const key = input.key;
            if (matches(key, /^attestations\/[0-9a-f]{64}\.jsonl$/)) {
              requireValue(key === `attestations/${hash(raw)}.jsonl`);
              checkBundle(strictJson(raw));
            } else if (matches(key, /^manifests\/[0-9a-f]{64}\.json$/)) {
              const manifest = parseManifest(raw, key.slice(10, -5));
              requireValue(
                manifest.sourceSha === sourceSha && manifest.repositoryId === repositoryId,
              );
            } else {
              requireValue(
                matches(key, new RegExp(`^coverage/${sourceSha}/[1-9][0-9]*-[1-9][0-9]*\\.json$`)),
              );
              checkCoverage(raw, sourceSha);
            }
            const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o`);
            url.search = new URLSearchParams({
              uploadType: 'media',
              name: key,
              ifGenerationMatch: '0',
            });
            const response = await post(url.href, raw, { 'content-type': 'application/json' });
            requireValue(response?.status === 200);
            requireValue(response.data?.name === key && response.data.bucket === bucket);
            requireValue(matches(response.data.generation, decimalPattern));
            return { created: true };
          } catch {
            throw denied();
          }
        },
      },
    };
  } catch {
    throw denied();
  }
}

export function createStagingDispatcher({ env, request, clock }) {
  try {
    authority(env, 'dispatcher');
    const topic = env.STARA_STAGING_TOPIC;
    requireValue(
      matches(topic, new RegExp(`^projects/${project}/topics/[A-Za-z][A-Za-z0-9._~-]{2,254}$`)),
    );
    const post = googlePost(request, lifetime(clock));
    return async (input) => {
      try {
        shape(input, ['topic', 'data']);
        requireValue(input.topic === topic);
        requireValue(typeof input.data === 'string' && input.data.length <= 5464);
        const bytes = Buffer.from(input.data, 'base64');
        requireValue(bytes.toString('base64') === input.data);
        parseDispatch(bytes);
        // Cloud Build binds the decoded Pub/Sub object's payload field, not the envelope.
        const data = Buffer.from(JSON.stringify({ payload: input.data })).toString('base64');
        const response = await post(`https://pubsub.googleapis.com/v1/${topic}:publish`, {
          messages: [{ data }],
        });
        requireValue(response?.status === 200);
        shape(response.data, ['messageIds']);
        requireValue(
          Array.isArray(response.data.messageIds) && response.data.messageIds.length === 1,
        );
        const id = response.data.messageIds[0];
        requireValue(matches(id, /^[A-Za-z0-9_-]{1,256}$/));
        return { messageIds: [id] };
      } catch {
        throw denied();
      }
    };
  } catch {
    throw denied();
  }
}
