import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const toolingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(toolingRoot, '..');
const ownedTemps = [];
beforeAll(async () => {
  await readFile(join(toolingRoot, 'scripts/workspace.mjs'));
});

afterEach(async () => {
  for (const root of ownedTemps.splice(0)) {
    const temporaryRoot = await realpath(tmpdir());
    const target = await realpath(root);
    const child = relative(temporaryRoot, target);
    if (
      !child ||
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      !target.split(sep).at(-1).startsWith('stara-control-cli-')
    ) {
      throw new Error(`Refusing cleanup outside the owned temporary CLI fixture: ${target}`);
    }
    await rm(target, { recursive: true, force: true });
  }
});

describe('workspace CLI: unknown gate stage fails closed', () => {
  it.each(['unknown-stage', 'commti', 'pr-unknown'])(
    'rejects %s explicitly within the process bound',
    async (stage) => {
      const root = await mkdtemp(join(await realpath(tmpdir()), 'stara-control-cli-'));
      ownedTemps.push(root);
      await mkdir(join(root, 'tooling'));
      await cp(join(toolingRoot, 'scripts'), join(root, 'tooling/scripts'), { recursive: true });
      await cp(join(toolingRoot, 'lib'), join(root, 'tooling/lib'), { recursive: true });
      await symlink(
        join(repositoryRoot, 'node_modules'),
        join(root, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      // Removing executable search paths keeps a bad default dispatch in the fixture.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
      );
      env.PATH = '';
      const result = spawnSync(
        process.execPath,
        [join(root, 'tooling/scripts/workspace.mjs'), stage],
        {
          cwd: root,
          env,
          encoding: 'utf8',
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).not.toBeNull();
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(
        /unknown.{0,40}(stage|command)|unsupported.{0,40}(stage|command)|usage:/i,
      );
    },
  );
});
