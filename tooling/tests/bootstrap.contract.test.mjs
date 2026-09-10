import { createRequire } from 'node:module';
import { readFile, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  cleanupFixtures,
  emptyWorkspace,
  git,
  json,
  passed,
  workspace,
  write,
  writeJson,
} from './fixtures.mjs';

let control;
let processControl;
beforeAll(async () => {
  const workspaceUrl = new URL('../lib/workspace.mjs', import.meta.url);
  const processUrl = new URL('../lib/process.mjs', import.meta.url);
  control = await import(/* @vite-ignore */ workspaceUrl.href);
  processControl = await import(/* @vite-ignore */ processUrl.href);
});
afterEach(cleanupFixtures);

function state(root, overrides = {}) {
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    STARA_SENTINEL: 'keep',
  };
  const run = vi.fn(async (command, args, options) => {
    if (command === 'git') return processControl.runProcess(command, args, options);
    if (args.includes('--version')) return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
    return passed();
  });
  return {
    env,
    run,
    runtime: processControl.createRuntime({
      root,
      run,
      env,
      pnpmPath: join(root, 'pnpm.mjs'),
      output: vi.fn(),
      ...overrides,
    }),
  };
}

describe('bootstrap: pinned prerequisites and explicit installation failures', () => {
  it('real pnpm start cannot auto-repair a drifted lock before frozen bootstrap begins', async () => {
    const root = await emptyWorkspace();
    const pnpmPath = process.env.STARA_TEST_PNPM_CLI ?? process.env.npm_execpath;
    expect(pnpmPath, 'Run through pinned pnpm or provide STARA_TEST_PNPM_CLI').toMatch(
      /pnpm\.(?:mjs|cjs|js)$/,
    );
    const manifest = {
      name: 'stara-frozen-bootstrap-probe',
      private: true,
      packageManager: 'pnpm@11.19.0',
      scripts: {
        start: "node -e \"require('fs').writeFileSync('bootstrap-started.txt','started')\"",
      },
    };
    await writeJson(root, 'package.json', manifest);
    await writeJson(root, 'member/package.json', {
      name: '@synthetic/member',
      version: '0.0.0',
      private: true,
    });
    const rootSettings = parseYaml(
      await readFile(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8'),
    );
    await write(
      root,
      'pnpm-workspace.yaml',
      stringifyYaml({
        packages: ['member'],
        ...(rootSettings.frozenLockfile === undefined
          ? {}
          : { frozenLockfile: rootSettings.frozenLockfile }),
      }),
    );
    await write(
      root,
      'pnpm-lock.yaml',
      "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n  member: {}\n",
    );
    await write(root, '.npmrc', await readFile(new URL('../../.npmrc', import.meta.url)));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(?:npm_config_|pnpm_|CI$|NODE_OPTIONS$|NODE_PATH$|INIT_CWD$)/i.test(key),
      ),
    );
    env.pnpm_config_store_dir = join(root, '.artifacts/store');
    env.npm_config_userconfig = await write(root, '.artifacts/user.npmrc', '');
    const runtime = processControl.createRuntime({ root, pnpmPath, env });
    await runtime.pnpm(['install', '--frozen-lockfile', '--ignore-scripts'], { timeout: 20000 });
    const before = await readFile(join(root, 'pnpm-lock.yaml'));
    await writeJson(root, 'package.json', {
      ...manifest,
      devDependencies: { '@synthetic/member': 'workspace:*' },
    });
    const result = await runtime.pnpm(['start'], { timeout: 20000, allowExitCodes: [0, 1] });
    expect.soft(result.code, result.stdout + result.stderr).not.toBe(0);
    expect
      .soft(result.stdout + result.stderr)
      .toMatch(/ERR_PNPM_(?:OUTDATED_LOCKFILE|FROZEN_LOCKFILE|VERIFY_DEPS_BEFORE_RUN)/);
    expect.soft(await readFile(join(root, 'pnpm-lock.yaml'))).toEqual(before);
    await expect(readFile(join(root, 'bootstrap-started.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('checks exact versions and frozen lockfile before install while preserving caller environment', async () => {
    const root = await workspace({ gitRepository: true });
    const { env, runtime, run } = state(root);
    const before = { ...env };
    await expect(control.bootstrap(runtime, { hooks: false })).resolves.toBe(true);
    expect(run.mock.calls[0][1]).toEqual(['--version']);
    expect(run.mock.calls[1][1]).toEqual([join(root, 'pnpm.mjs'), '--version']);
    const install = run.mock.calls.find(([, args]) => args.includes('install'));
    expect(install[1]).toContain('--frozen-lockfile');
    expect(install[2].env.STARA_SENTINEL).toBe('keep');
    expect(install[2].env.SKIP_INSTALL_SIMPLE_GIT_HOOKS).toBe('1');
    expect(install[2].timeout).toBeGreaterThan(0);
    expect(env).toEqual(before);
  });

  it.each(['node', 'pnpm'])('rejects a mismatched pinned %s before install', async (which) => {
    const root = await workspace();
    const run = vi.fn(async (_command, args) =>
      passed(
        args[0] === '--version'
          ? which === 'node'
            ? 'v24.19.0'
            : 'v24.16.0'
          : which === 'pnpm'
            ? '11.0.0'
            : '11.19.0',
      ),
    );
    const { runtime } = state(root, { run });
    await expect(control.bootstrap(runtime, { hooks: false })).rejects.toThrow();
    expect(run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
  });

  it('rejects a missing lockfile without generating a replacement', async () => {
    const root = await workspace();
    await rm(join(root, 'pnpm-lock.yaml'));
    const { runtime, run } = state(root);
    await expect(control.bootstrap(runtime, { hooks: false })).rejects.toThrow();
    expect(run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
  });

  it('does not continue to hooks after install fails', async () => {
    const root = await workspace();
    const base = state(root);
    const { runtime } = state(root, {
      run: async (command, args, options) => {
        if (args.includes('install')) throw new Error('synthetic install failure');
        return base.run(command, args, options);
      },
    });
    await expect(control.bootstrap(runtime)).rejects.toThrow(/install failure/);
    expect(base.run.mock.calls.some(([, args]) => args.includes('simple-git-hooks'))).toBe(false);
  });
});

describe('installHooks: preserve custom hooks and delegate generated hooks', () => {
  it('preserves explicit core.hooksPath without invoking a replacement installer', async () => {
    const root = await workspace({ gitRepository: true });
    git(root, 'config', 'core.hooksPath', '.custom-hooks');
    const { runtime, run } = state(root);
    expect(await control.installHooks(runtime)).toMatchObject({ installed: false });
    expect(run.mock.calls.some(([, args]) => args.includes('simple-git-hooks'))).toBe(false);
  });

  it('preserves a custom tracked local hook byte-for-byte', async () => {
    const root = await workspace({ gitRepository: true });
    const path = '.git/hooks/pre-commit';
    await write(root, path, '#!/bin/sh\necho synthetic-custom-hook\n');
    const { runtime, run } = state(root);
    expect(await control.installHooks(runtime)).toMatchObject({ installed: false });
    expect(await readFile(join(root, path), 'utf8')).toBe(
      '#!/bin/sh\necho synthetic-custom-hook\n',
    );
    expect(run.mock.calls.some(([, args]) => args.includes('simple-git-hooks'))).toBe(false);
  });

  it.each([false, true])(
    'installs declared hooks with preserveUnused when prior managed hook=%s',
    async (managed) => {
      const root = await workspace({ gitRepository: true });
      if (managed) {
        const require = createRequire(join(root, 'package.json'));
        await write(
          root,
          '.git/hooks/pre-commit',
          require('simple-git-hooks').PREPEND_SCRIPT + 'pnpm check:commit',
        );
      }
      await write(root, '.git/hooks/post-merge', '#!/bin/sh\necho keep unrelated hook\n');
      const base = state(root);
      let observed;
      const { runtime } = state(root, {
        run: async (command, args, options) => {
          if (args.includes('simple-git-hooks')) {
            observed = JSON.parse(await readFile(args.at(-1), 'utf8'));
            return passed();
          }
          return base.run(command, args, options);
        },
      });
      expect(await control.installHooks(runtime)).toMatchObject({ installed: true });
      expect(observed).toMatchObject({ preserveUnused: true, 'pre-commit': 'pnpm check:commit' });
      expect(await readFile(join(root, '.git/hooks/post-merge'), 'utf8')).toContain(
        'keep unrelated hook',
      );
    },
  );

  it.each([{}, { 'invalid/path': 'echo no' }, { 'pre-commit': 123 }])(
    'rejects invalid hook configuration %j',
    async (hooks) => {
      const root = await workspace({ gitRepository: true });
      const manifest = await json(root, 'package.json');
      manifest['simple-git-hooks'] = hooks;
      await writeJson(root, 'package.json', manifest);
      const { runtime } = state(root);
      await expect(control.installHooks(runtime)).rejects.toThrow();
    },
  );

  it('rejects a linked hook directory before writing to its target', async () => {
    const root = await workspace({ gitRepository: true });
    const target = await workspace();
    await rename(join(root, '.git/hooks'), join(root, '.git/original-hooks'));
    await symlink(
      target,
      join(root, '.git/hooks'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const { runtime } = state(root);
    await expect(control.installHooks(runtime)).rejects.toThrow();
  });
});
