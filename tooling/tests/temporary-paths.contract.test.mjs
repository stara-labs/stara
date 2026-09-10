import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { expect, it } from 'vitest';

it('canonicalizes aliased temporary fixtures without changing snapshot or Compose contracts', async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, 'stara-control-alias-'));
  const storage = join(root, 'temporary storage');
  const alias = join(root, 'temporary alias');
  let linked = false;
  const cleanup = async () => {
    const actual = await realpath(root);
    const child = relative(parent, actual);
    if (
      !child ||
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      actual !== root
    ) {
      throw new Error('Refusing cleanup outside owned alias fixture');
    }
    if (linked) await unlink(alias);
    await rm(actual, { recursive: true, force: true });
  };
  try {
    await mkdir(storage);
    await symlink(storage, alias, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    const script = `
      import assert from 'node:assert/strict';
      import { readFile, realpath, readdir } from 'node:fs/promises';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { cleanupFixtures, emptyWorkspace, git, workspace, write }
        from ${JSON.stringify(new URL('./fixtures.mjs', import.meta.url).href)};
      import { composeSettings }
        from ${JSON.stringify(new URL('../lib/environment.mjs', import.meta.url).href)};
      import { materializeCommit, materializeIndex }
        from ${JSON.stringify(new URL('../lib/snapshot.mjs', import.meta.url).href)};

      assert.notEqual(tmpdir(), await realpath(tmpdir()), 'alias must reach the child unchanged');
      try {
        const repo = await workspace({ gitRepository: true });
        const destinationRoot = await emptyWorkspace();
        assert.equal(repo, await realpath(repo), 'workspace root must be canonical');
        assert.equal(destinationRoot, await realpath(destinationRoot), 'destination root must be canonical');
        assert.deepEqual(composeSettings(repo), composeSettings(await realpath(repo)));
        await write(repo, 'probe.txt', 'committed');
        git(repo, 'add', 'probe.txt');
        git(repo, 'commit', '-m', 'Synthetic alias baseline');
        const commit = git(repo, 'rev-parse', 'HEAD').toString().trim();
        await write(repo, 'probe.txt', 'staged');
        git(repo, 'add', 'probe.txt');
        await write(repo, 'probe.txt', 'unstaged');
        const index = await readFile(join(repo, '.git/index'));
        const status = git(repo, 'status', '--porcelain=v1');
        const committed = join(destinationRoot, 'commit');
        const staged = join(destinationRoot, 'index');
        await materializeCommit(repo, committed, commit);
        await materializeIndex(repo, staged);
        assert.equal(await readFile(join(committed, 'probe.txt'), 'utf8'), 'committed');
        assert.equal(await readFile(join(staged, 'probe.txt'), 'utf8'), 'staged');
        assert.equal(await readFile(join(repo, 'probe.txt'), 'utf8'), 'unstaged');
        assert.deepEqual(await readFile(join(repo, '.git/index')), index);
        assert.deepEqual(git(repo, 'status', '--porcelain=v1'), status);
      } finally {
        await cleanupFixtures();
      }
      assert.deepEqual(await readdir(tmpdir()), [], 'all child fixtures must be cleaned');
    `;
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !['TEMP', 'TMP', 'TMPDIR'].includes(key.toUpperCase()),
      ),
    );
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...environment, TEMP: alias, TMP: alias, TMPDIR: alias },
      encoding: 'utf8',
      timeout: 25_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readdir(storage)).toEqual([]);
  } finally {
    await cleanup();
  }
});
