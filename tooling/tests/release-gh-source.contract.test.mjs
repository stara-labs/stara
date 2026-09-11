import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const goImage =
  'golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81';
const commit = '45437bc7eeeb3359bbfddd1742f79de7652fd3e2';
const archive = `https://codeload.github.com/cli/cli/tar.gz/${commit}`;
const archiveSha256 = 'e16749bc0d99dc0633a3d5ebadf48ffff1c24beb1ce83e8f6a71bb64ce477e9a';
const moduleSum = 'h1:hUv+3cXcdRHz08UmSiOob7sadHig73uo5bkXxQ/tvUs=';
const goModSum = 'h1:0/weTWkPWGBikyTWAX3dkjVztMmBA5hM0DH6BElSupE=';
const scanner =
  'aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969';
const source = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
const flatten = (text) =>
  text
    .replace(/^\s*#.*$/gm, '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/[\t ]+/g, ' ');

async function recipe() {
  const raw = flatten(await source('tooling/release/Dockerfile'));
  const stages = [...raw.matchAll(/^FROM (\S+) AS ([\w-]+)\s*$/gm)];
  const stage = (name) => {
    const index = stages.findIndex((item) => item[2] === name);
    expect(index, `Missing reviewed Docker stage ${name}`).toBeGreaterThanOrEqual(0);
    return raw.slice(stages[index].index, stages[index + 1]?.index ?? raw.length);
  };
  return { raw, stages, stage };
}

function blocking(step) {
  expect(step.if).toBeUndefined();
  expect(step['continue-on-error'] ?? false).toBe(false);
  expect(step.run).toContain('set -euo pipefail');
  expect(step.run).not.toMatch(
    /\|\||continue-on-error|--ignore-unfixed|--ignorefile|TRIVY_IGNORE|\.trivyignore/,
  );
}

function requireNonRootBuild(gh) {
  const firstTest = gh.indexOf('go test ');
  const firstBuild = gh.indexOf('go build ');
  const users = [...gh.matchAll(/^USER (\S+)\s*$/gm)];
  const active = users.filter((user) => user.index < firstTest).at(-1);
  expect(active, 'An explicit non-root USER must precede upstream tests').toBeDefined();
  expect(firstTest).toBeGreaterThan(active.index);
  expect(firstBuild).toBeGreaterThan(active.index);
  for (const user of users.filter((user) => user.index >= active.index))
    expect(user[1], 'GH tests and compilation must never return to root').toMatch(
      /^(?:builder(?::builder)?|10001(?::10001)?)$/,
    );
  const setup = gh.slice(0, active.index);
  expect(setup).toContain('useradd --uid 10001 --create-home builder');
  expect(setup).toContain('mkdir -p /opt/gh');
  expect(setup).toContain('chown -R builder:builder /src /opt/gh /go/pkg');
  expect(setup).toMatch(/^ENV (?:[^\n]* )?HOME=\/home\/builder(?: |$)/m);
}

describe('patched GH source build: static intent, actual upstream tests and scans required', () => {
  it('locks upstream source and Go toolchain without fallback downloads or automatic toolchain changes', async () => {
    const { stage } = await recipe();
    const gh = stage('gh');
    expect(gh).toContain(`FROM ${goImage} AS gh`);
    expect(gh).toContain(`ADD --checksum=sha256:${archiveSha256} ${archive} /tmp/gh.tar.gz`);
    expect(gh.match(/^ADD /gm)).toHaveLength(1);
    const env = Object.fromEntries(
      gh
        .split('\n')
        .filter((line) => line.startsWith('ENV '))
        .flatMap((line) =>
          line
            .slice(4)
            .trim()
            .split(/\s+/)
            .map((pair) => {
              const separator = pair.indexOf('=');
              return [pair.slice(0, separator), pair.slice(separator + 1)];
            }),
        ),
    );
    expect(env).toMatchObject({
      GOTOOLCHAIN: 'local',
      GOSUMDB: 'sum.golang.org',
      GOPROXY: 'https://proxy.golang.org',
      GOFLAGS: '-mod=readonly',
      CGO_ENABLED: '0',
      GOMAXPROCS: '2',
    });
    expect(gh).not.toMatch(
      /\b(?:curl|wget|apt-get)\b|GONOSUMDB|GOPRIVATE|GOSUMDB=off|gh_2\.100\.0_linux_amd64/,
    );
  });

  it('patches only x/mod with the reviewed sums and verifies the selected version', async () => {
    const { stage } = await recipe();
    const gh = stage('gh');
    const sums = (await source('tooling/release/gh-x-mod.sum')).trim().split(/\r?\n/);
    expect(sums).toEqual([
      `golang.org/x/mod v0.40.0 ${moduleSum}`,
      `golang.org/x/mod v0.40.0/go.mod ${goModSum}`,
    ]);
    expect(gh).toContain('COPY tooling/release/gh-x-mod.sum /tmp/gh-x-mod.sum');
    expect(gh.match(/go mod edit[^&\n;]*/g)?.map((command) => command.trim())).toEqual([
      'go mod edit -require=golang.org/x/mod@v0.40.0',
    ]);
    expect(gh).toContain('cat /tmp/gh-x-mod.sum >> go.sum');
    expect(gh).toContain('go mod download');
    expect(gh).toContain('go mod verify');
    expect(gh).toMatch(
      /test "\$\(go list -m -f '\{\{\.Version\}\}' golang\.org\/x\/mod\)" = ['"]?v0\.40\.0['"]?/,
    );
    expect(gh).not.toMatch(/\bgo get\b|go mod (?:tidy|vendor)|-mod=mod|\|\||\bsed\b|\bpatch\b/);
  });

  it('runs both complete upstream suites before the reproducible versioned build', async () => {
    const { stage } = await recipe();
    const gh = stage('gh');
    const phases = [
      'go mod edit -require=golang.org/x/mod@v0.40.0',
      'cat /tmp/gh-x-mod.sum >> go.sum',
      'go mod download',
      'go mod verify',
      'go test ./...',
      'go test golang.org/x/mod/sumdb/...',
      'go build',
    ];
    let previous = -1;
    for (const phase of phases) {
      const at = gh.indexOf(phase);
      expect(at, phase).toBeGreaterThan(previous);
      previous = at;
    }
    expect(gh.match(/go test[^&\n;]*/g)?.map((command) => command.trim())).toEqual([
      'go test ./...',
      'go test golang.org/x/mod/sumdb/...',
    ]);
    const build = gh.match(/go build[^&\n;]*/)?.[0];
    expect(build).toContain('-trimpath');
    expect(build).toContain('-buildvcs=false');
    expect(build).toContain('-ldflags');
    expect(build).toContain('-X github.com/cli/cli/v2/internal/build.Version=2.100.0-stara.1');
    expect(build).toContain('-X github.com/cli/cli/v2/internal/build.Date=2026-09-03');
    expect(build).toContain('-o /opt/gh/bin/gh');
    expect(build).toMatch(/\.\/cmd\/gh\s*$/);
    expect(gh).not.toMatch(/\|\||;|\bexit 0\b|\btrue\b/);
  });

  it('runs upstream tests and compilation as the owned non-root builder, preserving permission errors', async () => {
    const { stage } = await recipe();
    const gh = stage('gh');
    requireNonRootBuild(gh);
    const rootRun = gh.replace(/^USER \S+\s*$/gm, 'USER root');
    expect(() => requireNonRootBuild(rootRun)).toThrow(
      /GH tests and compilation must never return to root/,
    );
  });

  it('records source/toolchain/module facts with room for additional public metadata', async () => {
    const raw = await source('tooling/release/gh-build.json');
    JSON.parse(raw);
    const document = parseDocument(raw, { schema: 'json', uniqueKeys: true });
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toMatchObject({
      source: { repository: 'https://github.com/cli/cli', commit, archive, sha256: archiveSha256 },
      toolchainImage: goImage,
      version: '2.100.0-stara.1',
      xMod: { version: 'v0.40.0', sum: moduleSum, goModSum },
    });
  });

  it('exports only the built tool, license, provenance and checksums from scratch', async () => {
    const { stage } = await recipe();
    const gh = stage('gh');
    const artifact = stage('gh-artifact');
    expect(
      artifact
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ).toEqual(['FROM scratch AS gh-artifact', 'COPY --from=gh /opt/gh/ /']);
    expect(gh).toContain('COPY tooling/release/gh-build.json /opt/gh/provenance/source.json');
    expect(gh).toMatch(/cp LICENSE \/opt\/gh\/LICENSE/);
    expect(gh).toMatch(/cp go\.mod go\.sum \/opt\/gh\/provenance\//);
    expect(gh).toContain('go version -m /opt/gh/bin/gh > /opt/gh/provenance/modules.txt');
    expect(gh).toContain('/opt/gh/bin/gh --version > /opt/gh/provenance/version.txt');
    const hashes = gh
      .match(/sha256sum ([^>\n]+)> SHA256SUMS/)?.[1]
      .trim()
      .split(/\s+/);
    expect(hashes?.sort()).toEqual(
      [
        'bin/gh',
        'LICENSE',
        'provenance/go.mod',
        'provenance/go.sum',
        'provenance/modules.txt',
        'provenance/version.txt',
        'provenance/source.json',
      ].sort(),
    );
    expect(gh).toMatch(/cd \/opt\/gh\s*&&\s*sha256sum/);
  });

  it('adds only the two explicit build metadata files to the control context allowlist', async () => {
    const lines = (await source('tooling/release/Dockerfile.dockerignore'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    expect(lines[0]).toBe('**');
    expect(lines.filter((line) => line.startsWith('!')).sort()).toEqual(
      [
        '!package.json',
        '!pnpm-lock.yaml',
        '!pnpm-workspace.yaml',
        '!.npmrc',
        '!LICENSE.md',
        '!tooling/package.json',
        '!tooling/lib/**',
        '!tooling/release/*.mjs',
        '!tooling/release/gh-x-mod.sum',
        '!tooling/release/gh-build.json',
      ].sort(),
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        '**/.env*',
        '**/credentials*',
        '**/node_modules',
        '**/.artifacts',
        '**/*.tfstate*',
        '**/*.tfplan',
        '**/*.tfvars*',
      ]),
    );
  });

  it('blocks the existing read-only image job on both control scans without exposing raw reports', async () => {
    const document = parseDocument(await source('.github/workflows/checks.yml'), {
      uniqueKeys: true,
    });
    expect(document.errors).toEqual([]);
    const workflow = document.toJS();
    expect(Object.keys(workflow.jobs).sort()).toEqual(
      ['verify', 'windows', 'containers', 'release-images', 'required'].sort(),
    );
    expect(workflow.jobs.required.needs).toEqual([
      'verify',
      'windows',
      'containers',
      'release-images',
    ]);
    const job = workflow.jobs['release-images'];
    expect(job['timeout-minutes']).toBe(30);
    expect(job.if).toBeUndefined();
    expect(job['continue-on-error'] ?? false).toBe(false);
    expect(JSON.stringify(job)).not.toMatch(
      /google-github-actions\/auth@|id-token.*write|secrets\s*(?:\.|\[)|docker\/login-action/,
    );
    const buildSteps = job.steps.filter((step) =>
      /docker (?:buildx )?build[^\n]*tooling\/release\/Dockerfile/.test(flatten(step.run ?? '')),
    );
    expect(buildSteps).toHaveLength(1);
    blocking(buildSteps[0]);
    expect(flatten(buildSteps[0].run)).toMatch(/--platform linux\/amd64/);
    expect(buildSteps[0].run).toContain('--iidfile');
    const allCode = flatten(job.steps.map((step) => step.run ?? '').join('\n'));
    expect(allCode).toMatch(/docker image save[^\n]*--output[^\n]*control\.tar/);
    const scans = job.steps.filter((step) => (step.run ?? '').includes(scanner));
    expect(scans).toHaveLength(2);
    for (const step of scans) {
      blocking(step);
      expect(job.steps.indexOf(step)).toBeGreaterThan(job.steps.indexOf(buildSteps[0]));
      const code = flatten(step.run);
      expect(code).toMatch(/docker run[^\n]*--rm/);
      expect(code).toMatch(/--input \/evidence\/control\.tar/);
      expect(code).toMatch(/--exit-code[= ]1\b/);
      expect(code).not.toMatch(/--exit-code[= ]0|--skip|--ignore|--offline-scan/);
    }
    const vulnerability = scans.find((step) => /--scanners vuln\b/.test(step.run));
    const secrets = scans.find((step) => /--scanners secret\b/.test(step.run));
    expect(vulnerability).toBeDefined();
    expect(secrets).toBeDefined();
    expect(vulnerability.run).toMatch(/--severity[= ]HIGH,CRITICAL/);
    expect(secrets.run).not.toContain('--severity');
    for (const step of job.steps.filter((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    ))
      expect(step.with.path).toBe('.artifacts/public-release/results.json');
  });
});
