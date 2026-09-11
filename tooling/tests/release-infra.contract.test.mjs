import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { classifyChanges, validateLayout } from '../lib/policy.mjs';

const root = new URL('../../', import.meta.url);
const modules = ['bootstrap', 'delivery', 'target'];
const workflowRef = 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main';
const dispatchRef = 'stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main';
const nodeImage =
  'node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203';
const nodeRuntimeImage =
  'node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a';
const nginxImage =
  'nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce';
const packages = [
  { name: '@stara/web', relativePath: 'UI/web' },
  { name: '@stara/ui', relativePath: 'UI/shared' },
  { name: '@stara/api', relativePath: 'backend/api' },
  { name: '@stara/tooling', relativePath: 'tooling' },
];

async function source(path) {
  try {
    return await readFile(new URL(path, root), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(
      `Missing implementation: ${path}; static contract not satisfied, no infrastructure behavior executed`,
      { cause: error },
    );
  }
}

async function files(path) {
  try {
    return await readdir(new URL(`${path}/`, root), { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Missing implementation directory: ${path}; Terraform not executed`, {
      cause: error,
    });
  }
}

// This extracts literal source blocks, not evaluated HCL. Terraform plan/live
// acceptance is separately required by release-infra-test-design.md.
function uncomment(text) {
  return text.replace(/"(?:\\.|[^"\\])*"|#[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (token) =>
    token.startsWith('"') ? token : token.replace(/[^\n]/g, ' '),
  );
}

function blocks(text, kind) {
  const code = uncomment(text);
  const matcher = new RegExp(`\\b${kind}((?:\\s+"[^"\\n]+")*)\\s*(?:=\\s*)?\\{`, 'g');
  const result = [];
  for (const match of code.matchAll(matcher)) {
    const tokens = /"(?:\\.|[^"\\])*"|[{}]/g;
    tokens.lastIndex = match.index + match[0].length;
    let depth = 1;
    let end;
    for (let token = tokens.exec(code); token; token = tokens.exec(code)) {
      if (token[0] === '{') depth += 1;
      if (token[0] === '}') depth -= 1;
      if (depth === 0) {
        end = token.index;
        break;
      }
    }
    expect(end, `Unbalanced ${kind} source block`).toBeDefined();
    result.push({
      labels: [...match[1].matchAll(/"([^"\n]+)"/g)].map((label) => label[1]),
      body: code.slice(match.index + match[0].length, end),
    });
  }
  return result;
}

function field(block, name) {
  const value = block.body.match(new RegExp(`(?:^|\\n)\\s*${name}\\s*=\\s*([^\\n]+)`))?.[1]?.trim();
  expect(value, `${block.labels.join('.')} requires explicit ${name}`).toBeDefined();
  return value;
}

function literal(block, name) {
  const value = field(block, name);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      `${block.labels.join('.')}.${name} needs a reviewed literal source assertion or separate evaluated plan contract`,
    );
  }
}

async function terraform(module) {
  const path = `infra/gcp/${module}`;
  const names = (await files(path))
    .filter((item) => item.isFile() && item.name.endsWith('.tf'))
    .map((item) => item.name)
    .sort();
  expect(names.length, `${path} must contain Terraform source`).toBeGreaterThan(0);
  return (await Promise.all(names.map((name) => source(`${path}/${name}`)))).join('\n');
}

function resources(text, type) {
  const values = blocks(text, 'resource').filter((block) => block.labels[0] === type);
  expect(
    values.length,
    `Missing resource type ${type}; source presence does not prove live behavior`,
  ).toBeGreaterThan(0);
  return values;
}

async function workflow(path) {
  const raw = await source(path);
  const document = parseDocument(raw, { uniqueKeys: true });
  expect(document.errors, `${path} must have unambiguous YAML`).toEqual([]);
  const value = document.toJS();
  expect(value?.jobs, `${path} needs executable jobs`).toBeTypeOf('object');
  expect(Object.keys(value.jobs).length).toBeGreaterThan(0);
  return { raw, value };
}

const steps = (value) => Object.values(value.jobs).flatMap((job) => job.steps ?? []);
const runs = (job) => (job.steps ?? []).map((step) => step.run ?? '').join('\n');
const expression = (value) =>
  String(value ?? '')
    .replace(/^\s*\$\{\{|\}\}\s*$/g, '')
    .trim();

function pinnedInstaller(job, { executable, url, hash, extraction }) {
  const candidates = (job.steps ?? []).filter((step) => step.run?.includes(url));
  expect(
    candidates,
    `Missing checksum-pinned ${executable} installer; installer not executed`,
  ).toHaveLength(1);
  const step = candidates[0];
  const code = step.run.replace(/^\s*#.*$/gm, '');
  expect(expression(step.if ?? 'success()')).toBe('success()');
  expect(step['continue-on-error'] ?? false).toBe(false);
  expect(code).toContain(url);
  expect(code).toMatch(/\bcurl\s+[^\n]*(?:--fail|-f|-fsSL|-fL)/);
  expect(code).toContain(hash);
  const checked = code.search(/\bsha256sum\s+(?:--check|-c)\b/);
  const unpacked = code.search(extraction);
  const installed = code.search(new RegExp(`\\binstall\\s+[^\\n]*/usr/local/bin/${executable}\\b`));
  expect(checked, `${executable} archive must pass sha256sum before extraction`).toBeGreaterThan(
    code.indexOf(hash),
  );
  expect(unpacked).toBeGreaterThan(checked);
  expect(installed).toBeGreaterThan(unpacked);
  expect(code).not.toMatch(
    /\|\|\s*(?:true|:)|--insecure|\bcurl\s+-k\b|\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
  );
  return job.steps.indexOf(step);
}

function expandedRootCommands(job) {
  const candidates = (job.steps ?? []).filter((step) =>
    /\bterraform\s+-chdir=/.test(step.run ?? ''),
  );
  expect(
    candidates.length,
    'Missing required Terraform root verification commands',
  ).toBeGreaterThan(0);
  for (const step of candidates) {
    expect(expression(step.if ?? 'success()')).toBe('success()');
    expect(step['continue-on-error'] ?? false).toBe(false);
  }
  let code = candidates
    .map((step) => step.run)
    .join('\n')
    .replace(/\\\r?\n/g, ' ');
  // Recognize only the agreed fixed-root loop; this is not a general shell evaluator.
  code = code.replace(
    /\bfor\s+(\w+)\s+in\s+bootstrap\s+delivery\s+target\s*;?\s*do\b([\s\S]*?)\bdone\b/g,
    (_loop, name, body) =>
      modules
        .map((module) => body.replaceAll(`\${${name}}`, module).replaceAll(`$${name}`, module))
        .join('\n'),
  );
  expect(code).not.toMatch(
    /\|\||\bterraform\b[^\n]*\b(?:apply|destroy|plan)\b|--?backend-config|--?upgrade|--?migrate-state/,
  );
  return code
    .replaceAll('"', '')
    .replaceAll("'", '')
    .split(/\r?\n/)
    .map((line) => line.trim());
}

describe('required CI tools: pinned installers and backend-free synthetic plans', () => {
  it('builds and checksum-checks the reviewed GH artifact before publisher authentication', async () => {
    const { value } = await workflow('.github/workflows/release.yml');
    const publisher = value.jobs.publish;
    expect(publisher, 'Missing image publisher').toBeDefined();
    const candidates = publisher.steps.filter((step) =>
      /--target\s+gh-artifact\b/.test(step.run ?? ''),
    );
    expect(candidates).toHaveLength(1);
    const step = candidates[0];
    expect(expression(step.if ?? 'success()')).toBe('success()');
    expect(step['continue-on-error'] ?? false).toBe(false);
    const code = step.run.replace(/^\s*#.*$/gm, '').replace(/\\\r?\n/g, ' ');
    expect(code).toContain('set -euo pipefail');
    expect(code).toMatch(/directory="\$\(mktemp -d "\$RUNNER_TEMP\/stara-gh\.[X]+"\)"/);
    expect(code).toMatch(
      /docker buildx build[^\n]*--platform linux\/amd64[^\n]*--target gh-artifact[^\n]*--file tooling\/release\/Dockerfile[^\n]*--output "?type=local,dest=\$directory"?\s+\./,
    );
    const checked = code.indexOf('sha256sum --check --strict SHA256SUMS');
    expect(code).toMatch(/\(cd "\$directory"\s*&&\s*sha256sum --check --strict SHA256SUMS\)/);
    expect(checked).toBeGreaterThan(code.indexOf('docker buildx build'));
    expect(
      code.search(/sudo install[^\n]*"\$directory\/bin\/gh"[^\n]*\/usr\/local\/bin\/gh/),
    ).toBeGreaterThan(checked);
    expect(code).toMatch(/sudo install[^\n]*"\$directory\/LICENSE"[^\n]*\/usr\/local\/share\//);
    expect(code).toMatch(
      /(?:sudo (?:cp|install)[^\n]*\$directory\/provenance|for [^\n]*\$directory\/provenance\/\*)/,
    );
    expect(code).not.toMatch(/\|\||\b(?:curl|wget)\b|gh_2\.100\.0_linux_amd64|--insecure/);
    const installed = publisher.steps.indexOf(step);
    expect(
      publisher.steps.findIndex((item) => item.uses?.startsWith('google-github-actions/auth@')),
    ).toBeGreaterThan(installed);
    const published = publisher.steps.findIndex(
      (step) => step.run?.trim() === 'pnpm release:publish',
    );
    expect(published).toBeGreaterThan(installed);
    expect(runs(publisher)).not.toMatch(/\b(?:apt(?:-get)?|brew|npm)\s+[^\n]*\bgh\b/);
  });

  it('does not combine mutually exclusive GH certificate identity and signer workflow selectors', async () => {
    const code = await source('tooling/release/transport.mjs');
    const selectors = ['--cert-identity', '--signer-workflow'].filter(
      (flag) => code.includes(`'${flag}'`) || code.includes(`"${flag}"`),
    );
    expect(
      selectors,
      'The reviewed verifier must use exactly one identity selector; argv behavior belongs to transport tests',
    ).toHaveLength(1);
  });

  it('installs checksum-pinned Terraform 1.16.2 in the existing required read-only job', async () => {
    const { value } = await workflow('.github/workflows/checks.yml');
    const job = value.jobs.verify;
    expect(value.jobs.required.needs).toContain('verify');
    expect(expression(job.if ?? 'always()')).toBe('always()');
    const installed = pinnedInstaller(job, {
      executable: 'terraform',
      url: 'https://releases.hashicorp.com/terraform/1.16.2/terraform_1.16.2_linux_amd64.zip',
      hash: '0d17011f0c4664539b164b044903d04e296c86c13cb9f28040076c65cfb3985a',
      extraction: /\bunzip\s+/,
    });
    const checked = job.steps.findIndex((step) => /\bterraform\s+-chdir=/.test(step.run ?? ''));
    expect(checked).toBeGreaterThan(installed);
    expect(JSON.stringify(job)).not.toMatch(
      /\bsecrets\s*(?:\.|\[)|id-token.*write|google-github-actions\/auth@|GOOGLE_APPLICATION_CREDENTIALS|CLOUDSDK_AUTH/,
    );
  });

  it.each(modules)(
    '%s runs fmt, readonly backend-free init, validate and mocked tests in order',
    async (module) => {
      const { value } = await workflow('.github/workflows/checks.yml');
      const lines = expandedRootCommands(value.jobs.verify);
      const prefix = `terraform -chdir=infra/gcp/${module} `;
      const commands = ['fmt', 'init', 'validate', 'test'].map((command) => {
        const index = lines.findIndex((line) => line.startsWith(`${prefix}${command}`));
        expect(index, `Missing required ${module} ${command}`).toBeGreaterThanOrEqual(0);
        return { index, words: lines[index].split(/\s+/) };
      });
      expect(commands[0].words).toEqual(expect.arrayContaining(['-check', '-recursive']));
      expect(commands[1].words).toEqual(
        expect.arrayContaining(['-backend=false', '-input=false', '-lockfile=readonly']),
      );
      for (let index = 1; index < commands.length; index++)
        expect(commands[index].index).toBeGreaterThan(commands[index - 1].index);
      expect(
        (await source(`infra/gcp/${module}/.terraform.lock.hcl`)).trim().length,
      ).toBeGreaterThan(0);
    },
  );

  it.each(modules)(
    '%s CI tests never default to apply or use an unmocked provider',
    async (module) => {
      const names = (await files(`infra/gcp/${module}/tests`)).filter(
        (entry) => entry.isFile() && entry.name.endsWith('.tftest.hcl'),
      );
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const code = await source(`infra/gcp/${module}/tests/${name.name}`);
        expect(blocks(code, 'provider')).toHaveLength(0);
        const providers = blocks(code, 'mock_provider');
        expect(
          providers.some(
            (provider) => provider.labels[0] === 'google' && !/\balias\s*=/.test(provider.body),
          ),
        ).toBe(true);
        if (module === 'bootstrap')
          expect(
            providers.some(
              (provider) =>
                provider.labels[0] === 'google' && /alias\s*=\s*"budget"/.test(provider.body),
            ),
          ).toBe(true);
        else expect(providers.some((provider) => provider.labels[0] === 'google-beta')).toBe(true);
        const runs = blocks(code, 'run');
        expect(runs.length).toBeGreaterThan(0);
        for (const run of runs) expect(field(run, 'command')).toBe('plan');
        expect(code).not.toMatch(/\bmodule\s*\{|\bprovider\s*=\s*\w/);
      }
    },
  );
});

describe('release infrastructure: explicit implementation boundaries', () => {
  for (const module of modules) {
    it.each(['versions', 'main', 'variables', 'outputs'])(
      `${module}/%s.tf exists before claiming infrastructure evidence`,
      async (name) => {
        expect((await source(`infra/gcp/${module}/${name}.tf`)).trim().length).toBeGreaterThan(0);
      },
    );

    it(`${module} pins Terraform and Google provider`, async () => {
      const code = uncomment(await terraform(module));
      expect(code).toMatch(/required_version\s*=\s*"(?:=\s*)?1\.16\.2"/);
      const google = blocks(code, 'google').find((block) =>
        /source\s*=\s*"hashicorp\/google"/.test(block.body),
      );
      expect(google, 'Google provider must be explicitly declared').toBeDefined();
      expect(field(google, 'version')).toMatch(/^"(?:=\s*)?8\.2\.0"$/);
      const beta = blocks(code, 'google-beta').filter((block) =>
        /source\s*=\s*"hashicorp\/google-beta"/.test(block.body),
      );
      for (const provider of beta)
        expect(field(provider, 'version')).toMatch(/^"(?:=\s*)?8\.2\.0"$/);
      for (const resource of blocks(code, 'resource')) {
        if (/provider\s*=\s*google-beta\b/.test(resource.body)) {
          expect(beta, 'Beta resource requires its exact pinned provider declaration').toHaveLength(
            1,
          );
          expect(resource.labels[0]).toBe('google_project_service_identity');
        }
        if (resource.labels[0] === 'google_project_service_identity') {
          expect(field(resource, 'provider')).toBe('google-beta');
        }
      }
    });
  }

  it('documents private bootstrap inputs and the absent production path', async () => {
    const readme = await source('infra/gcp/README.md');
    expect(readme).toMatch(/private/i);
    expect(readme).toMatch(/production[\s\S]{0,100}(?:disabled|absent|not provisioned)/i);
    expect(readme).toMatch(/(?:not a|not an|no|not enforce)[^\n]{0,70}(?:cap|ceiling|limit)/i);
  });
});

describe('release infrastructure policy: execute real fail-closed path controls', () => {
  it.each([
    'infra/gcp/bootstrap/main.tf',
    'infra/gcp/delivery/variables.tf',
    'infra/gcp/target/outputs.tf',
    'infra/gcp/tests/isolation.tftest.hcl',
    'infra/gcp/.terraform.lock.hcl',
    'infra/gcp/README.md',
    'infra/gcp/terraform.tfvars.example',
  ])('permits the reviewed infrastructure ownership path %s', (path) => {
    expect(validateLayout([path])).toEqual([]);
  });

  it.each([
    'infra/aws/main.tf',
    'infra/main.tf',
    'infra/gcp-other/main.tf',
    'infra/gcp/../main.tf',
    'infra/gcp\\main.tf',
  ])('does not widen infrastructure ownership to %s', (path) => {
    expect(validateLayout([path]).length).toBeGreaterThan(0);
  });

  for (const prefix of ['infra/gcp/', 'docs/', 'tooling/', 'UI/web/', 'backend/api/']) {
    it.each([
      'terraform.tfstate',
      'terraform.tfstate.backup',
      'candidate.tfplan',
      'terraform.tfvars',
      'customer.auto.tfvars',
      'settings.tfvars.json',
      'terraform.tfvars.example.bak',
      'unreviewed.tfvars.example',
      'credentials.json',
      'application_default_credentials.json',
      'service-account.json',
      'keys/private.pem',
      'keys/client.p12',
      '.terraform/providers/cache',
    ])(`denies operational material under ${prefix}%s`, (name) => {
      expect(
        validateLayout([`${prefix}${name}`]).length,
        'A generally allowed owner must not admit operational material',
      ).toBeGreaterThan(0);
    });
  }

  it.each([
    'main.tf',
    'README.md',
    'tests/access.tftest.hcl',
    'deleted.tf',
    'terraform.tfvars.example',
  ])('broadens every infrastructure change to every target: %s', (name) => {
    const result = classifyChanges({
      files: ['docs/notes.md', `infra/gcp/${name}`],
      knownPackages: packages,
      baselineAvailable: true,
    });
    expect(result.mode).toBe('all');
    expect([...result.targets].sort()).toEqual(packages.map((pkg) => pkg.name).sort());
  });
});

describe('Terraform source contracts: privacy, trust and production absence (not IAM execution)', () => {
  it('extracts standard required_providers maps and ignores commented-out provider declarations', () => {
    const code =
      'terraform { required_providers { google = {\nsource = "hashicorp/google"\nversion = "8.2.0"\n} } }\n# google = { version = "untrusted" }';
    const providers = blocks(code, 'google');
    expect(providers).toHaveLength(1);
    expect(literal(providers[0], 'source')).toBe('hashicorp/google');
    expect(literal(providers[0], 'version')).toBe('8.2.0');
  });

  it('creates new projects and explicit combined USD 100 budget alerts', async () => {
    const code = await terraform('bootstrap');
    const projects = resources(code, 'google_project');
    for (const project of projects) {
      expect(field(project, 'project_id')).toMatch(/\S/);
      expect(field(project, 'billing_account')).toMatch(/\S/);
      expect(project.body).toMatch(/(?:org_id|folder_id)\s*=/);
    }
    expect(uncomment(code)).toMatch(/\bdelivery\b/);
    expect(uncomment(code)).toMatch(/\bstaging\b/);
    expect(uncomment(code)).toMatch(/\b(?:isolation|temporary)\b/);
    const budgets = resources(code, 'google_billing_budget');
    expect(budgets).toHaveLength(1);
    const budget = budgets[0];
    expect(budget.body).toMatch(/currency_code\s*=\s*"USD"/);
    expect(budget.body).toMatch(/units\s*=\s*"?100"?(?:\s|$)/);
    expect(
      blocks(budget.body, 'threshold_rules')
        .map((rule) => literal(rule, 'threshold_percent'))
        .sort(),
    ).toEqual([0.5, 0.8, 1]);
    expect(blocks(budget.body, 'budget_filter')).toHaveLength(1);
    expect(blocks(budget.body, 'budget_filter')[0].body).toMatch(/projects\s*=/);
  });

  it('uses private Artifact Registry, separate GCS config/artifacts/state and private 30-day Cloud Logging', async () => {
    const code = await terraform('delivery');
    for (const repository of resources(code, 'google_artifact_registry_repository')) {
      expect(literal(repository, 'format')).toBe('DOCKER');
    }
    const target = await terraform('target');
    const deliveryBuckets = resources(code, 'google_storage_bucket');
    const targetBuckets = resources(target, 'google_storage_bucket');
    const buckets = [...deliveryBuckets, ...targetBuckets];
    for (const bucket of buckets) {
      expect(literal(bucket, 'uniform_bucket_level_access')).toBe(true);
      expect(literal(bucket, 'public_access_prevention')).toBe('enforced');
      expect(literal(bucket, 'force_destroy')).toBe(false);
    }
    expect(
      targetBuckets.length >= 2 || targetBuckets.some((bucket) => /for_each\s*=/.test(bucket.body)),
      'Target owns separate configuration and receipt state; evaluated plan must verify their distinct identities',
    ).toBe(true);
    for (const bucket of resources(code, 'google_logging_project_bucket_config')) {
      expect(literal(bucket, 'retention_days')).toBe(30);
    }
  });

  it('pins the entire GitHub WIF condition to the approved numeric owner, repository, ref and workflow', async () => {
    const code = await terraform('delivery');
    const providers = resources(code, 'google_iam_workload_identity_pool_provider');
    expect(providers).toHaveLength(2);
    const observed = [];
    for (const provider of providers) {
      const condition = literal(provider, 'attribute_condition');
      expect(condition).toBeTypeOf('string');
      const clauses = condition.split('&&').map((part) =>
        part
          .trim()
          .replace(/^\((.*)\)$/, '$1')
          .trim(),
      );
      const required = [
        "assertion.repository_owner_id == '293455507'",
        "assertion.repository_id == '1363262992'",
        "assertion.ref == 'refs/heads/main'",
      ];
      expect(clauses).toEqual(expect.arrayContaining(required));
      expect(condition).not.toMatch(/\|\||!=|\bin\b|startsWith|endsWith|matches/);
      expect(provider.body).toMatch(
        /issuer_uri\s*=\s*"https:\/\/token\.actions\.githubusercontent\.com"/,
      );
      expect(provider.body).toMatch(
        /"?attribute\.repository_id"?\s*=\s*"assertion\.repository_id"/,
      );
      const imageProvider = clauses.includes(`assertion.workflow_ref == '${workflowRef}'`);
      expect(clauses).toContain(
        `assertion.workflow_ref == '${imageProvider ? workflowRef : dispatchRef}'`,
      );
      expect(clauses).toContain(
        `assertion.event_name == '${imageProvider ? 'push' : 'workflow_run'}'`,
      );
      observed.push(imageProvider ? 'images' : 'dispatch');
    }
    expect(observed.sort()).toEqual(['dispatch', 'images']);
    const bindings = resources(code, 'google_service_account_iam_member');
    const federation = bindings.filter((binding) =>
      /role\s*=\s*"roles\/iam\.workloadIdentityUser"/.test(binding.body),
    );
    expect(federation).toHaveLength(2);
    expect(new Set(federation.map((binding) => field(binding, 'service_account_id'))).size).toBe(2);
    expect(
      new Set(federation.map((binding) => field(binding, 'member'))).size,
      'A shared repository principal would let both providers impersonate both publishers',
    ).toBe(2);
    for (const binding of federation) {
      expect(field(binding, 'member')).toMatch(
        /principalSet:\/\/iam\.googleapis\.com\/.+\/attribute\.(?:repository_id|workflow_ref|publisher)\//,
      );
      expect(field(binding, 'member')).not.toMatch(/\/\*"$/);
    }
    if (
      new Set(providers.map((provider) => field(provider, 'workload_identity_pool_id'))).size === 1
    ) {
      for (const binding of federation) {
        expect(
          field(binding, 'member'),
          'Same-pool provider identities need distinct mapped workflow/publisher attributes',
        ).not.toContain('/attribute.repository_id/');
      }
    }
  });

  it('separates artifact and topic publishers, with resource-scoped publish authority only', async () => {
    const code = await terraform('delivery');
    const bindings = blocks(code, 'resource').filter((block) =>
      /_iam_(?:member|binding)$/.test(block.labels[0]),
    );
    const writer = bindings.filter((block) =>
      /role\s*=\s*"roles\/artifactregistry\.writer"/.test(block.body),
    );
    const publisher = bindings.filter((block) =>
      /role\s*=\s*"roles\/pubsub\.publisher"/.test(block.body),
    );
    expect(writer).toHaveLength(1);
    expect(publisher).toHaveLength(1);
    expect(writer[0].labels[0]).toBe('google_artifact_registry_repository_iam_member');
    expect(publisher[0].labels[0]).toBe('google_pubsub_topic_iam_member');
    const artifactIdentity = field(writer[0], 'member');
    const topicIdentity = field(publisher[0], 'member');
    expect(artifactIdentity).not.toBe(topicIdentity);
    const allowed = new Map([
      [artifactIdentity, ['roles/artifactregistry.writer', 'roles/storage.objectCreator']],
      [topicIdentity, ['roles/pubsub.publisher']],
    ]);
    for (const binding of bindings.filter((block) => /(?:^|\n)\s*member\s*=/.test(block.body))) {
      const identity = field(binding, 'member');
      if (allowed.has(identity)) {
        expect(allowed.get(identity)).toContain(literal(binding, 'role'));
        expect(binding.labels[0]).not.toBe('google_project_iam_member');
      }
    }
    expect(uncomment(code)).not.toMatch(
      /roles\/(?:owner|editor|clouddeploy\.[\w.]+|cloudbuild\.builds\.editor)"/,
    );
  });

  it('executes a fixed digest-pinned inline build from only the fixed Pub/Sub topic with private logs', async () => {
    const code = await terraform('delivery');
    const triggers = resources(code, 'google_cloudbuild_trigger');
    expect(triggers).toHaveLength(1);
    const trigger = triggers[0];
    expect(blocks(trigger.body, 'pubsub_config')).toHaveLength(1);
    expect(field(blocks(trigger.body, 'pubsub_config')[0], 'topic')).toMatch(
      /^google_pubsub_topic\.[\w]+\.(?:id|name)$/,
    );
    expect(field(trigger, 'service_account')).toMatch(
      /^(?:google_service_account\.[\w]+\.(?:id|name)|var\.[\w]+)$/,
    );
    expect(trigger.body).not.toMatch(
      /(?:^|\n)\s*(?:filename|git_file_source|source_to_build)\s*(?:=|\{)/,
    );
    const builds = blocks(trigger.body, 'build');
    expect(builds).toHaveLength(1);
    const build = builds[0];
    expect(build.body).toMatch(/logging\s*=\s*"CLOUD_LOGGING_ONLY"/);
    expect(build.body).not.toMatch(/(?:^|\n)\s*logs_bucket\s*=/);
    const buildSteps = blocks(build.body, 'step');
    expect(buildSteps).toHaveLength(1);
    const step = buildSteps[0];
    const image = field(step, 'name');
    if (!/@sha256:[a-f0-9]{64}"$/.test(image)) {
      expect(image).toMatch(/^var\.[\w]+$/);
      const variable = blocks(code, 'variable').find((block) => block.labels[0] === image.slice(4));
      expect(variable, 'Executor image variable must constrain digest identity').toBeDefined();
      expect(variable.body).toMatch(/sha256:/);
      expect(blocks(variable.body, 'validation').length).toBeGreaterThan(0);
    }
    expect(step.body).not.toMatch(/(?:^|\n)\s*script\s*=/);
    if (/(?:^|\n)\s*entrypoint\s*=/.test(step.body)) {
      expect(literal(step, 'entrypoint')).toBe('node');
      expect(step.body).toMatch(/args\s*=\s*\[\s*"(?:\/?[\w.-]+\/)*[\w.-]+\.m?js"/);
      if (/args\s*=\s*\[\s*"[^/]/.test(step.body)) expect(literal(step, 'dir')).toBe('/app');
    }
    expect(step.body).not.toMatch(/"(?:sh|bash|zsh|cmd|powershell|pwsh|-c|--eval|-e)"/);
    expect(step.body).not.toMatch(
      /\$\{?_(?:IMAGE|SCRIPT|COMMAND|SERVICE_ACCOUNT|TARGET|DESTINATION|URL)\b/,
    );
    expect(build.body).not.toMatch(/(?:^|\n)\s*(?:source|source_provenance)\s*\{/);
    expect(trigger.body).not.toMatch(
      /payload\.(?:script|command|image|serviceAccount|target|url)/i,
    );
  });

  it('constrains target environment, region, load-balancer scope and Cloud Run access/scaling', async () => {
    const code = await terraform('target');
    const variables = blocks(code, 'variable');
    const environment = variables.find((block) => block.labels[0] === 'environment');
    expect(environment).toBeDefined();
    expect(environment.body).toMatch(
      /contains\(\s*\[\s*"staging"\s*,\s*"isolation"\s*\]\s*,\s*var\.environment\s*\)/,
    );
    const region = variables.find((block) => block.labels[0] === 'region');
    expect(region).toBeDefined();
    expect(literal(region, 'default')).toBe('us-central1');
    expect(region.body).toMatch(/var\.region\s*==\s*"us-central1"/);
    expect(uncomment(code)).toMatch(
      /!var\.enable_load_balancer\s*\|\|\s*var\.environment\s*==\s*"staging"/,
    );
    const services = resources(code, 'google_cloud_run_v2_service');
    const accounts = resources(code, 'google_service_account');
    expect(
      services.length >= 2 || services.some((service) => /for_each\s*=/.test(service.body)),
    ).toBe(true);
    expect(
      accounts.length >= 2 || accounts.some((account) => /for_each\s*=/.test(account.body)),
    ).toBe(true);
    for (const service of services) {
      expect(literal(service, 'ingress')).toBe('INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER');
      expect(literal(service, 'invoker_iam_disabled')).toBe(false);
      expect(literal(service, 'default_uri_disabled')).toBe(true);
      expect(field(service, 'location')).toMatch(/^(?:var\.region|"us-central1")$/);
      const templates = blocks(service.body, 'template');
      expect(templates).toHaveLength(1);
      expect(field(templates[0], 'service_account')).toMatch(/google_service_account\./);
      const scaling = blocks(templates[0].body, 'scaling');
      expect(scaling).toHaveLength(1);
      expect(literal(scaling[0], 'min_instance_count')).toBe(0);
      expect(literal(scaling[0], 'max_instance_count')).toBe(2);
    }
    for (const binding of resources(code, 'google_cloud_run_v2_service_iam_member')) {
      expect(literal(binding, 'role')).toBe('roles/run.invoker');
      expect(field(binding, 'member')).toMatch(/(?:iap|gcp-sa-iap)/i);
    }
  });

  it('protects both HTTPS backends with IAP and explicit grants, and routes API separately', async () => {
    const code = await terraform('target');
    const backends = resources(code, 'google_compute_backend_service');
    expect(
      backends.length >= 2 || backends.some((backend) => /for_each\s*=/.test(backend.body)),
    ).toBe(true);
    for (const backend of backends) {
      const iap = blocks(backend.body, 'iap');
      expect(iap).toHaveLength(1);
      expect(literal(iap[0], 'enabled')).toBe(true);
      expect(backend.body).toMatch(/(?:var\.enable_load_balancer|local\.[\w]*backend)/);
    }
    const maps = resources(code, 'google_compute_url_map');
    expect(maps).toHaveLength(1);
    expect(maps[0].body).toMatch(/"\/api\/\*"/);
    expect(maps[0].body).toMatch(/default_service\s*=\s*google_compute_backend_service\./);
    expect(maps[0].body).toMatch(/service\s*=\s*google_compute_backend_service\./);
    resources(code, 'google_compute_region_network_endpoint_group');
    resources(code, 'google_compute_target_https_proxy');
    for (const binding of resources(code, 'google_iap_web_backend_service_iam_member')) {
      expect(literal(binding, 'role')).toBe('roles/iap.httpsResourceAccessor');
      expect(field(binding, 'member')).toMatch(/(?:var\.|each\.|google_service_account\.)/);
    }
  });

  it('declares no anonymous IAM, production resources, DNS ownership, secret payloads or provisioners', async () => {
    for (const module of modules) {
      const code = uncomment(await terraform(module));
      expect(code).not.toMatch(/\ballUsers\b|\ballAuthenticatedUsers\b/);
      expect(blocks(code, 'provisioner')).toEqual([]);
      const inventory = blocks(code, 'resource');
      for (const resource of inventory) {
        expect(resource.labels[0]).not.toMatch(
          /google_dns_|google_cloud_run_domain_mapping|google_secret_manager_secret_version/,
        );
        expect(resource.labels[1]).not.toMatch(/(?:^|_)(?:prod|production)(?:_|$)/i);
        expect(resource.body).not.toMatch(
          /(?:^|\n)\s*(?:project|project_id|name|account_id|domains|domain)\s*=\s*[^\n]*["/](?:[^"\s]*-)?(?:prod|production)(?:[-".]|$)/i,
        );
      }
      expect(code).not.toMatch(/"(?:https:\/\/)?app\.stara\.co"/);
      expect(code).not.toMatch(/secret_data\s*=|private_key\s*=|credentials\s*=/);
    }
  });

  it('allows private executor JWT signing only on its own account with the single signJwt permission', async () => {
    const inventory = blocks(
      `${await terraform('delivery')}\n${await terraform('target')}`,
      'resource',
    );
    const signers = inventory.filter(
      (resource) =>
        resource.labels[0] === 'google_project_iam_custom_role' &&
        /iam\.serviceAccounts\.signJwt/.test(resource.body),
    );
    expect(
      signers.length,
      'Missing executor self-signing role for authenticated IAP probes',
    ).toBeGreaterThan(0);
    for (const signer of signers) {
      const list = signer.body.match(/permissions\s*=\s*\[([\s\S]*?)\]/)?.[1];
      expect(list, 'Signing role permissions must be explicit').toBeDefined();
      expect([...list.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
        'iam.serviceAccounts.signJwt',
      ]);
      expect(list.replace(/"iam\.serviceAccounts\.signJwt"|[\s,]/g, '')).toBe('');
      const reference = `google_project_iam_custom_role.${signer.labels[1]}.`;
      const grants = inventory.filter(
        (resource) =>
          /_iam_(?:member|binding)$/.test(resource.labels[0]) &&
          field(resource, 'role').includes(reference),
      );
      expect(grants.length).toBeGreaterThan(0);
      for (const grant of grants) {
        expect(grant.labels[0], 'Signing permission must not be granted at project scope').toBe(
          'google_service_account_iam_member',
        );
        const account = field(grant, 'service_account_id');
        const member = field(grant, 'member');
        const reference = account.match(/(?:google_service_account\.[\w]+|var\.[\w]+)/)?.[0];
        expect(
          reference,
          'Self-signing target must reference a fixed operator-controlled account',
        ).toBeDefined();
        expect(member).toContain(reference);
        expect(member).toMatch(/^"serviceAccount:/);
        expect(member).not.toMatch(/publisher|principalSet/i);
      }
    }
    for (const resource of inventory) {
      if (/google_project_iam_(?:member|binding|policy)/.test(resource.labels[0])) {
        expect(resource.body).not.toContain('roles/iam.serviceAccountTokenCreator');
      }
      expect(resource.labels[0]).not.toBe('google_service_account_key');
    }
  });

  it('requires a real log-based corrective alert linked to the private owner email channel', async () => {
    const code = await terraform('delivery');
    const channels = resources(code, 'google_monitoring_notification_channel').filter(
      (channel) => literal(channel, 'type') === 'email',
    );
    expect(
      channels.length,
      'Logging alone is not an operator notification channel',
    ).toBeGreaterThan(0);
    const alerts = resources(code, 'google_monitoring_alert_policy').filter((alert) =>
      blocks(alert.body, 'condition_matched_log').some((condition) =>
        /release_terminal/.test(condition.body),
      ),
    );
    expect(
      alerts.length,
      'Missing corrective Monitoring incident policy for release_terminal',
    ).toBeGreaterThan(0);
    for (const alert of alerts) {
      if (/(?:^|\n)\s*enabled\s*=/.test(alert.body)) expect(literal(alert, 'enabled')).toBe(true);
      const conditions = blocks(alert.body, 'condition_matched_log');
      expect(conditions).toHaveLength(1);
      expect(conditions[0].body).toMatch(/filter\s*=/);
      expect(conditions[0].body).toMatch(/jsonPayload\.event/);
      expect(conditions[0].body).toMatch(/jsonPayload\.status/);
      for (const status of ['failed', 'degraded', 'reconciliation_required']) {
        expect(conditions[0].body, `Corrective incidents must cover ${status}`).toContain(status);
      }
      const channelList = alert.body.match(/notification_channels\s*=\s*\[([\s\S]*?)\]/)?.[1];
      expect(
        channelList,
        'A real policy/channel connection is required; an unlinked log alert cannot notify the owner',
      ).toBeDefined();
      const connected = channels.filter((channel) =>
        channelList.includes(`google_monitoring_notification_channel.${channel.labels[1]}.name`),
      );
      expect(
        connected.length,
        'Alert must reference an owned email notification channel',
      ).toBeGreaterThan(0);
      for (const channel of connected) {
        if (/(?:^|\n)\s*enabled\s*=/.test(channel.body))
          expect(literal(channel, 'enabled')).toBe(true);
        expect(field(channel, 'project')).toBe(field(alert, 'project'));
        const labels = blocks(channel.body, 'labels');
        expect(labels).toHaveLength(1);
        expect(
          field(labels[0], 'email_address'),
          'Owner address is supplied as private operator configuration',
        ).toMatch(/^(?:var|local)\.[\w]+$/);
      }
      const strategy = blocks(alert.body, 'alert_strategy');
      expect(strategy).toHaveLength(1);
      const limits = blocks(strategy[0].body, 'notification_rate_limit');
      expect(limits).toHaveLength(1);
      expect(literal(limits[0], 'period')).toMatch(/^[1-9][0-9]*(?:\.[0-9]+)?s$/);
    }
  });
});

describe('GitHub release source contracts: required read-only checks and narrow mainline OIDC', () => {
  it('keeps checks read-only, secret-free and without WIF on PRs/forks', async () => {
    const { raw, value } = await workflow('.github/workflows/checks.yml');
    expect(value.permissions).toEqual({ contents: 'read' });
    expect(value.on).toHaveProperty('pull_request');
    expect(value.on).not.toHaveProperty('pull_request_target');
    for (const job of Object.values(value.jobs)) {
      for (const permission of Object.values(job.permissions ?? {}))
        expect(['read', 'none']).toContain(permission);
      expect(job.permissions?.['id-token'] ?? 'none').toBe('none');
    }
    expect(raw).not.toMatch(
      /\bsecrets\s*(?:\.|\[)|google-github-actions\/auth@|workload_identity_provider|id-token:\s*write/,
    );
  });

  it('requires release-image and safety execution and includes it in the always aggregate', async () => {
    const { value } = await workflow('.github/workflows/checks.yml');
    const imageJobs = Object.entries(value.jobs).filter(([_id, job]) =>
      /\bpnpm release:images\b/.test(runs(job)),
    );
    expect(imageJobs.length, 'Missing required pnpm release:images workflow job').toBeGreaterThan(
      0,
    );
    const required = value.jobs.required;
    expect(expression(required.if)).toBe('always()');
    expect(required.needs).toEqual(expect.arrayContaining(['verify', 'windows', 'containers']));
    const aggregate = runs(required);
    for (const [id, job] of imageJobs) {
      expect(expression(job.if ?? 'always()')).toBe('always()');
      expect(required.needs).toContain(id);
      expect(runs(job)).toMatch(/\bpnpm release:safety\b/);
      for (const command of ['release:images', 'release:safety']) {
        const step = job.steps.find((item) => item.run?.includes(`pnpm ${command}`));
        expect(expression(step.if ?? 'always()')).toBe('always()');
        expect(step['continue-on-error'] ?? false).toBe(false);
        expect(step.run).not.toMatch(/\|\|\s*(?:true|:)|(?:^|[;\n])\s*(?:echo|printf)\s+.*pnpm/);
      }
      const env = Object.assign({}, ...(required.steps ?? []).map((step) => step.env ?? {}));
      const name = Object.keys(env).find((key) => env[key] === `\${{ needs.${id}.result }}`);
      expect(name, `${id} result must reach the aggregate`).toBeDefined();
      expect(aggregate).toContain(`test "$${name}" = success`);
    }
    const manifest = JSON.parse(await source('package.json'));
    for (const command of ['release:images', 'release:safety']) {
      expect(manifest.scripts[command], `Missing root script ${command}`).toBeTypeOf('string');
      expect(manifest.scripts[command]).not.toMatch(/^(?:echo|printf|true)\b/);
    }
  });

  it.each(['checks', 'release', 'dispatch'])(
    '%s pins all external actions and forbids ignored failures',
    async (name) => {
      const { value } = await workflow(`.github/workflows/${name}.yml`);
      for (const job of Object.values(value.jobs)) {
        expect(job['timeout-minutes']).toBeGreaterThan(0);
        expect(job['continue-on-error'] ?? false).toBe(false);
        if (job.uses) expect(job.uses).toMatch(/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
        for (const step of job.steps ?? []) {
          if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
          expect(step['continue-on-error'] ?? false).toBe(false);
          if (step.uses?.startsWith('actions/checkout@')) {
            expect(step.with?.['persist-credentials']).toBe(false);
          }
        }
      }
    },
  );

  it('builds images only on main push after exact-SHA read-only prerequisite checks', async () => {
    const { raw, value } = await workflow('.github/workflows/release.yml');
    expect(value.name).toBe('Release images');
    expect(value.on).toEqual({ push: { branches: ['main'] } });
    expect(value.permissions).toEqual({ contents: 'read' });
    const publishers = Object.entries(value.jobs).filter(
      ([_id, job]) => job.permissions?.['id-token'] === 'write',
    );
    expect(publishers.length).toBeGreaterThan(0);
    for (const [_id, publisher] of publishers) {
      const needs = typeof publisher.needs === 'string' ? [publisher.needs] : publisher.needs;
      expect(needs?.length, 'Publisher must wait for exact-SHA checks').toBeGreaterThan(0);
      const prerequisites = needs.map((name) => value.jobs[name]);
      for (const job of prerequisites) {
        expect(job, 'Missing prerequisite job').toBeDefined();
        for (const permission of Object.values(job.permissions ?? {}))
          expect(['read', 'none']).toContain(permission);
      }
      const checkSteps = prerequisites
        .flatMap((job) => job.steps ?? [])
        .filter((step) => step.run?.trim() === 'pnpm release:await-checks');
      expect(
        checkSteps.length,
        'Prerequisites must execute the reviewed exact-SHA helper',
      ).toBeGreaterThan(0);
      const manifest = JSON.parse(await source('package.json'));
      expect(manifest.scripts['release:await-checks']).toBe(
        'node tooling/release/cli.mjs await-checks',
      );
      for (const step of checkSteps) {
        expect(step.env?.STARA_SOURCE_SHA).toBe('${{ github.sha }}');
        expect(step['continue-on-error'] ?? false).toBe(false);
        expect(expression(step.if ?? 'always()')).toBe('always()');
      }
      expect(JSON.stringify(prerequisites)).toContain('github.sha');
      expect(expression(publisher.if)).not.toMatch(/always\(\)|\|\|/);
      expect(JSON.stringify(publisher)).toContain('github.sha');
      expect(
        (publisher.steps ?? []).some((step) =>
          step.uses?.startsWith('google-github-actions/auth@'),
        ),
      ).toBe(true);
      for (const [permission, grant] of Object.entries(publisher.permissions)) {
        if (grant === 'write') expect(['id-token', 'attestations']).toContain(permission);
      }
    }
    for (const step of steps(value).filter((step) => step.uses?.startsWith('actions/checkout@'))) {
      expect(step.with?.ref).toBe('${{ github.sha }}');
    }
    expect(raw).not.toMatch(
      /pubsub|repository_dispatch|workflow_dispatch|workflow_run:|\binputs\s*(?:\.|\[)|pull_request_target/i,
    );
    expect(raw).not.toMatch(/gcloud\s+(?:run|deploy|builds)\b|terraform\s+apply/);
  });

  it('dispatches only after the entire image workflow succeeds and scopes OIDC to the topic publisher', async () => {
    const { raw, value } = await workflow('.github/workflows/dispatch.yml');
    expect(Object.keys(value.on)).toEqual(['workflow_run']);
    expect(value.on.workflow_run).toEqual({
      workflows: ['Release images'],
      types: ['completed'],
      branches: ['main'],
    });
    expect(value.permissions).toEqual({ contents: 'read' });
    const privileged = Object.values(value.jobs).filter(
      (job) => job.permissions?.['id-token'] === 'write',
    );
    expect(privileged.length, 'Missing scoped publisher OIDC job').toBeGreaterThan(0);
    for (const job of privileged) {
      const condition = expression(job.if);
      expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
      expect(condition).toContain("github.event.workflow_run.event == 'push'");
      expect(condition).toContain("github.event.workflow_run.head_branch == 'main'");
      expect(condition).toMatch(
        /github\.event\.workflow_run\.head_repository\.id == (?:1363262992|'1363262992')/,
      );
      expect(condition).toMatch(/github\.repository_owner_id == (?:293455507|'293455507')/);
      expect(condition).not.toMatch(/\|\||!=/);
      expect(job.permissions.contents ?? 'none').toBe('read');
      for (const [permission, grant] of Object.entries(job.permissions)) {
        if (grant === 'write') expect(permission).toBe('id-token');
      }
      const auth = (job.steps ?? []).filter((step) =>
        step.uses?.startsWith('google-github-actions/auth@'),
      );
      expect(auth.length).toBeGreaterThan(0);
      for (const step of auth) {
        expect(step.with?.workload_identity_provider).toBeTypeOf('string');
        expect(step.with?.service_account).toBeTypeOf('string');
        expect(JSON.stringify(step.with)).not.toMatch(/github\.event\.|\binputs\b/);
      }
    }
    for (const step of steps(value).filter((step) => step.uses?.startsWith('actions/checkout@'))) {
      expect(step.with?.ref).toBe('${{ github.event.workflow_run.head_sha }}');
    }
    expect(raw).not.toMatch(
      /repository_dispatch|workflow_dispatch|\binputs\s*(?:\.|\[)|pull_request_target/,
    );
    expect(raw).not.toMatch(
      /gcloud\s+(?:run|deploy|builds)\b|cloudbuild\.builds|terraform\s+apply|serviceAccountTokenCreator/,
    );
    expect(raw).not.toMatch(/docker\s+(?:build|push)|build-push-action@|attest-build-provenance@/);
    expect(raw).not.toMatch(/download-artifact@[\s\S]{0,250}path:\s*(?:\.\/?\s|tooling|infra)/);
  });

  it('never uploads broad local artifacts, Terraform state/plans or credentials to public Actions artifacts', async () => {
    for (const name of ['checks', 'release', 'dispatch']) {
      const { value } = await workflow(`.github/workflows/${name}.yml`);
      for (const step of steps(value).filter((item) =>
        item.uses?.startsWith('actions/upload-artifact@'),
      )) {
        const paths = String(step.with?.path ?? '')
          .split('\n')
          .map((path) => path.trim())
          .filter(Boolean);
        expect(paths.length).toBeGreaterThan(0);
        for (const path of paths.filter((item) => !item.startsWith('!'))) {
          expect(path, 'Public upload requires a narrow reviewed evidence location').not.toMatch(
            /^(?:\.?\/?|\*\*?|\.artifacts\/?|infra\/?|infra\/gcp\/?|\*\*\/\*)$/,
          );
          expect(path).not.toMatch(
            /tfstate|tfplan|tfvars|credentials|gha-creds|private|release-infra-test-author/i,
          );
        }
      }
    }
  });

  it.each([
    ['release', 'publish', 'STARA_IMAGE_WIF_PROVIDER', 'STARA_IMAGE_PUBLISHER'],
    ['dispatch', 'dispatch', 'STARA_DISPATCH_WIF_PROVIDER', 'STARA_DISPATCH_PUBLISHER'],
  ])(
    '%s uses secret-backed delivery identifiers without service-account key payloads',
    async (name, jobId, provider, account) => {
      const { raw, value } = await workflow(`.github/workflows/${name}.yml`);
      const job = value.jobs[jobId];
      const auth = job.steps.filter((step) => step.uses?.startsWith('google-github-actions/auth@'));
      expect(auth).toHaveLength(1);
      expect(auth[0].with).toMatchObject({
        project_id: '${{ secrets.STARA_DELIVERY_PROJECT }}',
        workload_identity_provider: `\${{ secrets.${provider} }}`,
        service_account: `\${{ secrets.${account} }}`,
        create_credentials_file: true,
        export_environment_variables: true,
      });
      expect(auth[0].with.cleanup_credentials ?? true).toBe(true);
      expect(auth[0].with).not.toHaveProperty('credentials_json');
      expect(raw).not.toMatch(/\bvars\.STARA_|::add-mask::|\bcredentials_json\b/);
      expect(runs(job)).not.toMatch(/\$\{\{\s*secrets\./);
      const command = job.steps.find(
        (step) => step.run === `pnpm release:${name === 'release' ? 'publish' : 'dispatch'}`,
      );
      const privateInputs =
        name === 'release'
          ? ['STARA_ARTIFACT_BUCKET', 'STARA_IMAGE_REPOSITORY']
          : ['STARA_STAGING_TOPIC', 'STARA_CONFIGURATION_SHA256'];
      for (const key of privateInputs) expect(command.env[key]).toBe(`\${{ secrets.${key} }}`);
    },
  );

  it('logs into only Artifact Registry with the image publisher access token and post-job logout', async () => {
    const { value } = await workflow('.github/workflows/release.yml');
    const job = value.jobs.publish;
    const auth = job.steps.find((step) => step.uses?.startsWith('google-github-actions/auth@'));
    expect(auth.id, 'Auth needs an output ID for the registry login').toMatch(/^[a-zA-Z_][\w-]*$/);
    expect(auth.with.token_format).toBe('access_token');
    const logins = job.steps.filter((step) => step.uses?.startsWith('docker/login-action@'));
    expect(logins, 'Missing credentialed registry login before push').toHaveLength(1);
    const login = logins[0];
    expect(login.uses).toBe('docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9');
    expect(login.with).toMatchObject({
      registry: 'us-central1-docker.pkg.dev',
      username: 'oauth2accesstoken',
      password: `\${{ steps.${auth.id}.outputs.access_token }}`,
    });
    expect(login.with.logout ?? true).toBe(true);
    expect(login['continue-on-error'] ?? false).toBe(false);
    expect(expression(login.if ?? 'success()')).toBe('success()');
    expect(job.steps.indexOf(login)).toBeGreaterThan(job.steps.indexOf(auth));
    expect(job.steps.findIndex((step) => step.run === 'pnpm release:publish')).toBeGreaterThan(
      job.steps.indexOf(login),
    );
    expect(runs(job)).not.toMatch(
      /\b(?:echo|printf|cat)\b[^\n]*(?:access_token|credentials|gha-creds)|\bdocker\s+login\b/,
    );
    const dispatch = (await workflow('.github/workflows/dispatch.yml')).value;
    expect(steps(dispatch).some((step) => step.uses?.startsWith('docker/login-action@'))).toBe(
      false,
    );
  });

  it('ignores only the reviewed generated ADC filename pattern, never all JSON source', async () => {
    const rules = (await source('.gitignore'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(rules).toContain('gha-creds-*.json');
    expect(rules).not.toContain('*.json');
    expect(rules).not.toContain('**/*.json');
  });
});

function dockerStages(text) {
  const lines = text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const stages = [];
  for (const line of lines) {
    if (/^FROM\s/i.test(line)) {
      const match = line.match(/^FROM\s+(\S+)\s+AS\s+([\w-]+)$/i);
      expect(match, 'Use explicitly named stages and pinned base images').not.toBeNull();
      stages.push({ base: match[1], name: match[2], lines: [] });
    } else {
      expect(stages.length, 'Docker instruction outside a named stage').toBeGreaterThan(0);
      stages.at(-1).lines.push(line);
    }
  }
  return stages;
}

function copyInstruction(line) {
  const from = line.match(/--from=([^\s]+)/)?.[1];
  const value = line
    .replace(/^COPY\s+/i, '')
    .replace(/--[\w-]+=[^\s]+\s*/g, '')
    .trim();
  const words = value.startsWith('[') ? JSON.parse(value) : value.split(/\s+/);
  expect(words.length).toBeGreaterThanOrEqual(2);
  return { from, sources: words.slice(0, -1) };
}

describe('release images: source allowlists and separate non-root runtime (no image build claim)', () => {
  it.each(['UI/web/release.Dockerfile', 'backend/api/release.Dockerfile'])(
    '%s confines the runtime dependency graph to explicit release inputs',
    async (path) => {
      const stages = dockerStages(await source(path));
      const byName = new Map(stages.map((stage) => [stage.name, stage]));
      expect(byName.size).toBe(stages.length);
      const runtime = byName.get('runtime');
      expect(runtime, `${path} is missing its release runtime target`).toBeDefined();
      expect(runtime.base).toBe(path.startsWith('UI/') ? nginxImage : nodeRuntimeImage);
      const user = runtime.lines
        .filter((line) => /^USER\s/i.test(line))
        .at(-1)
        ?.slice(5)
        .trim();
      expect(user, 'Runtime must explicitly select a non-root user').toBeDefined();
      expect(user).toMatch(
        /^(?:[1-9][0-9]*|node|nginx|stara)(?::(?:[1-9][0-9]*|node|nginx|stara))?$/,
      );
      const visited = new Set();
      const walk = (stage) => {
        if (visited.has(stage.name)) return;
        visited.add(stage.name);
        if (byName.has(stage.base)) walk(byName.get(stage.base));
        else
          expect(stage === runtime ? [nodeRuntimeImage, nginxImage] : [nodeImage]).toContain(
            stage.base,
          );
        for (const line of stage.lines) {
          expect(line).not.toMatch(/^ADD\s/i);
          expect(line).not.toMatch(/^RUN\s+.*--mount=(?:type=bind|[^\s]*source=\.)/i);
          if (!/^COPY\s/i.test(line)) continue;
          const copy = copyInstruction(line);
          if (copy.from) {
            expect(
              byName.has(copy.from),
              'COPY --from must resolve to a reviewed local build stage',
            ).toBe(true);
            for (const input of copy.sources) {
              expect(input).not.toMatch(/^(?:\/|\.|\/workspace\/?|\/app\/?)$/);
              expect(input).not.toMatch(
                /(?:^|\/)(?:infra|\.git|\.artifacts|tests|credentials)(?:\/|$)/,
              );
            }
            walk(byName.get(copy.from));
          } else {
            const rootInputs = new Set([
              'package.json',
              'pnpm-lock.yaml',
              'pnpm-workspace.yaml',
              '.npmrc',
              'tsconfig.json',
              'LICENSE.md',
              'tooling/config/tsconfig.base.json',
            ]);
            for (const input of copy.sources) {
              const normalized = input.replace(/^\.\//, '').replace(/\/$/, '');
              const approved =
                rootInputs.has(normalized) ||
                /^(?:UI\/(?:web|shared)|backend\/api|tooling)\/package\.json$/.test(normalized) ||
                /^(?:UI\/(?:web|shared)|backend\/api)\/(?:src(?:\/[\w./-]+)?|public(?:\/[\w./-]+)?|index\.html|tsconfig(?:\.[\w-]+)?\.json|vite\.config\.ts|nginx\.conf)$/.test(
                  normalized,
                );
              expect(approved, `Unreviewed release COPY source ${input} in ${stage.name}`).toBe(
                true,
              );
              expect(normalized).not.toMatch(/(?:^|\/)\.\.(?:\/|$)|[*?]|\$/);
            }
          }
        }
      };
      walk(runtime);
      expect([...visited]).not.toContain('development');
      expect(runtime.lines.some((line) => /^COPY\s/i.test(line))).toBe(true);
      for (const stage of stages) {
        for (const line of stage.lines.filter((item) => /^COPY\s/i.test(item))) {
          for (const input of copyInstruction(line).sources) {
            expect(input, 'No release Dockerfile stage may bulk-copy the workspace').not.toMatch(
              /^(?:\.|\.\/|\*|\*\*|\/)$/,
            );
          }
        }
      }
    },
  );

  it('API runtime uses frozen production-only dependencies and copies only deployable outputs and licensing', async () => {
    const stages = dockerStages(await source('backend/api/release.Dockerfile'));
    const dependencyStages = stages.filter((stage) =>
      stage.lines.some(
        (line) =>
          /^RUN\s/.test(line) && /\bpnpm\b.*\binstall\b/.test(line) && /--prod\b/.test(line),
      ),
    );
    expect(
      dependencyStages.length,
      'Missing reproducible production-only dependency stage',
    ).toBeGreaterThan(0);
    for (const stage of dependencyStages) {
      for (const line of stage.lines.filter((item) => /\bpnpm\b.*\binstall\b/.test(item))) {
        expect(line).toContain('--frozen-lockfile');
        expect(line).toContain('--ignore-scripts');
        expect(line).not.toMatch(/--no-frozen-lockfile|--frozen-lockfile=false|--legacy/);
      }
    }
    const runtime = stages.find((stage) => stage.name === 'runtime');
    expect(runtime, 'Missing API runtime target').toBeDefined();
    const inputs = runtime.lines
      .filter((line) => /^COPY\s/.test(line))
      .flatMap((line) => copyInstruction(line).sources);
    expect(inputs.some((path) => /(?:^|\/)LICENSE\.md$/.test(path))).toBe(true);
    expect(inputs.some((path) => /(?:^|\/)dist\/?$/.test(path))).toBe(true);
    expect(inputs.some((path) => /(?:^|\/)node_modules\/?$/.test(path))).toBe(true);
    for (const path of inputs) {
      expect(
        path,
        'API runtime accepts only compiled output, production dependencies, metadata and license',
      ).toMatch(/(?:^|\/)(?:dist\/?|node_modules\/?|package\.json|LICENSE\.md)$/);
    }
  });

  it('preserves development Compose semantics and approved baseline contents', async () => {
    const raw = (await source('compose.yaml')).replace(/\r\n/g, '\n');
    // Approved base 319c9bf; a changed Compose file requires parent agreement.
    expect(createHash('sha256').update(raw).digest('hex')).toBe(
      'e315c1d29a36f7b1f5708df79bf986ccbdaa5ebff4b3052b2b0798c30a718a49',
    );
    const value = parseDocument(raw).toJS();
    expect(value.services.web.build.target).toBe('development');
    expect(value.services.api.build.target).toBe('development');
  });

  it.each([
    ['UI/web/Dockerfile', '0ab978cd245153f57b213d86e031dba02e1c4947902642560324753a70b97118'],
    ['backend/api/Dockerfile', '707d84e3a8925da2499c4a3bb5a4abc96d5b3891aff4fe5d3ccc4438c7bbbfb3'],
  ])('preserves the separate development Dockerfile %s', async (path, hash) => {
    expect(
      createHash('sha256')
        .update((await source(path)).replace(/\r\n/g, '\n'))
        .digest('hex'),
    ).toBe(hash);
  });

  it.each(['UI/web', 'backend/api'])(
    '%s release build context denies everything except explicitly reviewed inputs',
    async (owner) => {
      const raw = await source(`${owner}/release.Dockerfile.dockerignore`);
      const rules = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      expect(['*', '**']).toContain(rules[0]);
      const allowed = rules
        .filter((line) => line.startsWith('!'))
        .map((line) => line.slice(1).replace(/\/$/, ''));
      expect(allowed.length).toBeGreaterThan(0);
      for (const rule of allowed) {
        expect(rule).not.toMatch(/^(?:\*|\*\*|\.|\/|UI\/\*\*|backend\/\*\*|tooling\/\*\*)$/);
        expect(rule).not.toMatch(
          /(?:^|\/)(?:infra|\.git|\.artifacts|\.env|credentials|tests)(?:[/.]|$)/,
        );
        expect(rule).not.toMatch(/tfstate|tfvars|tfplan/);
      }
      expect(allowed).toContain('package.json');
      expect(allowed).toContain('pnpm-lock.yaml');
      expect(allowed.some((rule) => rule.startsWith(`${owner}/`))).toBe(true);
    },
  );

  it('includes authored release controls in whole-target coverage without relaxing floors', async () => {
    const url = new URL('../vitest.config.mjs', import.meta.url);
    const config = (await import(/* @vite-ignore */ url.href)).default;
    expect(config.test.coverage.include).toContain('release/**/*.mjs');
    expect(config.test.coverage.thresholds.lines).toBeGreaterThanOrEqual(90);
    expect(config.test.coverage.thresholds.branches).toBeGreaterThanOrEqual(85);
    expect(config.test.coverage.exclude ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/release/)]),
    );
  });
});
