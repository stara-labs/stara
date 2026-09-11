import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

let contract;
beforeAll(async () => {
  contract = await import(
    /* @vite-ignore */ new URL('../release/contract.mjs', import.meta.url).href
  );
});

const sha = '1'.repeat(40);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const canary = 'synthetic-private-release-canary-DO-NOT-PUBLISH';
const policy = {
  repositoryId: '123456',
  workflows: {
    scaffold: {
      workflowRef: 'synthetic/stara/.github/workflows/checks.yml@refs/heads/main',
      jobs: ['Required scaffold checks'],
    },
    images: {
      workflowRef: 'synthetic/stara/.github/workflows/images.yml@refs/heads/main',
      jobs: ['verify-web', 'verify-api'],
    },
    codeql: {
      workflowRef: 'dynamic/github-code-scanning/codeql',
      jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)'],
    },
  },
  provenanceWorkflowRef: 'synthetic/stara/.github/workflows/images.yml@refs/heads/main',
  requiredTargets: ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'],
};
function manifest() {
  return {
    schemaVersion: 1,
    sourceSha: sha,
    repositoryId: policy.repositoryId,
    images: {
      web: { digest: `sha256:${'2'.repeat(64)}`, attestationSha256: '3'.repeat(64) },
      api: { digest: `sha256:${'4'.repeat(64)}`, attestationSha256: '5'.repeat(64) },
    },
    runs: {
      scaffold: { id: '101', attempt: 1 },
      images: { id: '102', attempt: 1 },
      codeql: { id: '103', attempt: 2 },
    },
  };
}
function dispatch() {
  return {
    schemaVersion: 1,
    sourceSha: sha,
    manifestSha256: hash(JSON.stringify(manifest())),
    configurationSha256: '6'.repeat(64),
  };
}
function evidence() {
  const candidate = manifest();
  return {
    repositoryId: policy.repositoryId,
    sourceSha: sha,
    currentMainSha: sha,
    runs: Object.entries(candidate.runs).map(([kind, run]) => ({
      ...run,
      workflowRef: policy.workflows[kind].workflowRef,
      headSha: sha,
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      jobs: policy.workflows[kind].jobs.map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    })),
    coverage: policy.requiredTargets.map((target) => ({
      target,
      sourceSha: sha,
      complete: true,
      lines: 90,
      branches: 85,
    })),
  };
}
function provenance(component = 'web') {
  return {
    verified: true,
    sourceSha: sha,
    repositoryId: policy.repositoryId,
    workflowRef: policy.provenanceWorkflowRef,
    imageDigest: manifest().images[component].digest,
    attestationSha256: manifest().images[component].attestationSha256,
    runId: manifest().runs.images.id,
    runAttempt: manifest().runs.images.attempt,
  };
}
function denied(action) {
  expect(action).toThrow(/\S/);
  try {
    action();
  } catch (error) {
    expect(String(error)).not.toContain(canary);
    expect(String(error.stack)).not.toContain(canary);
  }
}

describe('REL-02/03 strict immutable dispatch and manifest', () => {
  it('denies a manifest missing the required CodeQL run even when its byte hash matches', () => {
    const value = manifest();
    delete value.runs.codeql;
    const raw = JSON.stringify(value);
    denied(() => contract.parseManifest(raw, hash(raw)));
  });

  it.each(['scaffold', 'images'])('denies a CodeQL run sharing the %s run ID', (kind) => {
    const value = manifest();
    value.runs.codeql.id = value.runs[kind].id;
    const raw = JSON.stringify(value);
    denied(() => contract.parseManifest(raw, hash(raw)));
  });
  it('accepts only the configured four-field dispatch in text or UTF-8 bytes', () => {
    for (const raw of [JSON.stringify(dispatch()), Buffer.from(JSON.stringify(dispatch()))])
      expect(contract.parseDispatch(raw)).toEqual(dispatch());
  });

  it.each([
    'targetId',
    'environment',
    'command',
    'script',
    'url',
    'serviceAccount',
    'bucket',
    'images',
    'approval',
    'repository',
    '__proto__',
    'constructor',
  ])('rejects dispatch authority field %s without echoing its value', (key) => {
    const raw = JSON.stringify({ ...dispatch(), [key]: canary });
    denied(() => contract.parseDispatch(raw));
  });

  it.each([
    [
      'missing schema',
      (v) => {
        delete v.schemaVersion;
      },
    ],
    [
      'string schema',
      (v) => {
        v.schemaVersion = '1';
      },
    ],
    [
      'future schema',
      (v) => {
        v.schemaVersion = 2;
      },
    ],
    [
      'short source',
      (v) => {
        v.sourceSha = '123abcd';
      },
    ],
    [
      'upper source',
      (v) => {
        v.sourceSha = 'A'.repeat(40);
      },
    ],
    [
      'source ref',
      (v) => {
        v.sourceSha = 'refs/heads/main';
      },
    ],
    [
      'manifest prefix',
      (v) => {
        v.manifestSha256 = `sha256:${'2'.repeat(64)}`;
      },
    ],
    [
      'upper manifest',
      (v) => {
        v.manifestSha256 = 'A'.repeat(64);
      },
    ],
    [
      'configuration null',
      (v) => {
        v.configurationSha256 = null;
      },
    ],
    [
      'configuration newline',
      (v) => {
        v.configurationSha256 += '\n';
      },
    ],
  ])('denies %s', (_name, mutate) => {
    const value = dispatch();
    mutate(value);
    denied(() => contract.parseDispatch(JSON.stringify(value)));
  });

  it.each([
    ['duplicate key', () => JSON.stringify(dispatch()).replace('{', '{"schemaVersion":1,')],
    [
      'escaped duplicate key',
      () => JSON.stringify(dispatch()).replace('{', '{"\\u0073chemaVersion":1,'),
    ],
    ['array', () => JSON.stringify([dispatch()])],
    ['null', () => 'null'],
    ['trailing object', () => `${JSON.stringify(dispatch())}{}`],
    [
      'invalid UTF-8',
      () => Buffer.concat([Buffer.from(JSON.stringify(dispatch())), Buffer.from([0xc3, 0x28])]),
    ],
    ['over byte limit', () => `${JSON.stringify(dispatch())}${' '.repeat(4096)}`],
    ['object bypass', () => dispatch()],
  ])('denies %s raw dispatch', (_name, raw) => denied(() => contract.parseDispatch(raw())));

  it('enforces the 4096 byte boundary including whitespace', () => {
    const raw = JSON.stringify(dispatch());
    expect(contract.parseDispatch(raw.padEnd(4096))).toEqual(dispatch());
    denied(() => contract.parseDispatch(raw.padEnd(4097)));
  });

  it('hashes the exact manifest bytes before parsing and preserves digest identity', () => {
    const value = manifest();
    const raw = JSON.stringify(value);
    expect(contract.parseManifest(Buffer.from(raw), hash(raw))).toEqual(value);
    denied(() => contract.parseManifest(`${raw}\n`, hash(raw)));
    expect(contract.parseManifest(`${raw}\n`, hash(`${raw}\n`))).toEqual(value);
    denied(() => contract.parseManifest(raw, '0'.repeat(64)));
  });

  it.each([
    [
      'root command',
      (v) => {
        v.command = canary;
      },
    ],
    [
      'image URL',
      (v) => {
        v.images.web.url = canary;
      },
    ],
    [
      'third image',
      (v) => {
        v.images.worker = v.images.web;
      },
    ],
    [
      'run assertion',
      (v) => {
        v.runs.scaffold.conclusion = 'success';
      },
    ],
    [
      'selected jobs claim',
      (v) => {
        v.runs.images.jobs = ['verify-web'];
      },
    ],
    [
      'missing API',
      (v) => {
        delete v.images.api;
      },
    ],
    [
      'mutable tag',
      (v) => {
        v.images.web.digest = 'synthetic/web:latest';
      },
    ],
    [
      'upper digest',
      (v) => {
        v.images.api.digest = `sha256:${'A'.repeat(64)}`;
      },
    ],
    [
      'missing attestation',
      (v) => {
        delete v.images.web.attestationSha256;
      },
    ],
    [
      'repository name',
      (v) => {
        v.repositoryId = 'synthetic/stara';
      },
    ],
    [
      'numeric repository',
      (v) => {
        v.repositoryId = 123456;
      },
    ],
    [
      'zero run',
      (v) => {
        v.runs.images.id = '0';
      },
    ],
    [
      'padded run',
      (v) => {
        v.runs.images.id = '0102';
      },
    ],
    [
      'zero attempt',
      (v) => {
        v.runs.scaffold.attempt = 0;
      },
    ],
    [
      'unsafe attempt',
      (v) => {
        v.runs.scaffold.attempt = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'string attempt',
      (v) => {
        v.runs.scaffold.attempt = '1';
      },
    ],
  ])('denies manifest %s', (_name, mutate) => {
    const value = manifest();
    mutate(value);
    const raw = JSON.stringify(value);
    denied(() => contract.parseManifest(raw, hash(raw)));
  });

  it('rejects nested and escaped duplicate manifest keys even with matching byte hash', () => {
    const raw = JSON.stringify(manifest());
    for (const invalid of [
      raw.replace('"web":{', '"web":{"digest":"sha256:' + '2'.repeat(64) + '",'),
      raw.replace('"scaffold":{', '"scaffold":{"\\u0069d":"101",'),
      raw.replace('"images":{', '"images":{"__proto__":{},'),
    ])
      denied(() => contract.parseManifest(invalid, hash(invalid)));
  });

  it('bounds manifest reads and rejects invalid UTF-8 even when its digest matches', () => {
    const raw = JSON.stringify(manifest());
    expect(contract.parseManifest(raw.padEnd(65536), hash(raw.padEnd(65536)))).toEqual(manifest());
    const large = raw.padEnd(65537);
    denied(() => contract.parseManifest(large, hash(large)));
    const invalid = Buffer.concat([Buffer.from(raw), Buffer.from([0xff])]);
    denied(() => contract.parseManifest(invalid, hash(invalid)));
  });
});

describe('REL-02/03 independently fetched evidence and provenance', () => {
  it('denies provenance without certified image-run identity', () => {
    const proof = provenance();
    delete proof.runId;
    delete proof.runAttempt;
    denied(() => contract.validateProvenance(manifest(), 'web', proof, policy));
  });

  it.each([
    'missing',
    'substituted-id',
    'new-attempt',
    'wrong-path',
    'failed',
    'running',
    'missing-javascript',
    'missing-actions',
    'failed-actions',
  ])('denies CodeQL %s eligibility independently of Scaffold and images', (scenario) => {
    const candidate = manifest();
    const input = evidence();
    const run = input.runs.find((entry) => entry.id === candidate.runs.codeql.id);
    if (scenario === 'missing') input.runs = input.runs.filter((entry) => entry !== run);
    if (scenario === 'substituted-id') run.id = '999';
    if (scenario === 'new-attempt') run.attempt++;
    if (scenario === 'wrong-path') run.workflowRef = '.github/workflows/codeql.yml';
    if (scenario === 'failed') run.conclusion = 'failure';
    if (scenario === 'running') run.status = 'in_progress';
    if (scenario === 'missing-javascript')
      run.jobs = run.jobs.filter((job) => job.name !== 'Analyze (javascript-typescript)');
    if (scenario === 'missing-actions')
      run.jobs = run.jobs.filter((job) => job.name !== 'Analyze (actions)');
    if (scenario === 'failed-actions')
      run.jobs.find((job) => job.name === 'Analyze (actions)').conclusion = 'failure';
    denied(() => contract.validateEvidence(candidate, input, policy));
  });

  it('requires the private policy to declare the CodeQL workflow', () => {
    const incomplete = structuredClone(policy);
    delete incomplete.workflows.codeql;
    denied(() => contract.validateEvidence(manifest(), evidence(), incomplete));
  });
  it('accepts complete exact-run evidence at both coverage floors without mutating inputs', () => {
    const input = evidence();
    const before = structuredClone(input);
    expect(() => contract.validateEvidence(manifest(), input, policy)).not.toThrow();
    expect(input).toEqual(before);
  });

  it.each([
    [
      'other repository',
      (v) => {
        v.repositoryId = '987654';
      },
    ],
    [
      'other candidate',
      (v) => {
        v.sourceSha = 'a'.repeat(40);
      },
    ],
    [
      'superseded main',
      (v) => {
        v.currentMainSha = 'a'.repeat(40);
      },
    ],
    [
      'missing run',
      (v) => {
        v.runs.pop();
      },
    ],
    [
      'duplicate run',
      (v) => {
        v.runs.push(v.runs[0]);
      },
    ],
    [
      'substituted id',
      (v) => {
        v.runs[0].id = '999';
      },
    ],
    [
      'stale attempt',
      (v) => {
        v.runs[0].attempt = 2;
      },
    ],
    [
      'wrong workflow',
      (v) => {
        v.runs[0].workflowRef = policy.workflows.images.workflowRef;
      },
    ],
    [
      'wrong workflow ref',
      (v) => {
        v.runs[0].workflowRef = v.runs[0].workflowRef.replace('main', 'feature');
      },
    ],
    [
      'PR event',
      (v) => {
        v.runs[0].event = 'pull_request';
      },
    ],
    [
      'other run SHA',
      (v) => {
        v.runs[1].headSha = 'a'.repeat(40);
      },
    ],
    [
      'running workflow',
      (v) => {
        v.runs[0].status = 'in_progress';
      },
    ],
    [
      'failed workflow',
      (v) => {
        v.runs[0].conclusion = 'failure';
      },
    ],
    [
      'cancelled workflow',
      (v) => {
        v.runs[0].conclusion = 'cancelled';
      },
    ],
    [
      'skipped workflow',
      (v) => {
        v.runs[0].conclusion = 'skipped';
      },
    ],
    [
      'missing required job',
      (v) => {
        v.runs[1].jobs.pop();
      },
    ],
    [
      'duplicate required job',
      (v) => {
        v.runs[1].jobs.push(v.runs[1].jobs[0]);
      },
    ],
    [
      'failed required job',
      (v) => {
        v.runs[1].jobs[0].conclusion = 'failure';
      },
    ],
    [
      'cancelled required job',
      (v) => {
        v.runs[1].jobs[0].conclusion = 'cancelled';
      },
    ],
    [
      'skipped required job',
      (v) => {
        v.runs[1].jobs[0].conclusion = 'skipped';
      },
    ],
    [
      'running required job',
      (v) => {
        v.runs[1].jobs[0].status = 'in_progress';
      },
    ],
    [
      'missing target',
      (v) => {
        v.coverage.pop();
      },
    ],
    [
      'duplicate target',
      (v) => {
        v.coverage.push(v.coverage[0]);
      },
    ],
    [
      'selected coverage',
      (v) => {
        v.coverage[0].complete = false;
      },
    ],
    [
      'unproven complete coverage',
      (v) => {
        delete v.coverage[0].complete;
      },
    ],
    [
      'other coverage source',
      (v) => {
        v.coverage[0].sourceSha = 'a'.repeat(40);
      },
    ],
    [
      'low lines',
      (v) => {
        v.coverage[0].lines = 89.999;
      },
    ],
    [
      'low branches',
      (v) => {
        v.coverage[0].branches = 84.999;
      },
    ],
    [
      'impossible percentage',
      (v) => {
        v.coverage[0].lines = 101;
      },
    ],
    [
      'nonfinite percentage',
      (v) => {
        v.coverage[0].branches = NaN;
      },
    ],
    [
      'coerced percentage',
      (v) => {
        v.coverage[0].lines = '100';
      },
    ],
  ])('denies %s even if manifest claims eligibility', (_name, mutate) => {
    const input = evidence();
    mutate(input);
    denied(() => contract.validateEvidence(manifest(), input, policy));
  });

  it.each(['web', 'api'])(
    'requires verified provenance for %s exact digest and attestation',
    (component) => {
      expect(() =>
        contract.validateProvenance(manifest(), component, provenance(component), policy),
      ).not.toThrow();
      for (const [field, value] of [
        ['verified', false],
        ['verified', 'true'],
        ['sourceSha', 'a'.repeat(40)],
        ['repositoryId', '987654'],
        ['workflowRef', canary],
        ['imageDigest', `sha256:${'9'.repeat(64)}`],
        ['attestationSha256', '9'.repeat(64)],
        ['runId', '999'],
        ['runId', 102],
        ['runAttempt', 2],
        ['runAttempt', '1'],
        ['runAttempt', 0],
      ])
        denied(() =>
          contract.validateProvenance(
            manifest(),
            component,
            { ...provenance(component), [field]: value },
            policy,
          ),
        );
      for (const field of Object.keys(provenance(component))) {
        const incomplete = provenance(component);
        delete incomplete[field];
        denied(() => contract.validateProvenance(manifest(), component, incomplete, policy));
      }
    },
  );

  it('does not substitute one component provenance for another or invent a component', () => {
    denied(() => contract.validateProvenance(manifest(), 'api', provenance('web'), policy));
    denied(() => contract.validateProvenance(manifest(), 'worker', provenance(), policy));
  });
});

describe('REL-04/05 isolated future production approval simulation', () => {
  const now = 1_800_000_000_000;
  function fixture() {
    return {
      request: {
        candidateSha: sha,
        targetId: 'synthetic-production',
        requester: 'JohnLozano-Stara',
      },
      approval: {
        candidateSha: sha,
        targetId: 'synthetic-production',
        approver: 'sundip',
        expiresAt: now + 1000,
        revoked: false,
      },
      context: {
        simulation: true,
        productionEnabled: true,
        now,
        authenticatedRequester: 'JohnLozano-Stara',
        authenticatedApprover: 'sundip',
      },
    };
  }
  it('accepts only the other authenticated authorized human in either direction in simulation', () => {
    const f = fixture();
    expect(() =>
      contract.validateProductionApproval(f.request, f.approval, f.context),
    ).not.toThrow();
    f.request.requester = f.context.authenticatedRequester = 'sundip';
    f.approval.approver = f.context.authenticatedApprover = 'JohnLozano-Stara';
    expect(() =>
      contract.validateProductionApproval(f.request, f.approval, f.context),
    ).not.toThrow();
  });

  it.each([
    [
      'live production',
      (f) => {
        f.context.simulation = false;
      },
    ],
    [
      'missing simulation',
      (f) => {
        delete f.context.simulation;
      },
    ],
    [
      'string simulation',
      (f) => {
        f.context.simulation = 'true';
      },
    ],
    [
      'disabled production',
      (f) => {
        f.context.productionEnabled = false;
      },
    ],
    [
      'self approval',
      (f) => {
        f.approval.approver = f.context.authenticatedApprover = f.request.requester;
      },
    ],
    [
      'identity substitution',
      (f) => {
        f.context.authenticatedApprover = f.request.requester;
      },
    ],
    [
      'requester substitution',
      (f) => {
        f.context.authenticatedRequester = 'sundip';
      },
    ],
    [
      'unknown approver',
      (f) => {
        f.approval.approver = f.context.authenticatedApprover = 'synthetic-outsider';
      },
    ],
    [
      'case substitution',
      (f) => {
        f.approval.approver = f.context.authenticatedApprover = 'Sundip';
      },
    ],
    [
      'changed candidate',
      (f) => {
        f.request.candidateSha = 'a'.repeat(40);
      },
    ],
    [
      'changed target',
      (f) => {
        f.request.targetId = 'synthetic-other';
      },
    ],
    [
      'expired',
      (f) => {
        f.approval.expiresAt = now - 1;
      },
    ],
    [
      'expiry boundary',
      (f) => {
        f.approval.expiresAt = now;
      },
    ],
    [
      'nonfinite expiry',
      (f) => {
        f.approval.expiresAt = Infinity;
      },
    ],
    [
      'revoked',
      (f) => {
        f.approval.revoked = true;
      },
    ],
    [
      'missing revocation state',
      (f) => {
        delete f.approval.revoked;
      },
    ],
    [
      'unbound short candidate',
      (f) => {
        f.approval.candidateSha = f.request.candidateSha = 'abc1234';
      },
    ],
  ])('denies %s', (_name, mutate) => {
    const f = fixture();
    mutate(f);
    denied(() => contract.validateProductionApproval(f.request, f.approval, f.context));
  });
});

describe('REL-10 public evidence is an explicit allowlist', () => {
  function publicInput() {
    return {
      schemaVersion: 1,
      sourceSha: sha,
      version: '1.2.3',
      synthetic: true,
      results: [{ scenario: 'REL-03', result: 'Passed', mode: 'simulation' }],
    };
  }
  it('returns only the allowed synthetic record, detached from caller mutation', () => {
    const input = publicInput();
    const result = contract.publicEvidence(input);
    expect(result).toEqual(publicInput());
    input.results[0].result = 'Failed';
    expect(result.results[0].result).toBe('Passed');
    const withoutVersion = publicInput();
    delete withoutVersion.version;
    expect(contract.publicEvidence(withoutVersion)).toEqual(withoutVersion);
  });
  it.each([
    'secret',
    'projectId',
    'serviceAccount',
    'configuration',
    'state',
    'traffic',
    'trace',
    'url',
    'token',
    'canary',
    'metadata',
  ])('blocks unrecognized root or result field %s instead of silently dropping it', (field) => {
    denied(() => contract.publicEvidence({ ...publicInput(), [field]: canary }));
    const nested = publicInput();
    nested.results[0][field] = canary;
    denied(() => contract.publicEvidence(nested));
  });
  it.each([
    [
      'non-synthetic',
      (v) => {
        v.synthetic = false;
      },
    ],
    [
      'coerced synthetic',
      (v) => {
        v.synthetic = 'true';
      },
    ],
    [
      'unknown schema',
      (v) => {
        v.schemaVersion = 2;
      },
    ],
    [
      'canary in source',
      (v) => {
        v.sourceSha = canary;
      },
    ],
    [
      'canary in version',
      (v) => {
        v.version = canary;
      },
    ],
    [
      'canary in result',
      (v) => {
        v.results[0].result = canary;
      },
    ],
    [
      'canary in mode',
      (v) => {
        v.results[0].mode = canary;
      },
    ],
    [
      'unknown scenario',
      (v) => {
        v.results[0].scenario = 'REL-12';
      },
    ],
    [
      'missing results',
      (v) => {
        delete v.results;
      },
    ],
    [
      'malformed results',
      (v) => {
        v.results = canary;
      },
    ],
    [
      'null result',
      (v) => {
        v.results = [null];
      },
    ],
  ])('blocks %s without leaking supplied values', (_name, mutate) => {
    const input = publicInput();
    mutate(input);
    denied(() => contract.publicEvidence(input));
  });
});
