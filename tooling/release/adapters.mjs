import { createHash } from 'node:crypto';
import { isDeepStrictEqual, TextDecoder } from 'node:util';
import { URLSearchParams } from 'node:url';
import { parse } from 'parse5';
import { parseDocument } from 'yaml';
import { parseManifest, validateEvidence, validateProvenance } from './contract.mjs';

const components = ['web', 'api'];
const hashPattern = /^[a-f0-9]{64}$/;
const sourcePattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const projectPattern = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const namePattern = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const workflowRoot = 'stara-labs/stara/.github/workflows/';
const mainRef = '@refs/heads/main';
const github = 'https://api.github.com/repos/stara-labs/stara';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const header = (response, name) =>
  Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
const error = (code = 'DENIED') => Object.assign(new Error('Release operation denied'), { code });
function requireValue(value, code) {
  if (!value) throw error(code);
}
function matches(value, pattern) {
  return typeof value === 'string' && value.match(pattern)?.[0] === value;
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function shape(value, fields) {
  requireValue(
    object(value) &&
      Object.keys(value).length === fields.length &&
      fields.every((key) => Object.hasOwn(value, key)),
  );
}
function rawBytes(raw, limit) {
  requireValue(typeof raw === 'string' || raw instanceof Uint8Array);
  requireValue(typeof raw !== 'string' || raw.isWellFormed());
  const bytes = Buffer.from(raw);
  requireValue(bytes.length > 0 && bytes.length <= limit);
  return bytes;
}
function json(raw, limit = 1048576) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      rawBytes(raw, limit),
    );
    const value = JSON.parse(text);
    const document = parseDocument(text, {
      schema: 'json',
      uniqueKeys: true,
      strict: true,
      prettyErrors: false,
    });
    requireValue(document.errors.length === 0);
    return value;
  } catch {
    throw error();
  }
}
function strings(values) {
  requireValue(Array.isArray(values) && values.length > 0 && values.length <= 100);
  requireValue(
    values.every(
      (value) =>
        typeof value === 'string' && /^[\x20-\x7e]{1,150}$/.test(value) && value.trim() === value,
    ),
  );
  requireValue(new Set(values).size === values.length);
}

export function readPrivateConfiguration(raw) {
  const config = json(raw, 65536);
  shape(config, [
    'schemaVersion',
    'targetId',
    'environment',
    'policy',
    'projectId',
    'region',
    'services',
    'runtimeServiceAccounts',
    'imageRepositories',
    'artifactBucket',
    'stateBucket',
    'stagingOrigin',
    'executorServiceAccount',
    'loggingProjectId',
  ]);
  requireValue(
    config.schemaVersion === 1 &&
      config.environment === 'staging' &&
      config.region === 'us-central1',
  );
  requireValue(matches(config.targetId, /^[a-z][a-z0-9-]{0,62}$/));
  requireValue(
    matches(config.projectId, projectPattern) &&
      matches(config.loggingProjectId, projectPattern) &&
      config.projectId !== config.loggingProjectId,
  );
  requireValue(config.stagingOrigin === 'https://staging.app.stara.co');
  for (const field of ['services', 'runtimeServiceAccounts', 'imageRepositories'])
    shape(config[field], components);
  for (const part of components) {
    requireValue(matches(config.services[part], namePattern));
    requireValue(
      matches(
        config.runtimeServiceAccounts[part],
        new RegExp(
          `^[a-z][a-z0-9-]{4,28}[a-z0-9]@${config.projectId}\\.iam\\.gserviceaccount\\.com$`,
        ),
      ),
    );
    requireValue(
      matches(
        config.imageRepositories[part],
        new RegExp(
          `^us-central1-docker\\.pkg\\.dev/${config.loggingProjectId}/[a-z][a-z0-9-]{0,62}/[a-z][a-z0-9-]{0,62}$`,
        ),
      ),
    );
  }
  for (const field of ['services', 'runtimeServiceAccounts', 'imageRepositories'])
    requireValue(config[field].web !== config[field].api);
  for (const bucket of ['artifactBucket', 'stateBucket'])
    requireValue(matches(config[bucket], /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/));
  requireValue(config.artifactBucket !== config.stateBucket);
  requireValue(
    matches(
      config.executorServiceAccount,
      new RegExp(
        `^[a-z][a-z0-9-]{4,28}[a-z0-9]@${config.loggingProjectId}\\.iam\\.gserviceaccount\\.com$`,
      ),
    ),
  );
  const policy = config.policy;
  shape(policy, ['repositoryId', 'workflows', 'provenanceWorkflowRef', 'requiredTargets']);
  requireValue(policy.repositoryId === '1363262992');
  shape(policy.workflows, ['scaffold', 'codeql', 'images']);
  for (const [kind, file] of [
    ['scaffold', 'checks.yml'],
    ['images', 'release.yml'],
  ]) {
    shape(policy.workflows[kind], ['workflowRef', 'jobs']);
    requireValue(policy.workflows[kind].workflowRef === `${workflowRoot}${file}${mainRef}`);
    strings(policy.workflows[kind].jobs);
  }
  shape(policy.workflows.codeql, ['workflowRef', 'jobs']);
  requireValue(policy.workflows.codeql.workflowRef === 'dynamic/github-code-scanning/codeql');
  strings(policy.workflows.codeql.jobs);
  requireValue(
    JSON.stringify([...policy.workflows.codeql.jobs].sort()) ===
      JSON.stringify(['Analyze (actions)', 'Analyze (javascript-typescript)']),
  );
  requireValue(policy.provenanceWorkflowRef === `${workflowRoot}release.yml${mainRef}`);
  strings(policy.requiredTargets);
  requireValue(
    JSON.stringify([...policy.requiredTargets].sort()) ===
      JSON.stringify(['@stara/api', '@stara/tooling', '@stara/ui', '@stara/web']),
  );
  return config;
}

function media(bucket, key) {
  return `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(key)}?alt=media`;
}
async function send(request, url, options, mutation = false) {
  let response;
  try {
    response = await request(url, { headers: {}, ...options });
  } catch {
    throw error(mutation ? 'UNKNOWN_OUTCOME' : 'TRANSIENT_READ');
  }
  requireValue(Number.isInteger(response?.status), mutation ? 'UNKNOWN_OUTCOME' : 'DENIED');
  if (response.status < 200 || response.status >= 300) {
    const code = mutation
      ? [400, 401, 403, 404, 409, 412, 422, 429].includes(response.status)
        ? 'NO_EFFECT'
        : 'UNKNOWN_OUTCOME'
      : response.status === 429 || response.status >= 500
        ? 'TRANSIENT_READ'
        : 'DENIED';
    throw error(code);
  }
  return response;
}
export function createCloudStore({ configuration, request }) {
  const config = readPrivateConfiguration(JSON.stringify(configuration));
  const key = `targets/${config.targetId}.json`;
  const terminal = ['succeeded', 'failed', 'degraded'];
  function identity(targetId, receiptId) {
    requireValue(targetId === config.targetId && matches(receiptId, hashPattern));
  }
  function record(value, receiptId, archived = false) {
    requireValue(object(value) && value.schemaVersion === 1);
    requireValue(value.receiptId === receiptId && value.targetId === config.targetId);
    requireValue(matches(value.sourceSha, sourcePattern));
    requireValue(matches(value.manifestSha256, hashPattern));
    requireValue(matches(value.configurationSha256, hashPattern));
    requireValue([...terminal, 'running', 'reconciliation_required'].includes(value.status));
    requireValue(Number.isSafeInteger(value.startedAt) && value.startedAt >= 0);
    requireValue(value.totalDeadline === value.startedAt + 1800000);
    requireValue(Array.isArray(value.effects) && Array.isArray(value.reads));
    requireValue(object(value.revisions) && object(value.notification));
    if (archived) {
      requireValue(terminal.includes(value.status) && value.outcome === value.status);
      requireValue(Number.isSafeInteger(value.finishedAt) && value.finishedAt >= value.startedAt);
      requireValue(value.pendingEffect === null && value.serviceStateKnown === true);
      requireValue(
        value.effects.every((effect) => !['pending', 'unknown'].includes(effect.outcome)),
      );
    }
    return value;
  }
  function stateValue(raw) {
    const state = json(raw);
    shape(state, ['lock', 'receipts']);
    requireValue(object(state.receipts));
    const ids = Object.keys(state.receipts);
    requireValue(ids.length <= 1);
    if (state.lock === null) requireValue(ids.length === 0);
    else {
      shape(state.lock, ['receiptId', 'ownerId']);
      requireValue(matches(state.lock.receiptId, hashPattern));
      requireValue(matches(state.lock.ownerId, /^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/));
      requireValue(ids.length === 1 && ids[0] === state.lock.receiptId);
      record(state.receipts[ids[0]], ids[0]);
    }
    return state;
  }
  async function readObject(objectKey) {
    let response;
    try {
      response = await request(media(config.stateBucket, objectKey), {
        method: 'GET',
        headers: {},
        responseType: 'bytes',
        maxBytes: 1048576,
      });
    } catch {
      throw error();
    }
    if (response?.status === 404) return null;
    requireValue(response?.status === 200);
    const generation = header(response, 'x-goog-generation');
    requireValue(matches(generation, /^[1-9][0-9]*$/));
    return { bytes: rawBytes(response.body, 1048576), generation };
  }
  async function selected(receiptId) {
    const result = await readObject(key);
    const state = result ? stateValue(result.bytes) : { lock: null, receipts: {} };
    const view = structuredClone(state);
    let historical = false;
    // The active record outranks an archive left by interrupted finalization.
    if (!Object.hasOwn(state.receipts, receiptId)) {
      const archive = await readObject(`receipts/${receiptId}.json`);
      if (archive) {
        view.receipts[receiptId] = record(json(archive.bytes), receiptId, true);
        historical = true;
      }
    }
    return { state, view, historical, generation: result?.generation ?? '0' };
  }
  async function writeObject(objectKey, bytes, generation) {
    const url = new URL(
      `https://storage.googleapis.com/upload/storage/v1/b/${config.stateBucket}/o`,
    );
    url.search = new URLSearchParams({
      uploadType: 'media',
      name: objectKey,
      ifGenerationMatch: generation,
    }).toString();
    let result;
    try {
      result = await request(url.href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: bytes,
        responseType: 'json',
        maxBytes: 1048576,
      });
    } catch {
      throw error('UNKNOWN_OUTCOME');
    }
    if (result?.status === 412) return false;
    requireValue(
      result?.status === 200 &&
        result.body?.name === objectKey &&
        matches(result.body?.generation, /^[1-9][0-9]*$/),
      'UNKNOWN_OUTCOME',
    );
    return true;
  }
  async function archive(receiptId, bytes) {
    const archiveKey = `receipts/${receiptId}.json`;
    if (await writeObject(archiveKey, bytes, '0')) return;
    const existing = await readObject(archiveKey);
    requireValue(existing && existing.bytes.equals(bytes), 'CONFLICT');
  }
  return {
    async read(targetId, receiptId) {
      identity(targetId, receiptId);
      return (await selected(receiptId)).view;
    },
    async transact(targetId, receiptId, action) {
      identity(targetId, receiptId);
      requireValue(typeof action === 'function');
      let frozen;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await selected(receiptId);
        let next = frozen?.next;
        if (frozen) {
          requireValue(isDeepStrictEqual(current.state, frozen.original), 'CONFLICT');
        } else {
          try {
            next = structuredClone(await action(structuredClone(current.view)));
          } catch {
            throw error();
          }
          shape(next, ['state', 'value']);
          if (isDeepStrictEqual(next.state, current.view)) return next.value;
          requireValue(!current.historical);
          requireValue(current.state.lock === null || current.state.lock.receiptId === receiptId);
          shape(next.state, ['lock', 'receipts']);
          requireValue(object(next.state.receipts));
          requireValue(Object.keys(next.state.receipts).length === 1);
          const receipt = record(next.state.receipts[receiptId], receiptId);
          const previous = current.state.receipts[receiptId];
          if (previous) {
            for (const field of [
              'sourceSha',
              'manifestSha256',
              'configurationSha256',
              'startedAt',
              'totalDeadline',
            ])
              requireValue(receipt[field] === previous[field]);
          }
          if (next.state.lock === null) {
            requireValue(current.state.lock?.receiptId === receiptId);
            record(receipt, receiptId, true);
            const bytes = rawBytes(Buffer.from(JSON.stringify(receipt)), 1048576);
            // Freeze the terminal result before the first archive write. A release
            // CAS conflict may refresh its generation, never its outcome or timestamp.
            frozen = { original: current.state, next };
            await archive(receiptId, bytes);
          } else {
            if (current.state.lock)
              requireValue(isDeepStrictEqual(next.state.lock, current.state.lock));
            requireValue(next.state.lock.receiptId === receiptId);
          }
        }
        const persisted = frozen ? { lock: null, receipts: {} } : next.state;
        const bytes = Buffer.from(JSON.stringify(persisted));
        stateValue(bytes);
        if (await writeObject(key, bytes, current.generation)) return next.value;
      }
      throw error('CONFLICT');
    },
  };
}

export function createCloudAdapters({ configuration, request, verifyAttestation, clock }) {
  const config = readPrivateConfiguration(JSON.stringify(configuration));
  const scope = `projects/${config.projectId}/locations/${config.region}`;
  const createdImages = new Map();
  function guard(args, code = 'DENIED') {
    requireValue(args.targetId === config.targetId && matches(args.receiptId, hashPattern), code);
    requireValue(Number.isSafeInteger(args.deadline) && args.deadline > clock.now(), code);
    requireValue(args.signal instanceof AbortSignal && !args.signal.aborted, code);
  }
  const serviceName = (part) => {
    requireValue(components.includes(part));
    return `${scope}/services/${config.services[part]}`;
  };
  function revisionName(part, value) {
    const prefix = `${serviceName(part)}/revisions/`;
    const name =
      typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : value;
    requireValue(
      matches(name, new RegExp(`^${config.services[part]}-[a-z0-9-]+$`)) && name.length <= 63,
    );
    return `${prefix}${name}`;
  }
  async function http(
    args,
    url,
    responseType = 'json',
    method = 'GET',
    body,
    headers = {},
    maxBytes = 1048576,
  ) {
    guard(args, method === 'GET' ? 'DENIED' : 'NO_EFFECT');
    return send(
      request,
      url,
      {
        method,
        headers,
        body,
        signal: args.signal,
        deadline: args.deadline,
        responseType,
        maxBytes,
      },
      method !== 'GET',
    );
  }
  async function download(args, key, limit) {
    const response = await http(args, media(config.artifactBucket, key), 'bytes');
    return rawBytes(response.body, limit);
  }
  async function getService(args) {
    const name = serviceName(args.component);
    const response = (await http(args, `https://run.googleapis.com/v2/${name}`)).body;
    requireValue(
      response?.name === name && typeof response.etag === 'string' && response.etag.length > 0,
    );
    requireValue(
      response.ingress === 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER' &&
        response.invokerIamDisabled !== true &&
        response.defaultUriDisabled === true,
    );
    return response;
  }
  function pinnedTraffic(part, service) {
    let traffic = service.traffic;
    requireValue(Array.isArray(traffic) && traffic.length > 0 && traffic.length <= 100);
    if (traffic.some((item) => item.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST'))
      traffic = service.trafficStatuses;
    requireValue(Array.isArray(traffic) && traffic.length > 0 && traffic.length <= 100);
    const result = traffic.map((item) => {
      requireValue(Number.isInteger(item.percent) && item.percent >= 0 && item.percent <= 100);
      const revision = revisionName(part, item.revision).split('/').at(-1);
      return { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: item.percent };
    });
    requireValue(result.reduce((sum, item) => sum + item.percent, 0) === 100);
    return result;
  }
  async function pause(args) {
    guard(args);
    await clock.sleep(Math.min(1000, args.deadline - clock.now()));
    guard(args);
  }
  async function patch(args, body, updateMask) {
    let started = false;
    try {
      guard(args, 'NO_EFFECT');
      started = true;
      let operation = (
        await http(
          args,
          `https://run.googleapis.com/v2/${serviceName(args.component)}?updateMask=${updateMask}&allowMissing=false`,
          'json',
          'PATCH',
          body,
        )
      ).body;
      const name = operation?.name;
      requireValue(
        typeof name === 'string' &&
          name.startsWith(`${scope}/operations/`) &&
          matches(name.slice(`${scope}/operations/`.length), /^[a-zA-Z0-9-]{1,128}$/),
        'UNKNOWN_OUTCOME',
      );
      while (true) {
        requireValue(operation.name === name && !operation.error, 'UNKNOWN_OUTCOME');
        if (operation.done === true) {
          requireValue(operation.response?.name === serviceName(args.component), 'UNKNOWN_OUTCOME');
          return { operationId: name, service: operation.response };
        }
        guard(args);
        operation = (await http(args, `https://run.googleapis.com/v2/${name}`)).body;
        if (operation?.done !== true) await pause(args);
      }
    } catch (failure) {
      throw error(failure.code === 'NO_EFFECT' || !started ? 'NO_EFFECT' : 'UNKNOWN_OUTCOME');
    }
  }
  async function mutation(action) {
    try {
      return await action();
    } catch (failure) {
      throw error(failure.code === 'UNKNOWN_OUTCOME' ? 'UNKNOWN_OUTCOME' : 'NO_EFFECT');
    }
  }
  return {
    async loadManifest(args) {
      guard(args);
      requireValue(matches(args.manifestSha256, hashPattern) && args.maxBytes === 65536);
      return download(args, `manifests/${args.manifestSha256}.json`, 65536);
    },
    async collectEvidence(args) {
      guard(args);
      const raw = Buffer.from(JSON.stringify(args.manifest));
      const manifest = parseManifest(raw, sha256(raw));
      requireValue(args.sourceSha === manifest.sourceSha);
      const repo = (await http(args, github)).body;
      requireValue(
        String(repo.id) === config.policy.repositoryId &&
          repo.full_name === 'stara-labs/stara' &&
          repo.default_branch === 'main' &&
          String(repo.owner?.id) === '293455507',
      );
      const main = (await http(args, `${github}/git/ref/heads/main`)).body;
      requireValue(main.ref === 'refs/heads/main' && main.object?.type === 'commit');
      const runs = [];
      for (const kind of ['scaffold', 'codeql', 'images']) {
        const expected = manifest.runs[kind];
        const path = `${github}/actions/runs/${expected.id}/attempts/${expected.attempt}`;
        let selectedOrdinal;
        if (kind === 'codeql') {
          const query = new URLSearchParams({
            head_sha: manifest.sourceSha,
            branch: 'main',
            event: 'push',
            per_page: '100',
            page: '1',
          });
          const inventory = await http(args, `${github}/actions/workflows/355366692/runs?${query}`);
          const { total_count: count, workflow_runs: entries } = inventory.body;
          requireValue(
            Number.isSafeInteger(count) &&
              count > 0 &&
              count <= 100 &&
              Array.isArray(entries) &&
              entries.length === count &&
              !header(inventory, 'link'),
          );
          const ids = new Set();
          for (const entry of entries) {
            requireValue(object(entry));
            requireValue(
              typeof entry.id === 'string' || (Number.isSafeInteger(entry.id) && entry.id > 0),
            );
            const id = String(entry.id);
            requireValue(matches(id, /^[1-9][0-9]*$/) && !ids.has(id));
            ids.add(id);
            requireValue(Number.isSafeInteger(entry.run_attempt) && entry.run_attempt > 0);
            requireValue(Number.isSafeInteger(entry.run_number) && entry.run_number > 0);
            requireValue(
              String(entry.workflow_id) === '355366692' &&
                entry.path === config.policy.workflows.codeql.workflowRef &&
                String(entry.repository?.id) === config.policy.repositoryId &&
                String(entry.head_repository?.id) === config.policy.repositoryId &&
                entry.head_sha === manifest.sourceSha &&
                entry.head_branch === 'main' &&
                entry.event === 'push',
            );
          }
          // GitHub's workflow ordinal establishes order; run IDs and list order do not.
          selectedOrdinal = Math.max(...entries.map((entry) => entry.run_number));
          const newest = entries.filter((entry) => entry.run_number === selectedOrdinal);
          requireValue(newest.length === 1);
          requireValue(
            String(newest[0].id) === expected.id &&
              newest[0].run_attempt === expected.attempt &&
              newest[0].status === 'completed' &&
              newest[0].conclusion === 'success',
          );
        }
        const checkedRun = (run) => {
          requireValue(String(run.id) === expected.id && run.run_attempt === expected.attempt);
          requireValue(
            String(run.repository?.id) === config.policy.repositoryId &&
              String(run.head_repository?.id) === config.policy.repositoryId &&
              run.head_branch === 'main' &&
              run.head_sha === manifest.sourceSha &&
              run.event === 'push' &&
              run.status === 'completed' &&
              run.conclusion === 'success',
          );
          const ref = kind === 'codeql' ? run.path : `stara-labs/stara/${run.path}${mainRef}`;
          requireValue(ref === config.policy.workflows[kind].workflowRef);
          if (kind === 'codeql') {
            requireValue(String(run.workflow_id) === '355366692');
            requireValue(run.run_number === selectedOrdinal);
          }
          return run;
        };
        // Historical successful attempts cannot conceal a later failed or pending rerun.
        checkedRun((await http(args, `${github}/actions/runs/${expected.id}`)).body);
        const run = checkedRun((await http(args, path)).body);
        if (kind === 'codeql') {
          const workflow = (await http(args, `${github}/actions/workflows/355366692`)).body;
          requireValue(
            String(workflow?.id) === '355366692' &&
              workflow.path === config.policy.workflows.codeql.workflowRef &&
              workflow.state === 'active',
          );
        }
        const workflowRef = config.policy.workflows[kind].workflowRef;
        const inventory = await http(args, `${path}/jobs?per_page=100`);
        requireValue(
          Array.isArray(inventory.body?.jobs) &&
            inventory.body.total_count === inventory.body.jobs.length &&
            inventory.body.total_count <= 100 &&
            !header(inventory, 'link'),
        );
        const jobs = inventory.body.jobs.map((job) => {
          requireValue(
            String(job.run_id) === expected.id &&
              job.run_attempt === expected.attempt &&
              job.head_sha === manifest.sourceSha,
          );
          return { name: job.name, status: job.status, conclusion: job.conclusion };
        });
        runs.push({
          id: String(run.id),
          attempt: run.run_attempt,
          workflowRef,
          headSha: run.head_sha,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
          jobs,
        });
      }
      const run = manifest.runs.scaffold;
      const coverage = json(
        await download(
          args,
          `coverage/${manifest.sourceSha}/${run.id}-${run.attempt}.json`,
          1048576,
        ),
      );
      const evidence = {
        repositoryId: String(repo.id),
        sourceSha: manifest.sourceSha,
        currentMainSha: main.object.sha,
        runs,
        coverage,
      };
      validateEvidence(manifest, evidence, config.policy);
      return evidence;
    },
    async verifyProvenance(args) {
      guard(args);
      requireValue(components.includes(args.component));
      const raw = Buffer.from(JSON.stringify(args.manifest));
      const manifest = parseManifest(raw, sha256(raw));
      const image = manifest.images[args.component];
      const bundle = await download(args, `attestations/${image.attestationSha256}.jsonl`, 1048576);
      requireValue(sha256(bundle) === image.attestationSha256);
      let facts;
      try {
        facts = await verifyAttestation({
          bundle,
          component: args.component,
          subjectName: `stara/${args.component}`,
          imageRepository: config.imageRepositories[args.component],
          imageDigest: image.digest,
          sourceSha: manifest.sourceSha,
          runId: manifest.runs.images.id,
          runAttempt: manifest.runs.images.attempt,
          repositoryId: config.policy.repositoryId,
          workflowRef: config.policy.provenanceWorkflowRef,
          signal: args.signal,
          deadline: args.deadline,
        });
      } catch {
        throw error();
      }
      validateProvenance(manifest, args.component, facts, config.policy);
      return facts;
    },
    async createRevision(args) {
      return mutation(async () => {
        guard(args, 'NO_EFFECT');
        requireValue(matches(args.imageDigest, digestPattern));
        const current = await getService(args);
        const traffic = pinnedTraffic(args.component, current);
        requireValue(current.template?.containers?.length === 1);
        const revision = `${config.services[args.component].slice(0, 30)}-${args.receiptId.slice(0, 24)}`;
        const template = structuredClone(current.template);
        delete template.containers[0].buildInfo;
        template.revision = revision;
        template.serviceAccount = config.runtimeServiceAccounts[args.component];
        template.containers[0].image = `${config.imageRepositories[args.component]}@${args.imageDigest}`;
        const result = await patch(
          args,
          { name: current.name, etag: current.etag, template, traffic },
          'template,traffic',
        );
        const observed = revisionName(args.component, result.service.latestCreatedRevision);
        requireValue(observed === revisionName(args.component, revision), 'UNKNOWN_OUTCOME');
        createdImages.set(observed, template.containers[0].image);
        return { revision: observed };
      });
    },
    async waitReady(args) {
      guard(args);
      const name = revisionName(args.component, args.revision);
      while (true) {
        const revision = (await http(args, `https://run.googleapis.com/v2/${name}`)).body;
        requireValue(revision?.name === name && Array.isArray(revision.conditions));
        const ready = revision.conditions.filter((condition) => condition.type === 'Ready');
        requireValue(ready.length === 1 && ready[0].state !== 'CONDITION_FAILED');
        if (ready[0].state === 'CONDITION_SUCCEEDED') {
          requireValue(
            revision.containers?.length === 1 &&
              matches(revision.containers[0].image?.split('@')[1], digestPattern),
          );
          requireValue(
            revision.containers[0].image.startsWith(`${config.imageRepositories[args.component]}@`),
          );
          requireValue(
            !createdImages.has(name) || createdImages.get(name) === revision.containers[0].image,
          );
          return { ready: true };
        }
        requireValue(['CONDITION_PENDING', 'CONDITION_RECONCILING'].includes(ready[0].state));
        await pause(args);
      }
    },
    async readTraffic(args) {
      guard(args);
      const result = {};
      for (const component of components)
        result[component] = pinnedTraffic(component, await getService({ ...args, component }));
      return result;
    },
    async switchTraffic(args) {
      return mutation(async () => {
        guard(args, 'NO_EFFECT');
        const revision = revisionName(args.component, args.revision).split('/').at(-1);
        const current = await getService(args);
        const traffic = [
          { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100 },
        ];
        const result = await patch(
          args,
          { name: current.name, etag: current.etag, traffic },
          'traffic',
        );
        requireValue(
          JSON.stringify(pinnedTraffic(args.component, result.service)) === JSON.stringify(traffic),
          'UNKNOWN_OUTCOME',
        );
        return { operationId: result.operationId };
      });
    },
    async probe(args) {
      guard(args);
      const iat = Math.floor(clock.now() / 1000);
      const exp = Math.min(iat + 300, Math.floor(args.deadline / 1000));
      requireValue(exp > iat);
      const account = config.executorServiceAccount;
      const signed = (
        await http(
          args,
          `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(account)}:signJwt`,
          'json',
          'POST',
          {
            payload: JSON.stringify({
              iss: account,
              sub: account,
              aud: `${config.stagingOrigin}/*`,
              iat,
              exp,
            }),
          },
        )
      ).body;
      requireValue(
        typeof signed?.signedJwt === 'string' &&
          signed.signedJwt.length > 0 &&
          signed.signedJwt.length < 16384 &&
          !/[\r\n]/.test(signed.signedJwt),
      );
      const headers = { authorization: `Bearer ${signed.signedJwt}` };
      async function get(path, type) {
        const response = await http(
          args,
          `${config.stagingOrigin}${path}`,
          'bytes',
          'GET',
          undefined,
          headers,
          5242880,
        );
        requireValue(
          response.status === 200 && matches(header(response, 'content-type')?.split(';')[0], type),
        );
        return rawBytes(response.body, 5242880);
      }
      const health = json(await get('/api/health', /^application\/json$/));
      shape(health, ['status']);
      requireValue(health.status === 'ok');
      const runtime = json(await get('/api/runtime-config', /^application\/json$/));
      shape(runtime, ['schemaVersion', 'environment']);
      requireValue(runtime.schemaVersion === 1 && runtime.environment === 'staging');
      const html = parse(
        new TextDecoder('utf-8', { fatal: true }).decode(await get('/', /^text\/html$/)),
      );
      const assets = new Map();
      let mount = false;
      let module = false;
      function inspect(node) {
        const attrs = Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
        if (node.tagName === 'base') throw error();
        if (node.tagName === 'div' && attrs.id === 'root') mount = true;
        const script = node.tagName === 'script' && attrs.type === 'module';
        if (script || (node.tagName === 'link' && attrs.rel === 'stylesheet')) {
          const path = script ? attrs.src : attrs.href;
          requireValue(matches(path, /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css)$/));
          assets.set(path, script ? /^(?:text|application)\/javascript$/ : /^text\/css$/);
          if (script) module = true;
        }
        for (const child of node.childNodes ?? []) inspect(child);
      }
      inspect(html);
      requireValue(mount && module && assets.size <= 100);
      for (const [path, type] of assets) await get(path, type);
      return { ok: true };
    },
    async notify(args) {
      return mutation(async () => {
        guard(args, 'NO_EFFECT');
        requireValue(
          matches(args.sourceSha, sourcePattern) &&
            ['succeeded', 'failed', 'degraded', 'reconciliation_required'].includes(args.status),
        );
        await http(args, 'https://logging.googleapis.com/v2/entries:write', 'json', 'POST', {
          entries: [
            {
              logName: `projects/${config.loggingProjectId}/logs/stara-release`,
              resource: { type: 'global', labels: { project_id: config.loggingProjectId } },
              severity: args.status === 'succeeded' ? 'INFO' : 'ERROR',
              insertId: `${args.receiptId}-${args.status}`,
              jsonPayload: {
                event: 'release_terminal',
                status: args.status,
                receiptId: args.receiptId,
                sourceSha: args.sourceSha,
              },
            },
          ],
        });
      });
    },
  };
}
