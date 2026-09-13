import { execFile, spawnSync } from 'node:child_process';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, 'tooling/scripts/configure-stara-plugin.mjs');
const plugin = join(root, 'tooling/plugins/stara');
const apiRoot = join(root, 'backend/api');
const apiRequire = createRequire(join(apiRoot, 'package.json'));
const directories = [];
const setupDiagnostic =
  "Stara plugin setup failed. Use this helper's built checkout with its pinned Node, a new output under its .artifacts directory, and an HTTP loopback API origin.";
let configureStaraPlugin;
let canonicalRoot;

beforeAll(async () => {
  canonicalRoot = await realpath(root);
  ({ configureStaraPlugin } = await import(pathToFileURL(script).href));
  await promisify(execFile)(
    process.execPath,
    [apiRequire.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
    { cwd: apiRoot, timeout: 30000, windowsHide: true },
  );
});

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = await realpath(directory.path);
    const child = relative(directory.parent, target);
    if (!child || isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) {
      throw new Error('Refusing cleanup outside the owned plugin setup fixture');
    }
    await rm(target, { recursive: true, force: true });
  }
});

async function temporary(parentDirectory = join(root, '.artifacts')) {
  await mkdir(parentDirectory, { recursive: true });
  const parent = await realpath(parentDirectory);
  const directory = await mkdtemp(join(parent, 'stara-plugin-setup-'));
  directories.push({ path: directory, parent });
  return directory;
}

async function copiedHelper(repository, problem) {
  await mkdir(join(repository, 'tooling/scripts'), { recursive: true });
  await mkdir(join(repository, 'backend/api/dist/mcp'), { recursive: true });
  await cp(script, join(repository, 'tooling/scripts/configure-stara-plugin.mjs'));
  await cp(plugin, join(repository, 'tooling/plugins/stara'), { recursive: true });
  await cp(join(root, 'tooling/.agents'), join(repository, 'tooling/.agents'), { recursive: true });
  await writeFile(
    join(repository, 'package.json'),
    JSON.stringify({ name: problem === 'wrong-root' ? 'other' : 'stara', type: 'module' }),
  );
  await writeFile(
    join(repository, 'backend/api/package.json'),
    JSON.stringify({ name: problem === 'wrong-api' ? 'other' : '@stara/api', type: 'module' }),
  );
  await writeFile(
    join(repository, '.node-version'),
    problem === 'wrong-pin' ? '0.0.0' : process.versions.node,
  );
  if (problem !== 'missing-build')
    await writeFile(join(repository, 'backend/api/dist/mcp/index.js'), 'export {};');
  await cp(join(apiRoot, 'dist/mcp/config.js'), join(repository, 'backend/api/dist/mcp/config.js'));
  return join(repository, 'tooling/scripts/configure-stara-plugin.mjs');
}

function configureCopiedHelper(helperScript, repository, destination) {
  return spawnSync(process.execPath, [helperScript, repository, destination], {
    cwd: root,
    input: '',
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

it('configures an independently copied helper only for the checkout that owns it', async () => {
  const repository = join(await temporary(), 'own-helper-checkout');
  const helperScript = await copiedHelper(repository);
  const destination = join(repository, '.artifacts/output');
  const result = configureCopiedHelper(helperScript, repository, destination);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(
    JSON.parse(await readFile(join(destination, 'plugins/stara/checkout.json'), 'utf8')),
  ).toEqual({ repoRoot: await realpath(repository) });
});

it('rejects an output outside the helper repository artifacts directory', async () => {
  const destination = join(await temporary(tmpdir()), 'outside-output');
  await expect(configureStaraPlugin({ repoRoot: root, destination })).rejects.toThrow(
    setupDiagnostic,
  );
  await expect(access(destination)).rejects.toThrow();
});

it('refuses a foreign checkout even when its metadata, pin, and compiled config are valid', async () => {
  const directory = await temporary();
  const foreign = join(directory, 'foreign-checkout');
  await mkdir(join(foreign, 'backend/api/dist/mcp'), { recursive: true });
  await writeFile(join(foreign, 'package.json'), JSON.stringify({ name: 'stara', type: 'module' }));
  await writeFile(
    join(foreign, 'backend/api/package.json'),
    JSON.stringify({ name: '@stara/api', type: 'module' }),
  );
  await writeFile(join(foreign, '.node-version'), process.versions.node);
  await writeFile(join(foreign, 'backend/api/dist/mcp/index.js'), 'export {};');
  await cp(join(apiRoot, 'dist/mcp/config.js'), join(foreign, 'backend/api/dist/mcp/config.js'));
  const destination = join(directory, 'not-created');
  await expect(configureStaraPlugin({ repoRoot: foreign, destination })).rejects.toThrow(
    setupDiagnostic,
  );
  await expect(access(destination)).rejects.toThrow();
});

it('rejects an output parent junction escaping the artifacts directory', async () => {
  const parent = await temporary();
  const outside = await temporary(tmpdir());
  const linked = join(parent, 'linked-parent');
  await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const destination = join(linked, 'outside-output');
  await expect(configureStaraPlugin({ repoRoot: root, destination })).rejects.toThrow(
    setupDiagnostic,
  );
  await expect(access(join(outside, 'outside-output'))).rejects.toThrow();
});

it('requires an existing output parent and does not create intermediate directories', async () => {
  const parent = join(await temporary(), 'missing-parent');
  await expect(
    configureStaraPlugin({ repoRoot: root, destination: join(parent, 'new-output') }),
  ).rejects.toThrow(setupDiagnostic);
  await expect(access(parent)).rejects.toThrow();
});

it('rejects a helper artifacts junction outside its own repository', async () => {
  const helper = join(await temporary(), 'synthetic-helper');
  const outside = await temporary(tmpdir());
  const helperScript = await copiedHelper(helper);
  await symlink(
    outside,
    join(helper, '.artifacts'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = configureCopiedHelper(helperScript, helper, join(helper, '.artifacts/output'));
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`${setupDiagnostic}\n`);
  await expect(access(join(outside, 'output'))).rejects.toThrow();
});

it.each([undefined, 'http://127.0.0.1:34567/', 'http://[::1]:34567', 'http://127.0.0.1:80'])(
  'prepares a new local bundle with validated literal configuration for %s',
  async (apiOrigin) => {
    const destination = join(await temporary(), 'bundle with spaces # synthetic');
    const sourceConfig = await readFile(join(plugin, 'mcp.json'), 'utf8');
    await expect(
      configureStaraPlugin({ repoRoot: root, destination, apiOrigin }),
    ).resolves.toBeUndefined();
    const configured = JSON.parse(
      await readFile(join(destination, 'plugins/stara/mcp.json'), 'utf8'),
    );
    const expected =
      apiOrigin === undefined
        ? 'http://127.0.0.1:3000'
        : apiOrigin.replace(/\/$/, '').replace(':80', '');
    expect(configured.mcpServers.stara).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['${PLUGIN_ROOT}/scripts/mcp.mjs'],
      env: { STARA_REPO_ROOT: canonicalRoot, STARA_API_URL: expected },
    });
    expect(
      JSON.parse(await readFile(join(destination, 'plugins/stara/checkout.json'), 'utf8')),
    ).toEqual({ repoRoot: canonicalRoot });
    expect(await readFile(join(destination, 'plugins/stara/scripts/launch.mjs'), 'utf8')).toBe(
      await readFile(join(plugin, 'scripts/launch.mjs'), 'utf8'),
    );
    expect(await readFile(join(destination, '.agents/plugins/marketplace.json'), 'utf8')).toBe(
      await readFile(join(root, 'tooling/.agents/plugins/marketplace.json'), 'utf8'),
    );
    expect(await readFile(join(plugin, 'mcp.json'), 'utf8')).toBe(sourceConfig);
    await expect(access(join(destination, 'plugins/stara/node_modules'))).rejects.toThrow();
  },
);

it.each([
  ['relative repository', '.', undefined],
  ['missing repository', undefined, undefined],
  ['remote origin', root, 'https://synthetic-secret.invalid'],
  ['hostname origin', root, 'http://localhost:3000'],
  ['credential origin', root, 'http://synthetic-secret@127.0.0.1:3000'],
  ['path origin', root, 'http://127.0.0.1:3000/synthetic-secret'],
  ['query origin', root, 'http://127.0.0.1:3000/?synthetic-secret'],
  ['fragment origin', root, 'http://127.0.0.1:3000/#synthetic-secret'],
])('rejects %s before creating output', async (_label, repoRoot, apiOrigin) => {
  const destination = join(await temporary(), 'not-created');
  await expect(configureStaraPlugin({ repoRoot, destination, apiOrigin })).rejects.toThrow();
  await expect(access(destination)).rejects.toThrow();
});

it.each([undefined, '', '.', 'synthetic-relative'])(
  'requires an explicit absolute output path %s',
  async (destination) => {
    await expect(configureStaraPlugin({ repoRoot: root, destination })).rejects.toThrow();
  },
);

it.each(['directory', 'file'])('never overwrites an existing %s', async (kind) => {
  const destination = join(await temporary(), 'existing');
  const sentinel = kind === 'directory' ? join(destination, 'sentinel.txt') : destination;
  if (kind === 'directory') await mkdir(destination);
  await writeFile(sentinel, 'synthetic-preserve-me');
  await expect(configureStaraPlugin({ repoRoot: root, destination })).rejects.toThrow();
  expect(await readFile(sentinel, 'utf8')).toBe('synthetic-preserve-me');
});

it.each(['', 'synthetic-output-that-must-not-be-created'])(
  'rejects the source plugin itself or its descendant %s',
  async (suffix) => {
    const destination = join(plugin, suffix);
    const before = await readFile(join(plugin, 'mcp.json'), 'utf8');
    await expect(configureStaraPlugin({ repoRoot: root, destination })).rejects.toThrow(
      setupDiagnostic,
    );
    expect(await readFile(join(plugin, 'mcp.json'), 'utf8')).toBe(before);
    if (suffix) await expect(access(destination)).rejects.toThrow();
  },
);

it('allows only one concurrent creator of a destination', async () => {
  const destination = join(await temporary(), 'exclusive-output');
  const results = await Promise.allSettled([
    configureStaraPlugin({ repoRoot: root, destination, apiOrigin: 'http://127.0.0.1:34567' }),
    configureStaraPlugin({ repoRoot: root, destination, apiOrigin: 'http://127.0.0.1:34568' }),
  ]);
  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  const configured = JSON.parse(
    await readFile(join(destination, 'plugins/stara/mcp.json'), 'utf8'),
  );
  const winner = results.findIndex(({ status }) => status === 'fulfilled');
  expect(configured.mcpServers.stara.env.STARA_API_URL).toBe(
    winner === 0 ? 'http://127.0.0.1:34567' : 'http://127.0.0.1:34568',
  );
});

it('rejects a nonexistent absolute checkout before creating output', async () => {
  const directory = await temporary();
  const destination = join(directory, 'not-created');
  await expect(
    configureStaraPlugin({ repoRoot: join(directory, 'absent'), destination }),
  ).rejects.toThrow();
  await expect(access(destination)).rejects.toThrow();
});

it.each(['wrong-root', 'wrong-api', 'wrong-pin', 'missing-build'])(
  'rejects a checkout with %s before creating output',
  async (problem) => {
    const directory = await temporary();
    const repository = join(directory, 'synthetic-secret');
    const helperScript = await copiedHelper(repository, problem);
    const destination = join(repository, '.artifacts/not-created');
    const result = configureCopiedHelper(helperScript, repository, destination);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${setupDiagnostic}\n`);
    await expect(access(destination)).rejects.toThrow();
  },
);

it('fails the CLI promptly without disclosing invalid input', async () => {
  const destination = join(await temporary(), 'not-created');
  const result = spawnSync(process.execPath, [script, 'synthetic-secret', destination], {
    cwd: root,
    input: '',
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('synthetic-secret');
  expect(result.stderr).not.toContain(destination);
  expect(result.stderr).not.toContain('Error:');
  expect(result.stderr).toBe(`${setupDiagnostic}\n`);
  await expect(access(destination)).rejects.toThrow();
});

it.each([{ args: [] }, { args: ['one-argument'] }, { args: ['a', 'b', 'c', 'd'] }])(
  'rejects invalid CLI argument counts $args',
  ({ args }) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: root,
      input: '',
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${setupDiagnostic}\n`);
  },
);

it('creates the configured copy through the documented native CLI', async () => {
  const destination = join(await temporary(), 'cli output # synthetic');
  const result = spawnSync(process.execPath, [script, root, destination], {
    cwd: root,
    input: '',
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const configured = JSON.parse(
    await readFile(join(destination, 'plugins/stara/mcp.json'), 'utf8'),
  );
  expect(configured.mcpServers.stara.env).toEqual({
    STARA_REPO_ROOT: canonicalRoot,
    STARA_API_URL: 'http://127.0.0.1:3000',
  });
});
