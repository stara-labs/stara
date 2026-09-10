import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { emptyDestination, ownedTemporary } from './files.mjs';
import { safeRelativePath } from './policy.mjs';

const execute = promisify(execFile);

function gitReader(repo) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
  );
  return async (args, extra = {}) =>
    (
      await execute('git', args, {
        cwd: repo,
        env: { ...environment, GIT_NO_REPLACE_OBJECTS: '1', ...extra },
        encoding: 'buffer',
        timeout: 30000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      })
    ).stdout;
}

export function validateInventoryPaths(paths) {
  const aliases = new Map();
  const files = new Set();
  for (const path of paths) {
    if (!safeRelativePath(path) || files.has(path))
      throw new Error('Unsafe or duplicate staged path');
    files.add(path);
    const parts = path.split('/');
    for (let count = 1; count <= parts.length; count++) {
      const prefix = parts.slice(0, count).join('/');
      const kind = count === parts.length ? 'file' : 'directory';
      const key = prefix.normalize('NFC').toLowerCase();
      const previous = aliases.get(key);
      if (previous && (previous.prefix !== prefix || previous.kind !== kind)) {
        throw new Error('Staged paths collide across filesystem naming rules');
      }
      aliases.set(key, { prefix, kind });
    }
  }
  return true;
}

export async function materializeIndex(repo, destination) {
  const git = gitReader(repo);
  const index = resolve(repo, (await git(['rev-parse', '--git-path', 'index'])).toString().trim());
  const indexRecords = (await git(['ls-files', '--stage', '-z']))
    .toString()
    .split('\0')
    .filter(Boolean);
  const indexPaths = indexRecords.map((record) => {
    const tab = record.indexOf('\t');
    if (record.slice(0, tab).split(' ')[2] !== '0') throw new Error('Unresolved staged conflict');
    return record.slice(tab + 1);
  });
  validateInventoryPaths(indexPaths);
  return ownedTemporary(async (metadata) => {
    const frozenIndex = join(metadata, 'index');
    await copyFile(index, frozenIndex);
    const env = { GIT_INDEX_FILE: frozenIndex };
    // write-tree updates only the copied index; blobs bypass checkout filters and CRLF conversion.
    const tree = (await git(['write-tree'], env)).toString().trim();
    return materializeTree(repo, destination, tree, git);
  });
}

export async function materializeCommit(repo, destination, commit) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit))
    throw new Error('Snapshot requires a full immutable commit object ID');
  const git = gitReader(repo);
  if ((await git(['cat-file', '-t', commit])).toString().trim() !== 'commit')
    throw new Error('Snapshot object is not a commit');
  const tree = (await git(['rev-parse', `${commit}^{tree}`])).toString().trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(tree))
    throw new Error('Snapshot commit has no valid tree');
  return { ...(await materializeTree(repo, destination, tree, git)), commit };
}

async function materializeTree(repo, destination, tree, git) {
  const records = (await git(['ls-tree', '-r', '-z', tree])).toString().split('\0').filter(Boolean);
  const entries = records.map((record) => {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (
      !safeRelativePath(path) ||
      path
        .split('/')
        .some((part) =>
          [
            'node_modules',
            '.pnpm-store',
            '.artifacts',
            'dist',
            'coverage',
            'test-results',
            'playwright-report',
          ].includes(part.toLowerCase()),
        ) ||
      type !== 'blob' ||
      !['100644', '100755'].includes(mode)
    ) {
      throw new Error('Snapshot contains unsafe path, symbolic link, or submodule');
    }
    return { mode, oid, path };
  });
  validateInventoryPaths(entries.map((entry) => entry.path));
  const target = await emptyDestination(repo, destination);
  for (const entry of entries) {
    const path = join(target, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await git(['cat-file', 'blob', entry.oid]), { flag: 'wx' });
    if (entry.mode === '100755') await chmod(path, 0o755);
  }
  return { tree, files: entries.map((entry) => entry.path) };
}
