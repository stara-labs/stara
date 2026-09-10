import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let materializeIndex;
let materializeCommit;
const ownedTemps = [];
beforeAll(async () => {
  const moduleUrl = new URL('../lib/snapshot.mjs', import.meta.url);
  ({ materializeIndex, materializeCommit } = await import(/* @vite-ignore */ moduleUrl.href));
});

describe('materializeCommit: immutable outgoing objects are independent of the index', () => {
  it('materializes exact outgoing bytes while excluding both staged and unstaged repairs', async () => {
    const { repo, destination } = await fixture();
    const commit = git(repo, 'rev-parse', 'HEAD').toString().trim();
    const tree = git(repo, 'rev-parse', 'HEAD^{tree}').toString().trim();
    const original = git(repo, 'show', 'HEAD:partial.txt');
    await write(repo, 'partial.txt', 'staged repair\n');
    git(repo, 'add', 'partial.txt');
    await write(repo, 'partial.txt', 'unstaged repair\n');
    await write(repo, 'untracked-private.txt', 'untracked synthetic bytes\n');
    const before = await stateOf(repo);
    const result = await materializeCommit(repo, destination, commit);
    expect(result).toMatchObject({ commit, tree });
    expect(await readFile(join(destination, 'partial.txt'))).toEqual(original);
    expect(existsSync(join(destination, 'untracked-private.txt'))).toBe(false);
    expect(existsSync(join(destination, '.git'))).toBe(false);
    expect(await stateOf(repo)).toEqual(before);
  });

  it.each(['HEAD', 'main', '--help', '../outside', 'f'.repeat(40)])(
    'rejects nonimmutable or missing commit %s before destination writes',
    async (commit) => {
      const { repo, destination } = await fixture();
      await expect(materializeCommit(repo, destination, commit)).rejects.toThrow();
      expect(existsSync(destination)).toBe(false);
    },
  );

  it('rejects a tree object rather than silently treating it as a commit', async () => {
    const { repo, destination } = await fixture();
    const tree = git(repo, 'rev-parse', 'HEAD^{tree}').toString().trim();
    await expect(materializeCommit(repo, destination, tree)).rejects.toThrow();
    expect(existsSync(destination)).toBe(false);
  });

  it('does not honor Git replacement objects for a pinned outgoing commit', async () => {
    const { repo, destination } = await fixture();
    const commit = git(repo, 'rev-parse', 'HEAD').toString().trim();
    const original = git(repo, 'show', 'HEAD:partial.txt');
    await write(repo, 'partial.txt', 'replacement object bytes\n');
    git(repo, 'add', 'partial.txt');
    git(repo, 'commit', '-m', 'Synthetic replacement object');
    git(repo, 'replace', commit, git(repo, 'rev-parse', 'HEAD').toString().trim());
    await materializeCommit(repo, destination, commit);
    expect(await readFile(join(destination, 'partial.txt'))).toEqual(original);
  });

  it('ignores inherited Git directory and index redirection', async () => {
    const { repo, destination } = await fixture();
    const decoy = await fixture();
    const commit = git(repo, 'rev-parse', 'HEAD').toString().trim();
    await write(decoy.repo, 'partial.txt', 'redirected decoy bytes\n');
    git(decoy.repo, 'add', 'partial.txt');
    vi.stubEnv('GIT_DIR', join(decoy.repo, '.git'));
    vi.stubEnv('GIT_WORK_TREE', decoy.repo);
    vi.stubEnv('GIT_INDEX_FILE', join(decoy.repo, '.git/index'));
    try {
      await materializeCommit(repo, destination, commit);
      expect(await readFile(join(destination, 'partial.txt'))).toEqual(
        git(repo, 'show', `${commit}:partial.txt`),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
);
gitEnvironment.GIT_CONFIG_NOSYSTEM = '1';
gitEnvironment.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
gitEnvironment.GIT_TERMINAL_PROMPT = '0';

function git(repo, ...args) {
  return execFileSync('git', ['-c', 'core.hooksPath=.git/no-test-hooks', ...args], {
    cwd: repo,
    env: gitEnvironment,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function write(root, path, data) {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, data);
}

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'stara-control-snapshot-'));
  ownedTemps.push(root);
  const repo = join(root, 'repo');
  await mkdir(repo);
  git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Synthetic Control Test');
  git(repo, 'config', 'user.email', 'control-test@example.invalid');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'commit.gpgsign', 'false');
  await write(repo, '.gitattributes', '* -text\n');
  await write(repo, 'partial.txt', 'committed first\ncommitted second\n');
  await write(repo, 'deleted.txt', 'committed deletion candidate\n');
  await write(repo, 'old name.txt', 'committed rename candidate\n');
  git(repo, 'add', '--all');
  git(repo, 'commit', '-m', 'Synthetic fixture baseline');
  return { root, repo, destination: join(root, 'snapshot') };
}

async function filesIn(root, prefix = '') {
  const result = new Map();
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (!prefix && entry.name === '.git') continue;
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [path, bytes] of await filesIn(root, file)) result.set(path, bytes);
    } else {
      result.set(file, await readFile(join(root, file)));
    }
  }
  return result;
}

async function stateOf(repo) {
  return {
    status: git(repo, 'status', '--porcelain=v1', '-z', '--untracked-files=all'),
    staged: git(repo, 'diff', '--cached', '--binary', '--no-ext-diff'),
    unstaged: git(repo, 'diff', '--binary', '--no-ext-diff'),
    stash: git(repo, 'stash', 'list', '--format=%H'),
    files: await filesIn(repo),
    index: await readFile(join(repo, '.git', 'index')),
    head: git(repo, 'rev-parse', 'HEAD'),
  };
}

afterEach(async () => {
  for (const root of ownedTemps.splice(0)) {
    const temporaryRoot = await realpath(tmpdir());
    const target = await realpath(root);
    const child = relative(temporaryRoot, target);
    if (
      !child ||
      isAbsolute(child) ||
      child.startsWith(`..${sep}`) ||
      child === '..' ||
      !target.split(sep).at(-1).startsWith('stara-control-snapshot-')
    ) {
      throw new Error(`Refusing cleanup outside the owned temporary fixture: ${target}`);
    }
    await rm(target, { recursive: true, force: true });
  }
});

describe('materializeIndex: isolated staged bytes without source mutation', () => {
  it.each([
    ['docs/.. /entry.txt'],
    ['docs/trailing./entry.txt'],
    ['docs/trailing /entry.txt'],
    ['.git./config'],
    ['docs/NuL.txt'],
    ['docs/Con.JSON'],
    ['docs/COM1.log'],
    ['docs/lpt9.data'],
    ['docs/Dir/a.txt', 'docs/dir/b.txt'],
    ['docs/Name.txt', 'docs/name.txt'],
  ])('rejects ambiguous Windows index names before any destination write: %j', async (...paths) => {
    const { root, repo, destination } = await fixture();
    await write(root, 'outside-sentinel.txt', 'SYNTHETIC OUTSIDE SENTINEL UNCHANGED');
    git(repo, 'config', 'core.protectNTFS', 'false');
    git(repo, 'config', 'core.ignoreCase', 'false');
    const object = git(repo, 'rev-parse', 'HEAD:partial.txt').toString().trim();
    for (const path of paths)
      git(repo, 'update-index', '--add', '--cacheinfo', `100644,${object},${path}`);
    await expect(
      Promise.resolve().then(() => materializeIndex(repo, destination)),
    ).rejects.toThrow();
    expect(existsSync(destination)).toBe(false);
    expect(await readFile(join(root, 'outside-sentinel.txt'), 'utf8')).toBe(
      'SYNTHETIC OUTSIDE SENTINEL UNCHANGED',
    );
  });
  it.each(['120000', '160000'])(
    'rejects index mode %s for links/submodules before writing',
    async (mode) => {
      const { repo, destination } = await fixture();
      let object = git(repo, 'rev-parse', 'HEAD').toString().trim();
      if (mode === '120000') {
        await write(repo, 'synthetic-link-value.txt', '../outside-target');
        object = git(repo, 'hash-object', '-w', 'synthetic-link-value.txt').toString().trim();
      }
      git(repo, 'update-index', '--add', '--cacheinfo', `${mode},${object},synthetic-link`);
      await expect(
        Promise.resolve().then(() => materializeIndex(repo, destination)),
      ).rejects.toThrow();
    },
  );

  it('materializes executable index blobs without applying unstaged attributes or text conversions', async () => {
    const { repo, destination } = await fixture();
    await write(repo, 'script.sh', '#!/bin/sh\nprintf synthetic\n');
    git(repo, 'add', '--', 'script.sh');
    git(repo, 'update-index', '--chmod=+x', 'script.sh');
    await write(repo, '.gitattributes', '* text eol=crlf\n');
    await materializeIndex(repo, destination);
    expect(await readFile(join(destination, 'script.sh'))).toEqual(
      Buffer.from('#!/bin/sh\nprintf synthetic\n'),
    );
    if (process.platform !== 'win32')
      expect((await lstat(join(destination, 'script.sh'))).mode & 0o111).not.toBe(0);
  });
  it.each([
    'node_modules/forged/index.js',
    '.pnpm-store/forged.json',
    '.artifacts/forged.json',
    'UI/web/dist/index.html',
  ])('rejects tracked cache/dependency/output bytes before install: %s', async (path) => {
    const { repo, destination } = await fixture();
    await write(repo, path, 'synthetic authored dependency or output bytes');
    git(repo, 'add', '--all');
    await expect(
      Promise.resolve().then(() => materializeIndex(repo, destination)),
    ).rejects.toThrow();
  });
  it('materializes a real partial-stage index, including staged additions, rename, deletion, and binary data', async () => {
    const { repo, destination } = await fixture();
    await write(repo, 'partial.txt', 'existing stash contents\n');
    git(repo, 'stash', 'push', '-m', 'Synthetic preexisting stash');

    const stagedText = Buffer.from('staged first\ncommitted second\n');
    const binary = Buffer.from([0, 255, 128, 13, 10, 0, 254]);
    await write(repo, 'partial.txt', stagedText);
    await write(repo, 'nested/added binary.bin', binary);
    await rename(join(repo, 'old name.txt'), join(repo, 'renamed with spaces.txt'));
    await rm(join(repo, 'deleted.txt'));
    git(repo, 'add', '--all');

    await write(repo, 'partial.txt', 'staged first\nUNSTAGED SECRET second\n');
    await write(repo, 'nested/added binary.bin', Buffer.from('UNSTAGED binary replacement'));
    await write(repo, 'renamed with spaces.txt', 'UNSTAGED renamed file\n');
    await write(repo, 'deleted.txt', 'UNTRACKED resurrection after staged deletion\n');
    await write(repo, '.env.local', 'SYNTHETIC_UNTRACKED_SECRET=not-real\n');
    await write(repo, 'nested/untracked.txt', 'UNTRACKED nested source\n');
    const before = await stateOf(repo);

    await materializeIndex(repo, destination);

    const snapshot = await filesIn(destination);
    expect([...snapshot.keys()].sort()).toEqual([
      '.gitattributes',
      'nested/added binary.bin',
      'partial.txt',
      'renamed with spaces.txt',
    ]);
    expect(snapshot.get('partial.txt')).toEqual(stagedText);
    expect(snapshot.get('nested/added binary.bin')).toEqual(binary);
    expect(snapshot.get('renamed with spaces.txt')).toEqual(
      Buffer.from('committed rename candidate\n'),
    );
    expect(existsSync(join(destination, '.git'))).toBe(false);
    expect(await stateOf(repo)).toEqual(before);
  });

  it('accepts an already-created empty directory inside an owned temporary fixture', async () => {
    const { repo, destination } = await fixture();
    await mkdir(destination);
    await materializeIndex(repo, destination);
    expect(await readFile(join(destination, 'partial.txt'), 'utf8')).toBe(
      'committed first\ncommitted second\n',
    );
  });

  it('uses the index when a tracked file has an unstaged deletion', async () => {
    const { repo, destination } = await fixture();
    await rm(join(repo, 'partial.txt'));
    const before = await stateOf(repo);
    await materializeIndex(repo, destination);
    expect(await readFile(join(destination, 'partial.txt'), 'utf8')).toBe(
      'committed first\ncommitted second\n',
    );
    expect(await stateOf(repo)).toEqual(before);
  });

  it('does not reuse stale files from a preexisting destination', async () => {
    const { repo, destination } = await fixture();
    await write(destination, 'sentinel.txt', 'owned by someone else\n');
    const before = await stateOf(repo);
    await expect(
      Promise.resolve().then(() => materializeIndex(repo, destination)),
    ).rejects.toThrow();
    expect(await filesIn(destination)).toEqual(
      new Map([['sentinel.txt', Buffer.from('owned by someone else\n')]]),
    );
    expect(await stateOf(repo)).toEqual(before);
  });

  it.each(['.', '.git', 'new-snapshot'])(
    'rejects destination within the source repository: %s',
    async (path) => {
      const { repo } = await fixture();
      const before = await stateOf(repo);
      await expect(
        Promise.resolve().then(() => materializeIndex(repo, resolve(repo, path))),
      ).rejects.toThrow();
      expect(await stateOf(repo)).toEqual(before);
      if (path === 'new-snapshot') expect(existsSync(join(repo, path))).toBe(false);
    },
  );

  it('rejects a destination directory link without writing into its target', async () => {
    const { root, repo, destination } = await fixture();
    const other = join(root, 'other-owner');
    await mkdir(other);
    await symlink(other, destination, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      Promise.resolve().then(() => materializeIndex(repo, destination)),
    ).rejects.toThrow();
    expect(await readdir(other)).toEqual([]);
    expect((await lstat(destination)).isSymbolicLink()).toBe(true);
  });

  it('rejects a destination reached through a linked parent', async () => {
    const { root, repo } = await fixture();
    const other = join(root, 'other-owner');
    const alias = join(root, 'linked-parent');
    await mkdir(other);
    await symlink(other, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      Promise.resolve().then(() => materializeIndex(repo, join(alias, 'snapshot'))),
    ).rejects.toThrow();
    expect(await readdir(other)).toEqual([]);
  });

  it('fails explicitly for a non-Git source instead of returning an empty successful snapshot', async () => {
    const { root, destination } = await fixture();
    const source = join(root, 'not-a-repo');
    await mkdir(source);
    await expect(
      Promise.resolve().then(() => materializeIndex(source, destination)),
    ).rejects.toThrow();
  });

  it('fails explicitly for an unresolved index conflict and preserves index and working files', async () => {
    const { repo, destination } = await fixture();
    git(repo, 'checkout', '-b', 'other');
    await write(repo, 'partial.txt', 'other side\n');
    git(repo, 'add', '--', 'partial.txt');
    git(repo, 'commit', '-m', 'Synthetic other side');
    git(repo, 'checkout', 'main');
    await write(repo, 'partial.txt', 'main side\n');
    git(repo, 'add', '--', 'partial.txt');
    git(repo, 'commit', '-m', 'Synthetic main side');
    expect(() => git(repo, 'merge', '--no-edit', 'other')).toThrow();
    expect(git(repo, 'ls-files', '--unmerged').length).toBeGreaterThan(0);
    const before = await stateOf(repo);
    await expect(
      Promise.resolve().then(() => materializeIndex(repo, destination)),
    ).rejects.toThrow();
    expect(await stateOf(repo)).toEqual(before);
  });
});
