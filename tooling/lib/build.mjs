import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertUnlinked, candidateSourceFiles, listFiles, readJson } from './files.mjs';
import { fileHashes, hashIdentity, writeEvidence } from './evidence.mjs';
import { hashBytes } from './integrity.mjs';

const outputs = {
  '@stara/web': 'UI/web/dist/index.html',
  '@stara/api': 'backend/api/dist/index.js',
};

export async function artifact(runtime, targets = Object.keys(outputs), since = 0) {
  const artifacts = {};
  for (const target of targets) {
    if (!outputs[target]) throw new Error(`No build artifact owner for ${target}`);
    const entry = join(runtime.root, outputs[target]);
    await assertUnlinked(entry);
    const details = await stat(entry);
    if (
      !details.isFile() ||
      !details.size ||
      details.mtimeMs < since ||
      !(await readFile(entry, 'utf8')).trim()
    ) {
      throw new Error(`Missing, empty, or stale build output: ${target}`);
    }
    const directory = dirname(outputs[target]);
    const files = (await listFiles(join(runtime.root, directory), '', [])).map(
      (file) => `${directory}/${file}`,
    );
    Object.assign(artifacts, await fileHashes(runtime.root, files));
  }
  if (!Object.keys(artifacts).length) throw new Error('Build artifacts are missing');
  const sourceFiles = await (runtime.candidate
    ? candidateSourceFiles(runtime.root)
    : listFiles(runtime.root));
  const sourceHashes = await fileHashes(runtime.root, sourceFiles);
  const sourceIdentity = hashIdentity(sourceHashes);
  if (runtime.candidate && sourceIdentity !== runtime.sourceIdentity)
    throw new Error('Candidate source drift invalidates build provenance');
  const configHashes = Object.fromEntries(
    Object.entries(sourceHashes).filter(
      ([file]) =>
        !file.includes('/') ||
        /(?:package\.json|config\.[^/]+|Dockerfile)$/.test(file) ||
        file.startsWith('.github/'),
    ),
  );
  const revision =
    runtime.candidate?.commit ?? (await runtime.git(['rev-parse', 'HEAD'])).stdout.trim();
  if (!/^[a-f0-9]{40,64}$/i.test(revision)) throw new Error('Missing exact build revision');
  const nodeVersion = (await runtime.run(runtime.node, ['--version'], { timeout: 10000 })).stdout
    .trim()
    .replace(/^v/, '');
  const pnpmVersion = (await runtime.pnpm(['--version'], { timeout: 10000 })).stdout.trim();
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion) || !/^\d+\.\d+\.\d+$/.test(pnpmVersion))
    throw new Error('Missing build runtime version');
  const consumer = await readJson(join(runtime.root, 'docs/product-system.json'));
  if (!/^[a-f0-9]{40}$/i.test(consumer.revision))
    throw new Error('Missing Product System revision');
  const manifest = {
    schemaVersion: 1,
    revision,
    ...(runtime.candidate ? { candidate: runtime.candidate } : {}),
    dirty: runtime.candidate
      ? false
      : Boolean(
          (await runtime.git(['status', '--porcelain=v1', '--untracked-files=all'])).stdout.trim(),
        ),
    sourceHashes,
    sourceIdentity,
    lockfileSha256: hashBytes(await readFile(join(runtime.root, 'pnpm-lock.yaml'))),
    productSystemRevision: consumer.revision,
    configHashes,
    nodeVersion,
    pnpmVersion,
    actor: runtime.actor,
    runId: runtime.runId,
    createdAt: new Date().toISOString(),
    targets,
    artifacts,
    artifactIdentity: hashIdentity(artifacts),
  };
  await writeEvidence(runtime.root, '.artifacts/build/manifest.json', manifest);
  return manifest;
}
