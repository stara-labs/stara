import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, emptyWorkspace, write } from './fixtures.mjs';

afterEach(cleanupFixtures);

async function execute({ failure = false, runId } = {}) {
  const root = await emptyWorkspace();
  const script = await readFile(new URL('../scripts/codeql.mjs', import.meta.url), 'utf8');
  await write(root, 'tooling/scripts/codeql.mjs', script);
  await write(
    root,
    'tooling/lib/process.mjs',
    `export const createRuntime = (options = {}) => ({ runId: options.runId ?? 'synthetic-generated-run' });\n`,
  );
  await write(
    root,
    'tooling/lib/codeql.mjs',
    failure
      ? `export const codeql = async () => { throw new Error('Synthetic CodeQL verification failed'); };\n`
      : `export const codeql = async (runtime) => console.log(JSON.stringify({ runId: runtime.runId }));\n`,
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !['STARA_CODEQL_RUN_ID', 'NODE_OPTIONS', 'NODE_PATH'].includes(key.toUpperCase()),
    ),
  );
  if (runId !== undefined) env.STARA_CODEQL_RUN_ID = runId;
  return spawnSync(process.execPath, [join(root, 'tooling/scripts/codeql.mjs')], {
    cwd: root,
    env,
    timeout: 5_000,
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('CodeQL entrypoint with synthetic runtime and analysis providers', () => {
  it.each([
    '',
    '../outside',
    '..\\outside',
    '/absolute',
    'C:\\outside',
    'bad run',
    'a'.repeat(129),
  ])('rejects invalid run identifier %j before invoking analysis', async (runId) => {
    const result = await execute({ runId });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid CodeQL gate run identifier');
    expect(result.stdout).toBe('');
  });

  it('forwards the parent gate run identity to the analysis runtime', async () => {
    const result = await execute({ runId: 'synthetic-parent-gate-identity' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ runId: 'synthetic-parent-gate-identity' });
  });

  it('allows direct invocations to obtain a generated run identity', async () => {
    const result = await execute();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ runId: 'synthetic-generated-run' });
  });

  it('propagates analyzer failure to the hook exit status', async () => {
    const result = await execute({ failure: true });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Synthetic CodeQL verification failed');
  });
});
