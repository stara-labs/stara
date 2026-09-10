import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  captureEvidence,
  cleanupFixtures,
  git,
  json,
  packageRecords,
  passed,
  workspace,
  write,
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

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (hashes) =>
  sha(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))));

function instrumented(root, overrides = {}) {
  const publish = captureEvidence(root);
  const run = vi.fn(async (command, args, options) => {
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
    if (args.includes('--version')) return passed(args[0] === '--version' ? 'v24.16.0' : '11.19.0');
    await publish(args);
    return passed();
  });
  return {
    run,
    runtime: createRuntime({
      root,
      env: {},
      pnpmPath: join(root, 'pnpm.mjs'),
      actor: 'synthetic-test-author',
      runId: 'synthetic-control-run',
      output: vi.fn(),
      run,
      ...overrides,
    }),
  };
}

describe('build evidence: exact artifact, source, dependencies and runtime identities', () => {
  it('writes a manifest hashing every output file, not only entry points', async () => {
    const root = await workspace({ gitRepository: true });
    await write(root, 'UI/web/dist/assets/chunk.js', 'synthetic chunk bytes');
    await write(root, 'backend/api/dist/lib/nested.js', 'synthetic backend bytes');
    const { runtime } = instrumented(root);
    await control.artifact(runtime);
    const manifest = await json(root, '.artifacts/build/manifest.json');
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      revision: git(root, 'rev-parse', 'HEAD').toString().trim(),
      actor: 'synthetic-test-author',
      runId: 'synthetic-control-run',
      nodeVersion: '24.16.0',
      pnpmVersion: '11.19.0',
    });
    expect(typeof manifest.dirty).toBe('boolean');
    expect(Number.isFinite(Date.parse(manifest.createdAt))).toBe(true);
    expect(manifest.productSystemRevision).toBe(
      (await json(root, 'docs/product-system.json')).revision,
    );
    expect(manifest.lockfileSha256).toBe(sha(await readFile(join(root, 'pnpm-lock.yaml'))));
    expect(manifest.configHashes['package.json']).toBe(
      sha(await readFile(join(root, 'package.json'))),
    );
    expect(manifest.sourceHashes['UI/web/src/index.js']).toBe(
      sha(await readFile(join(root, 'UI/web/src/index.js'))),
    );
    expect(manifest.artifacts).toEqual({
      'UI/web/dist/index.html': sha(await readFile(join(root, 'UI/web/dist/index.html'))),
      'UI/web/dist/assets/chunk.js': sha('synthetic chunk bytes'),
      'backend/api/dist/index.js': sha(await readFile(join(root, 'backend/api/dist/index.js'))),
      'backend/api/dist/lib/nested.js': sha('synthetic backend bytes'),
    });
    expect(manifest.sourceIdentity).toBe(identity(manifest.sourceHashes));
    expect(manifest.artifactIdentity).toBe(identity(manifest.artifacts));
    expect(
      Object.keys(manifest.sourceHashes).some(
        (path) =>
          path.includes('node_modules') ||
          path.includes('/dist/') ||
          path.startsWith('.artifacts/'),
      ),
    ).toBe(false);
  });

  it('changes source and output identities when non-entry source and output bytes change', async () => {
    const root = await workspace({ gitRepository: true });
    await write(root, 'UI/web/dist/assets/chunk.js', 'first chunk');
    const { runtime } = instrumented(root);
    await control.artifact(runtime);
    const first = await json(root, '.artifacts/build/manifest.json');
    await write(root, 'UI/web/src/index.js', 'export const fixture = "changed";\n');
    await write(root, 'UI/web/dist/assets/chunk.js', 'second chunk');
    await control.artifact(runtime);
    const second = await json(root, '.artifacts/build/manifest.json');
    expect(second.sourceIdentity).not.toBe(first.sourceIdentity);
    expect(second.artifactIdentity).not.toBe(first.artifactIdentity);
    expect(second.dirty).toBe(true);
  });
});

describe('gate evidence: selection, durations and explicit results survive failure', () => {
  it('writes selection and required results for documentation PRs while running protected tooling checks', async () => {
    const root = await workspace({ gitRepository: true });
    const { runtime, run } = instrumented(root);
    const selection = { mode: 'docs', targets: [], reason: 'Synthetic documentation-only PR' };
    await control.runGates(runtime, selection, 'pr');
    const args = run.mock.calls.flatMap(([, args]) => args);
    for (const required of ['tokens:check', 'test:unit', 'test:coverage', '@stara/tooling'])
      expect(args).toContain(required);
    expect(args).not.toContain('test:e2e');
    expect(args).not.toContain('test:a11y');
    const directory = '.artifacts/gates/synthetic-control-run';
    expect(await json(root, `${directory}/selection.json`)).toMatchObject(selection);
    const evidence = await json(root, `${directory}/results.json`);
    expect(evidence.status).toBe('pass');
    expect(evidence.results.length).toBeGreaterThan(0);
    expect(
      evidence.results.every(
        (result) =>
          result.required === true &&
          result.status === 'pass' &&
          Number.isFinite(result.durationMs) &&
          result.durationMs >= 0,
      ),
    ).toBe(true);
  });

  it('records the failed required check and never labels later unattempted work passing', async () => {
    const root = await workspace({ gitRepository: true });
    const base = instrumented(root);
    const { runtime } = instrumented(root, {
      run: async (command, args, options) => {
        if (args.includes('lint')) throw new Error('synthetic lint assertion failure');
        return base.run(command, args, options);
      },
    });
    await expect(
      control.runGates(
        runtime,
        { mode: 'all', targets: packageRecords.map(({ name }) => name), reason: 'fixture' },
        'pr',
      ),
    ).rejects.toThrow();
    const evidence = await json(root, '.artifacts/gates/synthetic-control-run/results.json');
    expect(evidence.status).toBe('fail');
    expect(
      evidence.results.some(
        (result) => result.name === 'lint' && result.required === true && result.status === 'fail',
      ),
    ).toBe(true);
    expect(
      evidence.results.some((result) => result.name === 'test:e2e' && result.status === 'pass'),
    ).toBe(false);
  });

  it('retains actionable bounded command failure details while redacting credentials', async () => {
    const root = await workspace();
    const secret = 'SYNTHETIC_SECRET_DO_NOT_DISCLOSE';
    const env = { STARA_ACCESS_TOKEN: secret };
    const { runtime } = instrumented(root, {
      env,
      run: async () => ({
        code: 1,
        stdout: 'Synthetic case: rejects expired tokens\n',
        stderr: `AssertionError: expected rejected token\nTOKEN=${secret}\nhttps://user:password@example.invalid/path\n${'x'.repeat(6000)}`,
      }),
    });
    const failure = await runtime
      .run(process.execPath, [join(root, 'pnpm.mjs'), 'run', 'test:unit'], { record: true })
      .then(
        () => null,
        (error) => error,
      );
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('test:unit');
    expect(failure.message).toMatch(/expired tokens|AssertionError/);
    expect(failure.message.length).toBeLessThanOrEqual(4096);
    expect(failure.message).not.toContain(secret);
    expect(failure.message).not.toContain('user:password');
    const path = join(root, '.artifacts/gates/synthetic-control-run');
    const records = await json(root, '.artifacts/gates/synthetic-control-run/commands.json');
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'fail', code: 1, durationMs: expect.any(Number) }),
      ]),
    );
    for (const file of await readdir(path)) {
      const bytes = await readFile(join(path, file));
      expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
      expect(bytes.toString()).not.toContain(secret);
      expect(bytes.toString()).not.toContain('user:password');
    }
  });
});
