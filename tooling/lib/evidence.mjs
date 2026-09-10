import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertUnlinked, exists, listFiles, readJson } from './files.mjs';
import { hashBytes } from './integrity.mjs';
import { safeRelativePath } from './policy.mjs';

export function sanitize(value, env = {}, limit = 1024 * 1024) {
  let text = String(value ?? '');
  for (const [name, secret] of Object.entries(env)) {
    if (/(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|API_KEY)/i.test(name) && secret)
      text = text.split(String(secret)).join('[REDACTED]');
  }
  text = text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /((?:token|password|secret|credential|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(--(?:token|password|secret|credential|api[_-]?key)\s+)\S+/gi, '$1[REDACTED]')
    .replace(/(authorization:\s*(?:bearer|basic)\s+)\S+/gi, '$1[REDACTED]');
  const bytes = Buffer.from(text);
  return bytes.length > limit ? bytes.subarray(0, Math.max(0, limit - 3)).toString('utf8') : text;
}

export function hashIdentity(hashes) {
  return hashBytes(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))));
}

export async function writeEvidence(root, path, value) {
  const destination = join(root, path);
  await assertUnlinked(destination);
  await mkdir(join(destination, '..'), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

export async function recordCommand(runtime, record, stdout, stderr) {
  const directory = `.artifacts/gates/${runtime.runId}`;
  const index = join(runtime.root, directory, 'commands.json');
  await assertUnlinked(index);
  const records = (await exists(index)) ? await readJson(index) : [];
  if (!Array.isArray(records)) throw new Error('Malformed command evidence');
  const sequence = String(records.length + 1).padStart(4, '0');
  const safe = JSON.parse(
    JSON.stringify(record, (_key, value) =>
      typeof value === 'string' ? sanitize(value, runtime.env, 8192) : value,
    ),
  );
  for (const [kind, text] of [
    ['stdout', stdout],
    ['stderr', stderr],
  ]) {
    const file = `${sequence}.${kind}.log`;
    const path = join(runtime.root, directory, file);
    await assertUnlinked(path);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, sanitize(text, runtime.env));
    safe[`${kind}File`] = file;
  }
  records.push(safe);
  await writeEvidence(runtime.root, `${directory}/commands.json`, records);
}

export async function fileHashes(root, files) {
  const hashes = {};
  for (const file of files.sort()) {
    const path = join(root, file);
    await assertUnlinked(path);
    hashes[file] = hashBytes(await readFile(path));
  }
  return hashes;
}

export async function preserveStagedEvidence(runtime, snapshot) {
  const relative = `.artifacts/gates/${runtime.runId}`;
  const source = join(snapshot, relative);
  if (!(await exists(source))) return null;
  await assertUnlinked(source);
  for (const file of await listFiles(source, '', [])) {
    const from = join(source, file);
    const to = join(runtime.root, relative, 'snapshot', file);
    await assertUnlinked(from);
    await assertUnlinked(to);
    await mkdir(join(to, '..'), { recursive: true });
    await writeFile(to, sanitize(await readFile(from, 'utf8'), runtime.env));
  }
  const evidence = {};
  for (const name of ['selection', 'results']) {
    const path = join(source, `${name}.json`);
    if (!(await exists(path))) continue;
    evidence[name] = JSON.parse(
      JSON.stringify(await readJson(path), (_key, value) =>
        typeof value === 'string' ? sanitize(value, runtime.env) : value,
      ),
    );
    await writeEvidence(runtime.root, `${relative}/${name}.json`, evidence[name]);
  }
  if (runtime.candidate) {
    const path = join(snapshot, '.artifacts/build/manifest.json');
    await assertUnlinked(path);
    if (await exists(path)) {
      const manifest = await readJson(path);
      if (
        !manifest.candidate ||
        ['commit', 'tree', 'base'].some(
          (key) => manifest.candidate[key] !== runtime.candidate[key],
        ) ||
        manifest.revision !== runtime.candidate.commit ||
        manifest.dirty !== false ||
        manifest.sourceIdentity !== runtime.sourceIdentity
      )
        throw new Error('Build evidence is not bound to the push candidate');
      await writeEvidence(runtime.root, `${relative}/build-manifest.json`, manifest);
      for (const [file, expected] of Object.entries(manifest.artifacts)) {
        if (
          !safeRelativePath(file) ||
          !['UI/web/dist/', 'backend/api/dist/'].some((prefix) => file.startsWith(prefix))
        )
          throw new Error('Unsafe retained build artifact path');
        const from = join(snapshot, file);
        const to = join(runtime.root, relative, 'build', file);
        await assertUnlinked(from);
        await assertUnlinked(to);
        const bytes = await readFile(from);
        if (hashBytes(bytes) !== expected)
          throw new Error('Build output changed after provenance capture');
        await mkdir(join(to, '..'), { recursive: true });
        await writeFile(to, bytes);
      }
    } else if (
      evidence.results?.results?.some(
        (result) => result.name === 'artifact' && result.status === 'pass',
      )
    ) {
      throw new Error('Required push build manifest is missing');
    }
  }
  return evidence;
}
