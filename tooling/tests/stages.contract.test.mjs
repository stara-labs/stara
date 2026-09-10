import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  captureEvidence,
  cleanupFixtures,
  git,
  packageRecords,
  passed,
  workspace,
  write,
} from './fixtures.mjs';

let control;
let processControl;
let cli;
beforeAll(async () => {
  const workspaceUrl = new URL('../lib/workspace.mjs', import.meta.url);
  const processUrl = new URL('../lib/process.mjs', import.meta.url);
  const cliUrl = new URL('../scripts/workspace.mjs', import.meta.url);
  control = await import(/* @vite-ignore */ workspaceUrl.href);
  processControl = await import(/* @vite-ignore */ processUrl.href);
  cli = await import(/* @vite-ignore */ cliUrl.href);
});
afterEach(cleanupFixtures);

function stateFor(root, overrides = {}) {
  const publish = captureEvidence(root);
  const state = {
    root,
    env: {},
    pnpmPath: join(root, 'pnpm.mjs'),
    output: vi.fn(),
    error: vi.fn(),
    run: vi.fn(async (command, args, options) => {
      if (command === 'git') return passed(git(options.cwd, ...args).toString());
      if (args.includes('list'))
        return passed(
          JSON.stringify(
            packageRecords.map(({ name, relativePath }) => ({
              name,
              path: join(root, relativePath),
            })),
          ),
        );
      if (args.includes('--version'))
        return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
      await publish(args);
      return passed();
    }),
    ...overrides,
  };
  return { state, runtime: processControl.createRuntime(state) };
}

describe('gate stages: independent workload contracts', () => {
  it.each(['missing', 'empty', 'unknown-status'])(
    'rejects a successful staged process with %s required evidence',
    async (mode) => {
      const root = await workspace({ gitRepository: true });
      const payload =
        mode === 'empty'
          ? { status: 'pass', results: [] }
          : {
              status: 'pass',
              results: [{ name: 'synthetic-unit', required: true, status: 'unknown' }],
            };
      const code = `import {mkdir,writeFile} from 'node:fs/promises';\nimport {join} from 'node:path';\nexport async function runMaterializedGate(input,options={}) { const directory=join(process.cwd(),'.artifacts/gates',options.runId ?? input.runId ?? 'synthetic-evidence'); await mkdir(directory,{recursive:true}); ${mode === 'missing' ? '' : `await writeFile(join(directory,'selection.json'),JSON.stringify({stage:'commit',mode:'all',targets:['@stara/tooling'],reason:'fixture'})); await writeFile(join(directory,'results.json'),${JSON.stringify(JSON.stringify(payload))});`} return true; }\n`;
      await write(root, 'tooling/lib/workspace.mjs', code);
      git(root, 'add', '--all');
      const run = vi.fn(async (command, args, options) => {
        if (command === 'git') return passed(git(options.cwd, ...args).toString());
        if (args.includes('--version'))
          return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
        if (args[0] === join(root, 'pnpm.mjs')) return passed();
        return processControl.runProcess(command, args, options);
      });
      const { state } = stateFor(root, { run, runId: 'synthetic-evidence' });
      await expect(control.runWorkspace(['commit'], state)).rejects.toThrow();
    },
  );
  it.each(['pass', 'fail'])(
    'preserves staged %s results and selection after temporary snapshot cleanup',
    async (status) => {
      const root = await workspace({ gitRepository: true });
      const code = `import {mkdir,writeFile} from 'node:fs/promises';\nimport {join} from 'node:path';\nexport async function runMaterializedGate(input, options={}) { const runId=options.runId ?? input.runId; if(runId !== 'synthetic-staged-run') throw new Error('MISSING_STABLE_RUN_ID'); const directory=join(process.cwd(),'.artifacts/gates',runId); await mkdir(directory,{recursive:true}); await writeFile(join(directory,'selection.json'),JSON.stringify({stage:'commit',mode:'all',targets:['@stara/tooling'],reason:'staged synthetic selection'})); await writeFile(join(directory,'results.json'),JSON.stringify({status:${JSON.stringify(status)},proof:'staged',results:[{name:'synthetic-unit',required:true,status:${JSON.stringify(status)},durationMs:1}]})); ${status === 'fail' ? "throw new Error('SYNTHETIC_STAGED_FAILURE');" : 'return true;'} }\n`;
      await write(root, 'tooling/lib/workspace.mjs', code);
      git(root, 'add', '--all');
      const run = vi.fn(async (command, args, options) => {
        if (command === 'git') return passed(git(options.cwd, ...args).toString());
        if (args.includes('--version'))
          return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
        if (args[0] === join(root, 'pnpm.mjs')) return passed();
        return processControl.runProcess(command, args, options);
      });
      const { state } = stateFor(root, {
        run,
        runId: 'synthetic-staged-run',
        actor: 'synthetic-test-author',
      });
      if (status === 'fail')
        await expect(control.runWorkspace(['commit'], state)).rejects.toThrow();
      else await expect(control.runWorkspace(['commit'], state)).resolves.toBe(true);
      const result = JSON.parse(
        await readFile(join(root, '.artifacts/gates/synthetic-staged-run/results.json'), 'utf8'),
      );
      expect(result).toMatchObject({ status, proof: 'staged' });
      const selection = JSON.parse(
        await readFile(join(root, '.artifacts/gates/synthetic-staged-run/selection.json'), 'utf8'),
      );
      expect(selection.reason).toBe('staged synthetic selection');
    },
  );
  it('cannot resolve a binary available only in the dirty source node_modules/.bin PATH', async () => {
    const root = await workspace({ gitRepository: true });
    const name =
      process.platform === 'win32' ? 'stara-source-only-node.exe' : 'stara-source-only-node';
    // The fixture uses an ignored owned bin directory, never the linked dependency install.
    const sourceBin = join(root, 'source-only-node_modules', '.bin');
    await mkdir(sourceBin, { recursive: true });
    await copyFile(process.execPath, join(sourceBin, name));
    await chmod(join(sourceBin, name), 0o755);
    await write(
      root,
      '.gitignore',
      'node_modules\nsource-only-node_modules/\n.artifacts/\n**/dist/\n',
    );
    const program = `import {spawnSync} from 'node:child_process';\nimport {mkdir,writeFile} from 'node:fs/promises';\nimport {join} from 'node:path';\nexport async function runMaterializedGate(input,options={}) { const child = spawnSync(${JSON.stringify(name)}, ['--version'], {encoding:'utf8',timeout:2000}); if (!child.error) throw new Error('DIRTY_SOURCE_BINARY_RESOLVED'); if (child.error.code !== 'ENOENT') throw child.error; const directory=join(process.cwd(),'.artifacts/gates',options.runId ?? input.runId); await mkdir(directory,{recursive:true}); await writeFile(join(directory,'selection.json'),JSON.stringify({stage:'commit',mode:'all',targets:['@stara/tooling'],reason:'source PATH isolation'})); await writeFile(join(directory,'results.json'),JSON.stringify({status:'pass',results:[{name:'source-path-isolation',required:true,status:'pass',durationMs:1}]})); return true; }\n`;
    await write(root, 'tooling/lib/workspace.mjs', program);
    git(root, 'add', '--all');
    const inheritedPath = Object.entries(process.env)
      .filter(([key]) => key.toUpperCase() === 'PATH')
      .map(([, value]) => value)
      .join(delimiter);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
    );
    env.PATH = `${sourceBin}${delimiter}${inheritedPath}`;
    const run = vi.fn(async (command, args, options) => {
      if (command === 'git') return passed(git(options.cwd, ...args).toString());
      if (args.includes('--version'))
        return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
      if (args[0] === join(root, 'pnpm.mjs')) return passed();
      return processControl.runProcess(command, args, options);
    });
    const { state } = stateFor(root, { env, run, runId: 'synthetic-source-path' });
    await expect(control.runWorkspace(['commit'], state)).resolves.toBe(true);
    const child = run.mock.calls.find(([, args]) => args.includes('--input-type=module'));
    expect(child).toBeDefined();
    expect(
      Object.entries(child[2].env)
        .filter(([key]) => key.toUpperCase() === 'PATH')
        .map(([, value]) => value)
        .join(delimiter),
    ).not.toContain(sourceBin);
  });
  it('commit runs direct affected unit checks without dependents, build, integration, e2e, or coverage', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime, state } = stateFor(root);
    await control.runGates(
      runtime,
      { mode: 'affected', targets: ['@stara/ui'], reason: 'fixture' },
      'commit',
    );
    const args = state.run.mock.calls.flatMap(([, args]) => args);
    expect(args).toContain('test:unit');
    expect(args).toContain('@stara/ui');
    expect(args).not.toContain('...@stara/ui');
    for (const forbidden of [
      'test:integration',
      'test:e2e',
      'test:a11y',
      'test:coverage',
      'build',
      'security:dependencies',
    ]) {
      expect(args, forbidden).not.toContain(forbidden);
    }
  });

  it('push expands dependents and builds without mandatory browser or coverage work', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime, state } = stateFor(root);
    await control.runGates(
      runtime,
      { mode: 'affected', targets: ['@stara/ui'], reason: 'fixture' },
      'push',
    );
    const args = state.run.mock.calls.flatMap(([, args]) => args);
    expect(args).toContain('...@stara/ui');
    expect(args).toContain('test:unit');
    expect(args).toContain('build');
    for (const forbidden of ['test:e2e', 'test:a11y', 'test:coverage', 'security:dependencies']) {
      expect(args, forbidden).not.toContain(forbidden);
    }
  });

  it('rejects unknown stages before invoking a gate process', async () => {
    const root = await workspace();
    const { runtime, state } = stateFor(root);
    await expect(
      control.runGates(runtime, { mode: 'all', targets: [], reason: 'fixture' }, 'unknown'),
    ).rejects.toThrow();
    expect(state.run).not.toHaveBeenCalled();
  });

  it('cannot replace a staged rejecting gate with an unstaged passing implementation', async () => {
    const root = await workspace({ gitRepository: true });
    await write(
      root,
      'tooling/lib/workspace.mjs',
      'export async function runMaterializedGate() { throw new Error("STAGED_REJECTION_SENTINEL"); }\n',
    );
    git(root, 'add', '--all');
    await write(
      root,
      'tooling/lib/workspace.mjs',
      'export async function runMaterializedGate() { return [{name:"forged",required:true,status:"pass"}]; }\n',
    );
    const originalStaged = git(root, 'show', ':tooling/lib/workspace.mjs');
    const originalWorking = await readFile(join(root, 'tooling/lib/workspace.mjs'));
    const run = vi.fn(async (command, args, options) => {
      if (command === 'git') return passed(git(options.cwd, ...args).toString());
      if (args.includes('--version'))
        return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
      if (args[0] === join(root, 'pnpm.mjs')) {
        expect(options.cwd).not.toBe(root);
        expect(args).toContain('--frozen-lockfile');
        return passed();
      }
      return processControl.runProcess(command, args, options);
    });
    const { state } = stateFor(root, { run });
    const failure = await control.runWorkspace(['commit'], state).then(
      () => null,
      (error) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(`${failure.message}\n${failure.cause?.stderr ?? ''}`).toContain(
      'STAGED_REJECTION_SENTINEL',
    );
    expect(git(root, 'show', ':tooling/lib/workspace.mjs')).toEqual(originalStaged);
    expect(await readFile(join(root, 'tooling/lib/workspace.mjs'))).toEqual(originalWorking);
    expect(run.mock.calls.some(([, args]) => args.includes('--frozen-lockfile'))).toBe(true);
    expect(run.mock.calls.flatMap(([, args]) => args)).not.toContain('stash');
  });

  it('surfaces snapshot materialization failure without running staged gates or installation', async () => {
    const root = await workspace({ gitRepository: true });
    const materialize = vi.fn(async () => {
      throw new Error('synthetic snapshot failure');
    });
    const { state } = stateFor(root, { materialize });
    await expect(control.runWorkspace(['commit'], state)).rejects.toThrow(/snapshot failure/);
    expect(materialize).toHaveBeenCalledOnce();
    expect(state.run.mock.calls.some(([, args]) => args.includes('install'))).toBe(false);
  });
});

describe('CLI main: imports are inert, commands return explicit status', () => {
  it.each(['bootstrap', 'hooks-install', 'start', 'dev', 'down', 'logs'])(
    'dispatches %s through injected process boundaries',
    async (mode) => {
      const root = await workspace({ gitRepository: true });
      const base = stateFor(root);
      const { state } = stateFor(root, {
        fetch: async () => ({ status: 200, json: async () => ({ status: 'ok' }) }),
        sleep: async () => {},
        run: async (command, args, options) => {
          if (command === 'git' && args.includes('core.hooksPath'))
            return passed('synthetic-existing-hooks');
          if (command === 'docker' && args.includes('config'))
            return passed(
              JSON.stringify({
                services: {
                  web: { ports: [{ host_ip: '127.0.0.1', target: 5173, published: 5173 }] },
                  api: { ports: [{ host_ip: '127.0.0.1', target: 3000, published: 3000 }] },
                },
              }),
            );
          return base.state.run(command, args, options);
        },
      });
      expect(await cli.main([mode], state)).toBe(0);
      expect(state.error).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown options before invoking any process', async () => {
    const root = await workspace();
    const { state } = stateFor(root);
    expect(await cli.main(['layout', '--unknown-option'], state)).not.toBe(0);
    expect(state.run).not.toHaveBeenCalled();
  });
  it('exports a main function without dispatching at import time', () => {
    expect(typeof cli.main).toBe('function');
  });

  it.each(['unknown-stage', 'commti'])('reports %s as a nonzero result', async (stage) => {
    const root = await workspace();
    const { state } = stateFor(root);
    expect(await cli.main([stage], state)).not.toBe(0);
    expect(state.error).toHaveBeenCalled();
    expect(state.error.mock.calls.flat().join(' ')).toMatch(/unknown|usage|unsupported/i);
  });

  it.each(['layout', 'artifact', 'tokens-check'])(
    'runs the %s command through the imported CLI',
    async (mode) => {
      const root = await workspace({ gitRepository: true });
      const { state } = stateFor(root);
      expect(await cli.main([mode], state)).toBe(0);
      expect(state.error).not.toHaveBeenCalled();
    },
  );

  it('reports token update missing --source without accessing any implicit checkout', async () => {
    const root = await workspace();
    const { state } = stateFor(root);
    expect(await cli.main(['tokens-update'], state)).not.toBe(0);
    expect(state.error).toHaveBeenCalled();
    expect(state.run).not.toHaveBeenCalled();
  });

  it('returns nonzero on malformed public provenance instead of suppressing a command error', async () => {
    const root = await workspace();
    await write(root, 'UI/shared/src/styles/tokens.provenance.json', '{ invalid json');
    const { state } = stateFor(root);
    expect(await cli.main(['tokens-check'], state)).not.toBe(0);
    expect(state.error).toHaveBeenCalled();
  });
});
