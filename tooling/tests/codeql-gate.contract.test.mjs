import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGates } from '../lib/gates.mjs';
import { createRuntime } from '../lib/process.mjs';
import { cleanupFixtures, packageRecords, passed, workspace } from './fixtures.mjs';

afterEach(cleanupFixtures);

async function fixture(failure) {
  const root = await workspace();
  const run = vi.fn(async (_command, args) => {
    if (args.includes('list'))
      return passed(
        JSON.stringify(
          packageRecords.map(({ name, relativePath }) => ({
            name,
            path: join(root, relativePath),
          })),
        ),
      );
    if (args.includes('security:codeql') && failure) throw failure;
    return passed();
  });
  const runtime = createRuntime({
    root,
    run,
    env: {},
    pnpmPath: join(root, 'pnpm.mjs'),
    output: vi.fn(),
    runId: 'codeql-gate-contract',
  });
  return { root, runtime, run };
}

describe('commit gate: required real CodeQL command', () => {
  it('keeps the documented documentation-only commit scope', async () => {
    const { runtime, run } = await fixture();
    await runGates(runtime, { mode: 'docs', targets: [], reason: 'Synthetic docs' }, 'commit');
    expect(run.mock.calls.some(([, args]) => args.includes('security:codeql'))).toBe(false);
  });

  it.each(['affected', 'all'])(
    'runs and records CodeQL for a %s source candidate',
    async (mode) => {
      const { runtime, run } = await fixture();
      const results = await runGates(
        runtime,
        { mode, targets: ['@stara/api'], reason: 'Synthetic code change' },
        'commit',
      );
      const command = run.mock.calls.find(([, args]) => args.includes('security:codeql'));
      expect(command).toBeDefined();
      expect(command[1]).toContain('run');
      expect(command[1]).not.toContain('--filter');
      expect(command[2].cwd).toBe(runtime.root);
      expect(command[2].env.STARA_CODEQL_RUN_ID).toBe(runtime.runId);
      expect(command[2].timeout).toBeGreaterThan(0);
      expect(command[2].timeout).toBeLessThanOrEqual(1_800_000);
      expect(results).toContainEqual(
        expect.objectContaining({ name: 'security:codeql', required: true, status: 'pass' }),
      );
    },
  );

  it('blocks a commit and retains failed evidence when CodeQL cannot pass', async () => {
    const { root, runtime } = await fixture(new Error('Synthetic CodeQL analysis failure'));
    await expect(
      runGates(
        runtime,
        { mode: 'affected', targets: ['@stara/api'], reason: 'Synthetic code change' },
        'commit',
      ),
    ).rejects.toThrow(/CodeQL/);
    const report = JSON.parse(
      await readFile(join(root, '.artifacts/gates/codeql-gate-contract/results.json'), 'utf8'),
    );
    expect(report.status).toBe('fail');
    expect(report.results).toContainEqual(
      expect.objectContaining({ name: 'security:codeql', required: true, status: 'fail' }),
    );
  });
});
