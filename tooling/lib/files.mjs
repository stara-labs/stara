import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export function within(parent, child) {
  const path = relative(parent, child);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function assertUnlinked(path) {
  const absolute = resolve(path);
  if (await exists(absolute)) {
    if ((await lstat(absolute)).isSymbolicLink())
      throw new Error(`Linked path is not isolated: ${absolute}`);
  }
  const parent = dirname(absolute);
  if (parent !== absolute) await assertUnlinked(parent);
}

export async function ownedTemporary(action) {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, 'stara-tooling-'));
  const cleanup = async () => {
    await assertUnlinked(root);
    const actual = await realpath(root);
    if (!within(parent, actual) || actual !== root) throw new Error('Unsafe temporary cleanup');
    await rm(actual, { recursive: true, force: true });
  };
  try {
    return await action(root);
  } finally {
    await cleanup();
  }
}

export async function listFiles(
  root,
  prefix = '',
  excluded = [
    '.git',
    '.terraform',
    'node_modules',
    '.artifacts',
    'dist',
    'coverage',
    'test-results',
    'playwright-report',
  ],
) {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excluded.includes(entry.name) || excluded.includes(path)) continue;
    if (entry.isDirectory()) result.push(...(await listFiles(root, path, excluded)));
    else result.push(path);
  }
  return result;
}

export const candidateSourceFiles = (root) =>
  listFiles(root, '', ['node_modules', '.artifacts', 'UI/web/dist', 'backend/api/dist']);

export async function emptyDestination(repo, destination) {
  const target = resolve(destination);
  await assertUnlinked(target);
  const source = await realpath(repo);
  if (target === source || within(source, target) || !within(await realpath(tmpdir()), target)) {
    throw new Error('Snapshot destination must be outside the repository in temporary storage');
  }
  if ((await exists(target)) && (await readdir(target)).length)
    throw new Error('Snapshot destination is not empty');
  await mkdir(target, { recursive: true });
  return target;
}
