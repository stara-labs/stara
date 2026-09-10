import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  captureEvidence,
  cleanupFixtures,
  git,
  packageRecords,
  passed,
  workspace,
  write,
  writeJson,
} from './fixtures.mjs';

let control;
let createRuntime;
beforeAll(async () => {
  const workspaceUrl = new URL('../lib/workspace.mjs', import.meta.url);
  const processUrl = new URL('../lib/process.mjs', import.meta.url);
  control = await import(/* @vite-ignore */ workspaceUrl.href);
  ({ createRuntime } = await import(/* @vite-ignore */ processUrl.href));
});
afterEach(cleanupFixtures);

function runtimeFor(root, overrides = {}) {
  const publish = captureEvidence(root);
  const run = vi.fn(async (command, args) => {
    if (command === 'git') return passed(git(root, ...args).toString());
    if (args.includes('--version')) return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
    if (args.includes('list'))
      return passed(
        JSON.stringify(
          packageRecords.map(({ name, relativePath }) => ({
            name,
            path: join(root, relativePath),
          })),
        ),
      );
    await publish(args);
    return passed();
  });
  return {
    run,
    runtime: createRuntime({
      root,
      run,
      env: {},
      pnpmPath: join(root, 'pnpm.mjs'),
      output: vi.fn(),
      ...overrides,
    }),
  };
}

describe('selectProposal: complete Git proposal and conservative fallback', () => {
  it('accepts pnpm 11.19 root inventory record while selecting only workspace packages', async () => {
    const root = await workspace();
    const values = [
      { name: 'stara', path: root },
      ...packageRecords.map(({ name, relativePath }) => ({ name, path: join(root, relativePath) })),
    ];
    const { runtime } = runtimeFor(root, { run: async () => passed(JSON.stringify(values)) });
    const inventory = await control.packageInventory(runtime);
    expect(inventory.map(({ name }) => name).sort()).toEqual(
      packageRecords.map(({ name }) => name).sort(),
    );
  });

  it.each(['misnamed-root', 'duplicate-root'])(
    'rejects ambiguous native inventory: %s',
    async (mutation) => {
      const root = await workspace();
      const values = [
        { name: mutation === 'misnamed-root' ? 'imposter' : 'stara', path: root },
        ...packageRecords.map(({ name, relativePath }) => ({
          name,
          path: join(root, relativePath),
        })),
      ];
      if (mutation === 'duplicate-root') values.unshift({ name: 'stara', path: root });
      const { runtime } = runtimeFor(root, { run: async () => passed(JSON.stringify(values)) });
      await expect(control.packageInventory(runtime)).rejects.toThrow();
    },
  );
  it.each(['push', 'pr'])(
    'selects all commits since merge-base for %s, not only the tip commit',
    async (stage) => {
      const root = await workspace({ gitRepository: true });
      await write(root, 'UI/shared/src/first-change.js', 'export const first = true;\n');
      git(root, 'add', '--all');
      git(root, 'commit', '-m', 'Synthetic first proposal commit');
      await write(root, 'backend/api/src/last-change.js', 'export const last = true;\n');
      git(root, 'add', '--all');
      git(root, 'commit', '-m', 'Synthetic final proposal commit');
      const { runtime, run } = runtimeFor(root);
      const result = await control.selectProposal(runtime, stage);
      expect(result.mode).toBe('affected');
      expect([...result.targets].sort()).toEqual(['@stara/api', '@stara/ui']);
      expect(
        run.mock.calls.some(([command, args]) => command === 'git' && args.includes('merge-base')),
      ).toBe(true);
      const diffs = run.mock.calls.filter(
        ([command, args]) => command === 'git' && args.includes('diff'),
      );
      expect(diffs.some(([, args]) => args.includes('-z') && args.includes('--no-renames'))).toBe(
        true,
      );
    },
  );

  it('broadens missing remote baseline history', async () => {
    const root = await workspace({ gitRepository: true });
    git(root, 'update-ref', '-d', 'refs/remotes/origin/main');
    const { runtime } = runtimeFor(root);
    expect(await control.selectProposal(runtime, 'push')).toMatchObject({ mode: 'all' });
  });

  it('keeps both package owners of a cross-package rename', async () => {
    const root = await workspace({ gitRepository: true });
    git(root, 'mv', 'UI/shared/src/index.js', 'UI/web/src/renamed.js');
    git(root, 'commit', '-m', 'Synthetic cross-package rename');
    const { runtime } = runtimeFor(root);
    const result = await control.selectProposal(runtime, 'pr');
    expect(result.mode).toBe('affected');
    expect([...result.targets].sort()).toEqual(['@stara/ui', '@stara/web']);
  });

  it.each(['package.json', 'docs/product-system.json', 'unowned/unknown.txt'])(
    'broadens a proposal touching %s',
    async (path) => {
      const root = await workspace({ gitRepository: true });
      await write(root, path, `${await readFile(join(root, path), 'utf8').catch(() => '')}\n`);
      git(root, 'add', '--all');
      git(root, 'commit', '-m', 'Synthetic global or unknown change');
      const { runtime } = runtimeFor(root);
      expect(await control.selectProposal(runtime, 'pr')).toMatchObject({ mode: 'all' });
    },
  );

  it('selects docs-only proposals explicitly', async () => {
    const root = await workspace({ gitRepository: true });
    await write(root, 'docs/guide.md', '# Synthetic public guide\n');
    git(root, 'add', '--all');
    git(root, 'commit', '-m', 'Synthetic documentation change');
    const { runtime } = runtimeFor(root);
    expect(await control.selectProposal(runtime, 'pr')).toMatchObject({
      mode: 'docs',
      targets: [],
    });
  });

  it('does not treat a failed Git diff as an empty successful proposal', async () => {
    const root = await workspace({ gitRepository: true });
    const base = runtimeFor(root);
    const { runtime } = runtimeFor(root, {
      run: async (command, args, options) => {
        if (command === 'git') throw new Error('synthetic Git failure');
        return base.run(command, args, options);
      },
    });
    const result = await control.selectProposal(runtime, 'pr');
    expect(result.mode).toBe('all');
  });
});

describe('runGates: native dependent selection and required evidence', () => {
  it('runs targeted mutation with a bounded timeout for a full PR selection and records both checks', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime, run } = runtimeFor(root);
    const results = await control.runGates(
      runtime,
      {
        mode: 'all',
        targets: packageRecords.map(({ name }) => name),
        reason: 'root policy change',
      },
      'pr',
    );
    const command = run.mock.calls.find(([, args]) => args.includes('test:mutation'));
    expect(command).toBeDefined();
    expect(command[1]).toContain('run');
    expect(command[1]).not.toContain('--filter');
    expect(command[2].timeout).toBe(600_000);
    for (const name of ['test:mutation', 'mutation-report'])
      expect(results).toContainEqual(
        expect.objectContaining({ name, required: true, status: 'pass' }),
      );
  });

  it.each(['docs', 'affected'])(
    'does not run targeted mutation for %s PR selection',
    async (mode) => {
      const root = await workspace({ gitRepository: true });
      const { runtime, run } = runtimeFor(root);
      await control.runGates(
        runtime,
        { mode, targets: mode === 'docs' ? [] : ['@stara/web'], reason: 'narrow proposal' },
        'pr',
      );
      expect(run.mock.calls.some(([, args]) => args.includes('test:mutation'))).toBe(false);
    },
  );

  it('rejects a failed mutation process despite existing successful mutation evidence', async () => {
    const root = await workspace({ gitRepository: true });
    const base = runtimeFor(root);
    const { runtime } = runtimeFor(root, {
      run: async (command, args, options) => {
        if (args.includes('test:mutation')) throw new Error('Synthetic required mutation failure');
        return base.run(command, args, options);
      },
    });
    await expect(
      control.runGates(
        runtime,
        { mode: 'all', targets: packageRecords.map(({ name }) => name), reason: 'root change' },
        'pr',
      ),
    ).rejects.toThrow(/mutation/i);
  });

  it.each([
    'missing',
    '',
    '{',
    '{}',
    '{"schemaVersion":"1","files":{}}',
    '{"schemaVersion":"1","files":{"policy.mjs":{"mutants":[]}}}',
    '{"schemaVersion":"1","files":{"policy.mjs":{"mutants":[{"status":"Pending"}]}}}',
  ])('rejects absent or malformed mutation evidence after exit zero: %s', async (report) => {
    const root = await workspace({ gitRepository: true });
    if (report === 'missing') await rm(join(root, '.artifacts/mutation/mutation.json'));
    else await write(root, '.artifacts/mutation/mutation.json', report);
    const { runtime } = runtimeFor(root);
    await expect(
      control.runGates(
        runtime,
        { mode: 'all', targets: packageRecords.map(({ name }) => name), reason: 'root change' },
        'pr',
      ),
    ).rejects.toThrow(/mutation/i);
  });

  it('asks pnpm for transitive dependents and executes the returned package set', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime, run } = runtimeFor(root);
    const results = await control.runGates(runtime, {
      mode: 'affected',
      targets: ['@stara/ui'],
      reason: 'Synthetic UI source change',
    });
    const list = run.mock.calls.find(
      ([, args]) => args.includes('list') && args.includes('--filter'),
    );
    expect(list).toBeDefined();
    expect(list[1]).toEqual(
      expect.arrayContaining(['--filter', '...@stara/ui', '--fail-if-no-match', '--json']),
    );
    expect(list[1]).toContain('-r');
    for (const script of [
      'tokens:check',
      'format:check',
      'lint',
      'security:secrets',
      'security:dependencies',
      'test:unit',
      'test:integration',
      'test:coverage',
      'typecheck',
      'build',
      'test:e2e',
      'test:a11y',
    ]) {
      expect(
        run.mock.calls.some(([, args]) => args.includes(script)),
        script,
      ).toBe(true);
    }
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.required === true && result.status === 'pass')).toBe(
      true,
    );
    expect(run.mock.calls.flatMap(([, args]) => args)).not.toContain('--if-present');
  });

  it.each(['[]', '{}', 'invalid json', '[{"name":"@stara/unknown"}]'])(
    'does not pass an empty, malformed, or unresolved native target set: %s',
    async (stdout) => {
      const root = await workspace({ gitRepository: true });
      const { runtime } = runtimeFor(root, {
        run: async (_command, args) => {
          if (args.includes('list')) return passed(stdout);
          return passed();
        },
      });
      await expect(
        control.runGates(runtime, { mode: 'affected', targets: ['@stara/ui'], reason: 'fixture' }),
      ).rejects.toThrow();
    },
  );

  it.each([
    'tokens:check',
    'format:check',
    'lint',
    'security:secrets',
    'security:dependencies',
    'test:unit',
    'test:integration',
    'test:coverage',
    'typecheck',
    'build',
    'test:e2e',
    'test:a11y',
  ])('cannot pass after required %s fails', async (script) => {
    const root = await workspace({ gitRepository: true });
    const base = runtimeFor(root);
    const { runtime } = runtimeFor(root, {
      run: async (command, args, opts) => {
        if (args.includes(script)) throw new Error(`Synthetic ${script} failure`);
        return base.run(command, args, opts);
      },
    });
    await expect(
      control.runGates(runtime, {
        mode: 'all',
        targets: packageRecords.map(({ name }) => name),
        reason: 'fixture',
      }),
    ).rejects.toThrow();
  });

  it.each(['web', 'ui', 'api', 'tooling'])(
    'rejects below-floor %s coverage despite all successful command exits',
    async (name) => {
      const root = await workspace({ gitRepository: true });
      await writeJson(root, `.artifacts/coverage/${name}/coverage-summary.json`, {
        total: { lines: { pct: 89.99 }, branches: { pct: 100 } },
      });
      const { runtime } = runtimeFor(root);
      await expect(
        control.runGates(runtime, {
          mode: 'all',
          targets: packageRecords.map(({ name }) => name),
          reason: 'fixture',
        }),
      ).rejects.toThrow();
    },
  );

  it.each([
    'UI/web/dist/index.html',
    'backend/api/dist/index.js',
    '.artifacts/coverage/ui/coverage-summary.json',
  ])('rejects missing required evidence file %s', async (path) => {
    const root = await workspace({ gitRepository: true });
    await rm(join(root, path));
    const { runtime } = runtimeFor(root);
    await expect(
      control.runGates(runtime, {
        mode: 'all',
        targets: packageRecords.map(({ name }) => name),
        reason: 'fixture',
      }),
    ).rejects.toThrow();
  });

  it.each(['UI/web/dist/index.html', 'backend/api/dist/index.js'])(
    'rejects an empty artifact %s',
    async (path) => {
      const root = await workspace({ gitRepository: true });
      await write(root, path, '');
      const { runtime } = runtimeFor(root);
      await expect(
        control.runGates(runtime, {
          mode: 'all',
          targets: packageRecords.map(({ name }) => name),
          reason: 'fixture',
        }),
      ).rejects.toThrow();
    },
  );

  it('still formats, scans secrets, and validates layout for documentation-only proposals', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime, run } = runtimeFor(root);
    const results = await control.runGates(runtime, {
      mode: 'docs',
      targets: [],
      reason: 'fixture',
    });
    expect(run.mock.calls.some(([, args]) => args.includes('format:check'))).toBe(true);
    expect(run.mock.calls.some(([, args]) => args.includes('security:secrets'))).toBe(true);
    expect(run.mock.calls.some(([, args]) => args.includes('test:e2e'))).toBe(false);
    expect(results.some((result) => /layout/i.test(result.name) && result.status === 'pass')).toBe(
      true,
    );
  });

  it('rejects an unknown selection mode rather than silently treating it as docs', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime } = runtimeFor(root);
    await expect(
      control.runGates(runtime, { mode: 'unknown', targets: [], reason: 'fixture' }),
    ).rejects.toThrow();
  });
});
