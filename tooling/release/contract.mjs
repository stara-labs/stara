import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parseDocument } from 'yaml';

const sourcePattern = /^[0-9a-f]{40}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const decimalPattern = /^[1-9][0-9]*$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const versionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const components = ['web', 'api'];
const runKinds = ['scaffold', 'images', 'codeql'];
const authorizedHumans = ['JohnLozano-Stara', 'sundip'];

function requireValue(condition) {
  if (!condition) throw new Error('Release input denied');
}

function matches(value, pattern) {
  return typeof value === 'string' && value.match(pattern)?.[0] === value;
}

function text(value) {
  requireValue(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 1024 &&
      value.trim() === value &&
      !Array.from(value).some(
        (character) => character.charCodeAt(0) < 32 || character === '\x7f',
      ) &&
      value.isWellFormed(),
  );
}

function shape(value, required, optional = []) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireValue([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const keys = Reflect.ownKeys(value);
  requireValue(required.every((key) => Object.hasOwn(value, key)));
  for (const key of keys) {
    requireValue(required.includes(key) || optional.includes(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValue(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
  }
}

function list(value) {
  requireValue(Array.isArray(value) && value.length > 0 && value.length <= 10000);
  requireValue(Reflect.ownKeys(value).length === value.length + 1);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    requireValue(descriptor && Object.hasOwn(descriptor, 'value'));
  }
}

function unique(values) {
  requireValue(new Set(values).size === values.length);
}

function strings(values) {
  list(values);
  values.forEach(text);
  unique(values);
}

function bytes(raw, limit) {
  requireValue(typeof raw === 'string' || raw instanceof Uint8Array);
  if (typeof raw === 'string') requireValue(raw.isWellFormed());
  const length = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength;
  requireValue(length > 0 && length <= limit);
  return Buffer.from(raw);
}

function strictJson(raw) {
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    const value = JSON.parse(decoded);
    // JSON supplies syntax/values; YAML's maintained parser checks decoded duplicate keys.
    const document = parseDocument(decoded, {
      schema: 'json',
      uniqueKeys: true,
      strict: true,
      prettyErrors: false,
    });
    requireValue(document.errors.length === 0);
    return value;
  } catch {
    throw new Error('Invalid release JSON');
  }
}

function manifestShape(manifest) {
  shape(manifest, ['schemaVersion', 'sourceSha', 'repositoryId', 'images', 'runs']);
  requireValue(manifest.schemaVersion === 1 && matches(manifest.sourceSha, sourcePattern));
  requireValue(matches(manifest.repositoryId, decimalPattern));
  shape(manifest.images, components);
  for (const component of components) {
    const image = manifest.images[component];
    shape(image, ['digest', 'attestationSha256']);
    requireValue(matches(image.digest, digestPattern));
    requireValue(matches(image.attestationSha256, hashPattern));
  }
  shape(manifest.runs, runKinds);
  for (const kind of runKinds) {
    shape(manifest.runs[kind], ['id', 'attempt']);
    runIdentity(manifest.runs[kind]);
  }
  unique(runKinds.map((kind) => manifest.runs[kind].id));
}

function runIdentity(run) {
  requireValue(matches(run.id, decimalPattern));
  requireValue(Number.isSafeInteger(run.attempt) && run.attempt > 0);
}

function policyShape(policy) {
  shape(policy, ['repositoryId', 'workflows', 'provenanceWorkflowRef', 'requiredTargets']);
  requireValue(matches(policy.repositoryId, decimalPattern));
  shape(policy.workflows, runKinds);
  for (const kind of runKinds) {
    shape(policy.workflows[kind], ['workflowRef', 'jobs']);
    text(policy.workflows[kind].workflowRef);
    strings(policy.workflows[kind].jobs);
  }
  text(policy.provenanceWorkflowRef);
  strings(policy.requiredTargets);
}

export function parseDispatch(raw) {
  const dispatch = strictJson(bytes(raw, 4096));
  shape(dispatch, ['schemaVersion', 'sourceSha', 'manifestSha256', 'configurationSha256']);
  requireValue(dispatch.schemaVersion === 1 && matches(dispatch.sourceSha, sourcePattern));
  requireValue(matches(dispatch.manifestSha256, hashPattern));
  requireValue(matches(dispatch.configurationSha256, hashPattern));
  return dispatch;
}

export function parseManifest(raw, expectedSha256) {
  const original = bytes(raw, 65536);
  requireValue(matches(expectedSha256, hashPattern));
  requireValue(createHash('sha256').update(original).digest('hex') === expectedSha256);
  const manifest = strictJson(original);
  manifestShape(manifest);
  return manifest;
}

export function validateEvidence(manifest, evidence, policy) {
  manifestShape(manifest);
  policyShape(policy);
  shape(evidence, ['repositoryId', 'sourceSha', 'currentMainSha', 'runs', 'coverage']);
  requireValue(manifest.repositoryId === policy.repositoryId);
  requireValue(evidence.repositoryId === policy.repositoryId);
  requireValue(evidence.sourceSha === manifest.sourceSha);
  requireValue(evidence.currentMainSha === manifest.sourceSha);
  list(evidence.runs);
  for (const run of evidence.runs) {
    shape(run, [
      'id',
      'attempt',
      'workflowRef',
      'headSha',
      'event',
      'status',
      'conclusion',
      'jobs',
    ]);
    runIdentity(run);
    text(run.workflowRef);
    requireValue(matches(run.headSha, sourcePattern));
    text(run.event);
    text(run.status);
    text(run.conclusion);
    list(run.jobs);
    for (const job of run.jobs) {
      shape(job, ['name', 'status', 'conclusion']);
      text(job.name);
      text(job.status);
      text(job.conclusion);
    }
    unique(run.jobs.map((job) => job.name));
  }
  unique(evidence.runs.map((run) => run.id));
  for (const kind of runKinds) {
    const expected = manifest.runs[kind];
    const run = evidence.runs.find((entry) => entry.id === expected.id);
    requireValue(run && run.attempt === expected.attempt);
    requireValue(run.workflowRef === policy.workflows[kind].workflowRef);
    requireValue(run.headSha === manifest.sourceSha && run.event === 'push');
    requireValue(run.status === 'completed' && run.conclusion === 'success');
    for (const name of policy.workflows[kind].jobs) {
      const job = run.jobs.find((entry) => entry.name === name);
      requireValue(job && job.status === 'completed' && job.conclusion === 'success');
    }
  }
  list(evidence.coverage);
  for (const report of evidence.coverage) {
    shape(report, ['target', 'sourceSha', 'complete', 'lines', 'branches']);
    text(report.target);
    requireValue(report.sourceSha === manifest.sourceSha && report.complete === true);
    requireValue(Number.isFinite(report.lines) && report.lines >= 90 && report.lines <= 100);
    requireValue(
      Number.isFinite(report.branches) && report.branches >= 85 && report.branches <= 100,
    );
  }
  unique(evidence.coverage.map((report) => report.target));
  for (const target of policy.requiredTargets) {
    requireValue(evidence.coverage.some((report) => report.target === target));
  }
  return true;
}

export function validateProvenance(manifest, component, verification, policy) {
  manifestShape(manifest);
  policyShape(policy);
  requireValue(components.includes(component));
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
  requireValue(verification.verified === true && verification.sourceSha === manifest.sourceSha);
  requireValue(manifest.repositoryId === policy.repositoryId);
  requireValue(verification.repositoryId === policy.repositoryId);
  requireValue(verification.workflowRef === policy.provenanceWorkflowRef);
  requireValue(verification.imageDigest === manifest.images[component].digest);
  requireValue(verification.attestationSha256 === manifest.images[component].attestationSha256);
  requireValue(verification.runId === manifest.runs.images.id);
  requireValue(verification.runAttempt === manifest.runs.images.attempt);
  return true;
}

export function validateProductionApproval(request, approval, context) {
  shape(context, [
    'simulation',
    'productionEnabled',
    'now',
    'authenticatedRequester',
    'authenticatedApprover',
  ]);
  requireValue(context.simulation === true && context.productionEnabled === true);
  shape(request, ['candidateSha', 'targetId', 'requester']);
  shape(approval, ['candidateSha', 'targetId', 'approver', 'expiresAt', 'revoked']);
  requireValue(matches(request.candidateSha, sourcePattern));
  requireValue(matches(request.targetId, identifierPattern));
  requireValue(
    approval.candidateSha === request.candidateSha && approval.targetId === request.targetId,
  );
  requireValue(authorizedHumans.includes(request.requester));
  requireValue(
    authorizedHumans.includes(approval.approver) && approval.approver !== request.requester,
  );
  requireValue(context.authenticatedRequester === request.requester);
  requireValue(context.authenticatedApprover === approval.approver);
  requireValue(Number.isFinite(context.now) && Number.isFinite(approval.expiresAt));
  requireValue(approval.expiresAt > context.now && approval.revoked === false);
  return true;
}

export function publicEvidence(input) {
  shape(input, ['schemaVersion', 'sourceSha', 'synthetic', 'results'], ['version']);
  requireValue(input.schemaVersion === 1 && input.synthetic === true);
  requireValue(matches(input.sourceSha, sourcePattern));
  if (Object.hasOwn(input, 'version')) {
    requireValue(matches(input.version, versionPattern) && input.version.length <= 256);
    requireValue(
      !/(?:canary|secret|credential|password|token|private|do-not-publish)/i.test(input.version),
    );
  }
  list(input.results);
  for (const result of input.results) {
    shape(result, ['scenario', 'result', 'mode']);
    requireValue(matches(result.scenario, /^REL-(?:0[1-9]|1[01])$/));
    requireValue(['Passed', 'Failed', 'Not applicable', 'Not executed'].includes(result.result));
    requireValue(['simulation', 'live'].includes(result.mode));
  }
  return structuredClone(input);
}
