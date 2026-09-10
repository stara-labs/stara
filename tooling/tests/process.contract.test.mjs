import { delimiter, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupFixtures, passed, workspace } from './fixtures.mjs';

let processControl;
beforeAll(async () => {
  const moduleUrl = new URL('../lib/process.mjs', import.meta.url);
  processControl = await import(/* @vite-ignore */ moduleUrl.href);
});
afterEach(cleanupFixtures);

describe('runProcess: bounded, explicit, shell-free child results', () => {
  it('captures successful stdout and stderr with explicit zero status', async () => {
    const root = await workspace();
    const result = await processControl.runProcess(
      process.execPath,
      ['-e', 'process.stdout.write("output");process.stderr.write("diagnostic")'],
      { cwd: root, env: process.env, timeout: 5_000 },
    );
    expect(result).toMatchObject({ code: 0, stdout: 'output', stderr: 'diagnostic' });
  });

  it('passes metacharacters as literal arguments without a shell', async () => {
    const root = await workspace();
    const literal = 'space ; & | $(echo unexpected) "quotes"';
    const result = await processControl.runProcess(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', literal],
      { cwd: root, env: process.env, timeout: 5_000 },
    );
    expect(result.stdout).toBe(literal);
  });

  it('honors the explicit working directory and child environment without mutating the caller', async () => {
    const root = await workspace();
    const env = { ...process.env, STARA_SYNTHETIC_VALUE: 'fixture only' };
    const before = { ...env };
    const result = await processControl.runProcess(
      process.execPath,
      [
        '-e',
        'process.stdout.write(JSON.stringify([process.cwd(),process.env.STARA_SYNTHETIC_VALUE]))',
      ],
      { cwd: root, env, timeout: 5_000 },
    );
    expect(JSON.parse(result.stdout)).toEqual([root, 'fixture only']);
    expect(env).toEqual(before);
  });

  it('rejects a nonzero exit with an explicit diagnostic', async () => {
    const root = await workspace();
    await expect(
      processControl.runProcess(
        process.execPath,
        ['-e', 'process.stderr.write("synthetic failure");process.exit(7)'],
        { cwd: root, env: process.env, timeout: 5_000 },
      ),
    ).rejects.toThrow(/7|synthetic failure/);
  });

  it('rejects a nonexistent executable', async () => {
    const root = await workspace();
    await expect(
      processControl.runProcess(join(root, 'no-such-command'), [], {
        cwd: root,
        env: process.env,
        timeout: 2_000,
      }),
    ).rejects.toThrow();
  });

  it('times out a real stuck child and reports the bound', async () => {
    const root = await workspace();
    const started = performance.now();
    await expect(
      processControl.runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: root,
        env: process.env,
        timeout: 100,
      }),
    ).rejects.toThrow(/timed? ?out|timeout|100/i);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it.each([0, -1, NaN, Infinity, '100'])(
    'rejects invalid timeout %j before execution',
    async (timeout) => {
      const root = await workspace();
      await expect(
        processControl.runProcess(process.execPath, ['-e', 'process.exit(0)'], {
          cwd: root,
          env: process.env,
          timeout,
        }),
      ).rejects.toThrow();
    },
  );
});

describe('createRuntime: exact runtime and pnpm entry point', () => {
  it('keeps pnpm environment case sensitivity native to the host platform', async () => {
    const root = await workspace();
    const run = vi.fn(async () => passed());
    const runtime = processControl.createRuntime({
      root,
      run,
      env: { NPM_EXECPATH: join(root, 'pnpm.mjs') },
    });
    if (process.platform === 'win32')
      await expect(runtime.pnpm(['--version'])).resolves.toMatchObject({ code: 0 });
    else {
      await expect(Promise.resolve().then(() => runtime.pnpm(['--version']))).rejects.toThrow(
        /pnpm/i,
      );
      expect(run).not.toHaveBeenCalled();
    }
  });

  it.each([false, true])(
    'retains options then declared CLI then lifecycle precedence (explicit=%s)',
    async (explicit) => {
      const root = await workspace();
      const run = vi.fn(async () => passed());
      const declared = join(root, 'declared/pnpm.mjs');
      const selected = explicit ? join(root, 'explicit/pnpm.mjs') : declared;
      const runtime = processControl.createRuntime({
        root,
        run,
        ...(explicit ? { pnpmPath: selected } : {}),
        env: { STARA_PNPM_CLI: declared, npm_execpath: join(root, 'lifecycle/pnpm.mjs') },
      });
      await runtime.pnpm(['--version']);
      expect(run.mock.calls[0][1][0]).toBe(selected);
    },
  );

  it.runIf(process.platform === 'win32').each(['NPM_EXECPATH', 'Npm_ExecPath', 'stara_pnpm_cli'])(
    'resolves Windows lifecycle key %s without changing the caller environment',
    async (key) => {
      const root = await workspace();
      const pnpmPath = join(root, 'pnpm.mjs');
      const env = { [key]: pnpmPath };
      const run = vi.fn(async () => passed());
      const runtime = processControl.createRuntime({ root, env, run });
      await runtime.pnpm(['run', 'format:check']);
      expect(run.mock.calls[0][1][0]).toBe(pnpmPath);
      expect(env).toEqual({ [key]: pnpmPath });
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects an invalid case-variant explicit pnpm override instead of falling back',
    async () => {
      const root = await workspace();
      const run = vi.fn(async () => passed());
      const runtime = processControl.createRuntime({
        root,
        run,
        env: { stara_pnpm_cli: '', NPM_EXECPATH: join(root, 'pnpm.mjs') },
      });
      await expect(Promise.resolve().then(() => runtime.pnpm(['--version']))).rejects.toThrow(
        /pnpm/i,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === 'win32')(
    'rejects conflicting Windows pnpm discovery aliases before any child runs',
    async () => {
      const root = await workspace();
      const run = vi.fn(async () => passed());
      await expect(
        Promise.resolve().then(() =>
          processControl
            .createRuntime({
              root,
              run,
              env: {
                NPM_EXECPATH: join(root, 'other/pnpm.mjs'),
                npm_execpath: join(root, 'pnpm.mjs'),
              },
            })
            .pnpm(['--version']),
        ),
      ).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === 'win32')(
    'accepts identical Windows pnpm discovery aliases without mutating the caller',
    async () => {
      const root = await workspace();
      const pnpmPath = join(root, 'pnpm.mjs');
      const env = { NPM_EXECPATH: pnpmPath, npm_execpath: pnpmPath };
      const run = vi.fn(async () => passed());
      await processControl.createRuntime({ root, run, env }).pnpm(['--version']);
      expect(run.mock.calls[0][1][0]).toBe(pnpmPath);
      expect(env).toEqual({ NPM_EXECPATH: pnpmPath, npm_execpath: pnpmPath });
    },
  );

  it('restores fail-closed dependency verification in nested isolated pnpm scripts without mutating caller env', async () => {
    const root = await workspace();
    const env = { STARA_ISOLATED_ROOT: root, pnpm_config_verify_deps_before_run: 'false' };
    const run = vi.fn(async () => passed());
    const runtime = processControl.createRuntime({
      root,
      env,
      run,
      pnpmPath: join(root, 'pnpm.mjs'),
    });
    await runtime.pnpm(['run', 'format:check']);
    expect(run.mock.calls[0][2].env.pnpm_config_verify_deps_before_run).toBe('error');
    expect(env.pnpm_config_verify_deps_before_run).toBe('false');
  });

  it('invokes pnpm through the selected Node executable, never a platform shim', async () => {
    const root = await workspace();
    const run = vi.fn(async () => passed('synthetic pnpm output'));
    const pnpmPath = join(root, 'runtime', 'pnpm.mjs');
    const runtime = processControl.createRuntime({
      root,
      run,
      node: process.execPath,
      pnpmPath,
      env: { STARA_SENTINEL: 'keep' },
    });
    const result = await runtime.pnpm(['--version'], { timeout: 500 });
    expect(result.stdout).toBe('synthetic pnpm output');
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [pnpmPath, '--version'],
      expect.objectContaining({
        cwd: root,
        env: expect.objectContaining({ STARA_SENTINEL: 'keep' }),
        timeout: 500,
      }),
    );
  });

  it.each(['mjs', 'cjs'])(
    'resolves explicitly declared pnpm.%s from the environment',
    async (extension) => {
      const root = await workspace();
      const run = vi.fn(async () => passed());
      const pnpmPath = join(root, `pnpm.${extension}`);
      const runtime = processControl.createRuntime({
        root,
        run,
        env: { STARA_PNPM_CLI: pnpmPath },
        node: process.execPath,
      });
      await runtime.pnpm(['install']);
      expect(run.mock.calls[0][0]).toBe(process.execPath);
      expect(run.mock.calls[0][1]).toEqual([pnpmPath, 'install']);
      expect(run.mock.calls[0][2].timeout).toBeGreaterThan(0);
      expect(Number.isFinite(run.mock.calls[0][2].timeout)).toBe(true);
    },
  );

  it('uses npm_execpath only when it identifies the pnpm script', async () => {
    const root = await workspace();
    const run = vi.fn(async () => passed());
    const pnpmPath = join(root, 'pnpm.mjs');
    const runtime = processControl.createRuntime({ root, run, env: { npm_execpath: pnpmPath } });
    await runtime.pnpm(['--version']);
    expect(run.mock.calls[0][1][0]).toBe(pnpmPath);
  });

  it('does not reuse an unrelated npm executable as pnpm', async () => {
    const root = await workspace();
    const run = vi.fn(async () => passed());
    const runtime = processControl.createRuntime({
      root,
      run,
      env: { npm_execpath: join(root, 'npm-cli.js') },
    });
    await expect(Promise.resolve().then(() => runtime.pnpm(['install']))).rejects.toThrow(/pnpm/i);
    expect(run).not.toHaveBeenCalled();
  });

  it('uses the runtime root for Git and preserves explicit timeout/cwd overrides', async () => {
    const root = await workspace();
    const run = vi.fn(async () => passed('head'));
    const runtime = processControl.createRuntime({ root, run, env: {} });
    expect((await runtime.git(['rev-parse', 'HEAD'])).stdout).toBe('head');
    expect(run.mock.calls[0]).toEqual([
      'git',
      ['rev-parse', 'HEAD'],
      expect.objectContaining({ cwd: root, timeout: expect.any(Number) }),
    ]);
    await runtime.git(['status'], { cwd: join(root, 'UI/web'), timeout: 250 });
    expect(run.mock.calls[1][2]).toMatchObject({ cwd: join(root, 'UI/web'), timeout: 250 });
  });

  it('keeps provided environment, output, fetch, and sleep injections available', async () => {
    const root = await workspace();
    const env = { STARA_SENTINEL: 'before' };
    const output = vi.fn();
    const fetch = vi.fn();
    const sleep = vi.fn();
    const runtime = processControl.createRuntime({ root, env, output, fetch, sleep });
    expect(runtime).toMatchObject({ root, output, fetch, sleep });
    expect(runtime.env).toEqual(env);
    expect(env).toEqual({ STARA_SENTINEL: 'before' });
  });

  it.runIf(process.platform === 'win32')(
    'normalizes duplicate Windows PATH casing and preserves both values plus exact Node',
    async () => {
      const root = await workspace();
      const run = vi.fn(async () => passed());
      const env = {
        PATH: 'C:\\synthetic-upper',
        Path: 'C:\\synthetic-mixed',
        STARA_SENTINEL: 'keep',
      };
      const runtime = processControl.createRuntime({ root, run, env });
      await runtime.run('synthetic-command', []);
      const child = run.mock.calls[0][2].env;
      const pathKeys = Object.keys(child).filter((key) => key.toUpperCase() === 'PATH');
      expect(pathKeys).toHaveLength(1);
      const entries = child[pathKeys[0]].split(delimiter);
      expect(entries[0]).toBe(dirname(process.execPath));
      expect(entries).toEqual(
        expect.arrayContaining(['C:\\synthetic-upper', 'C:\\synthetic-mixed']),
      );
      expect(child.STARA_SENTINEL).toBe('keep');
      expect(env).toEqual({
        PATH: 'C:\\synthetic-upper',
        Path: 'C:\\synthetic-mixed',
        STARA_SENTINEL: 'keep',
      });
    },
  );
});
