import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: { verification: { type: 'string' }, mutation: { type: 'string' } },
});
for (const label of Object.values(values)) {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use local evidence labels, not paths');
}
if (!values.verification || !values.mutation)
  throw new Error('Both completed evidence labels are required');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (map) =>
  sha256(JSON.stringify(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))));
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function evidence(label) {
  const names = (await readdir(join(root, 'evidence')))
    .filter((name) => name.endsWith(`-${label}`))
    .sort();
  if (!names.length) throw new Error(`Missing local evidence: ${label}`);
  const directory = join(root, 'evidence', names.at(-1));
  return { directory, manifest: await readJson(join(directory, 'manifest.json')) };
}

async function publicFiles(directory = root, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const hashes = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'evidence' || entry.name === 'protected-tests.manifest.json') continue;
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error('Protected sources cannot be symbolic links');
    if (entry.isDirectory())
      Object.assign(hashes, await publicFiles(join(directory, entry.name), `${name}/`));
    else hashes[`tooling/tests/${name}`] = sha256(await readFile(join(directory, entry.name)));
  }
  return hashes;
}

const redLabels = [
  'adversarial-negative-controls',
  'review-contracts-red',
  'path-casing-red',
  'pnpm-root-record-red',
  'staged-cache-red',
  'primitive-projection-red',
  'staged-source-path-red',
  'ambiguous-windows-index-red',
  'staged-evidence-durability-red',
  'selective-mutation-gate-red',
  'docker-diagnostic-red',
  'nested-eslint-artifacts-red',
  'outgoing-push-behavior-red',
  'outgoing-hook-contracts-red',
  'outgoing-nested-source-drift-red',
  'outgoing-utf8-input-red',
  'isolated-pnpm-auto-install-red',
  'isolated-pnpm-fixed',
  'bootstrap-preinstall-lock-red',
  'bootstrap-preinstall-lock-fixed',
  'ordinary-pnpm-key-casing-red',
  'lifecycle-discovery-contract-red',
];
const red = [];
for (const label of redLabels) {
  const { manifest } = await evidence(label);
  const filterIndex = manifest.command?.indexOf('--testNamePattern') ?? -1;
  const filter = filterIndex >= 0 ? manifest.command[filterIndex + 1] : null;
  if (manifest.counts.failed < 1 || (manifest.counts.pending !== 0 && !filter))
    throw new Error(`Not executed behavioral red: ${label}`);
  red.push({
    label,
    timestamp: manifest.timestamp,
    counts: manifest.counts,
    ...(filter
      ? {
          filter,
          executed: manifest.counts.passed + manifest.counts.failed,
          unselected: manifest.counts.pending,
        }
      : {}),
    logSha256: manifest.logSha256,
    testSetSha256: identity(manifest.tests),
    sourceSetSha256: identity(manifest.production),
  });
}
const verification = await evidence(values.verification);
const mutation = await evidence(values.mutation);
if (
  verification.manifest.exitCode !== 0 ||
  verification.manifest.counts.failed ||
  verification.manifest.counts.pending
)
  throw new Error('Verification is not entirely green');
if (mutation.manifest.exitCode !== 0 || !mutation.manifest.counts.Killed)
  throw new Error('Mutation run has no successful behavioral kills');
const coverage = await readJson(join(verification.directory, 'coverage/coverage-summary.json'));
const files = await publicFiles();
for (const [path, hash] of Object.entries(files)) {
  const name = path.slice('tooling/tests/'.length);
  if (
    (name.endsWith('.contract.test.mjs') ||
      ['fixtures.mjs', 'vitest.contract.config.mjs'].includes(name)) &&
    verification.manifest.tests[name] !== hash
  )
    throw new Error(`Protected executed input changed after verification: ${path}`);
}
for (const [path, hash] of Object.entries(mutation.manifest.sourceHashes))
  if (verification.manifest.production[path] !== hash)
    throw new Error(`Mutation source differs from verified candidate: ${path}`);
for (const [name, hash] of Object.entries(mutation.manifest.testHashes))
  if (files[`tooling/tests/${name}`] !== hash)
    throw new Error(`Mutation test input changed: ${name}`);
const document = 'docs/evidence/control-test-design.md';
files[document] = sha256(await readFile(join(root, '../..', document)));
const manifest = {
  schemaVersion: 1,
  role: 'independent-test-author; not final verifier',
  files,
  initialBehavioralRed: red,
  verification: {
    label: values.verification,
    timestamp: verification.manifest.timestamp,
    node: verification.manifest.node,
    platform: verification.manifest.platform,
    vitest: verification.manifest.vitestVersion,
    counts: verification.manifest.counts,
    coverage: coverage.total,
    production: verification.manifest.production,
    logSha256: verification.manifest.logSha256,
  },
  mutation: {
    label: values.mutation,
    tool: 'StrykerJS',
    version: mutation.manifest.version,
    runner: 'official command runner invoking Vitest CLI',
    scope: ['classifyChanges', 'assertCoverage', 'assertRequiredResults'],
    counts: mutation.manifest.counts,
    sourceHashes: mutation.manifest.sourceHashes,
    testHashes: mutation.manifest.testHashes,
    logSha256: mutation.manifest.logSha256,
    reportSha256: mutation.manifest.reportSha256,
    inputsMatchVerifiedCandidate: true,
    survivorReview: 'See docs/evidence/control-test-design.md; no arbitrary score threshold',
  },
  exclusions: ['tooling/tests/evidence/**'],
};
await writeFile(
  join(root, 'protected-tests.manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(
  `Protected ${Object.keys(files).length} public source files; raw evidence excluded.\n`,
);
