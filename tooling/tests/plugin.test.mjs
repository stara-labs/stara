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
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const bindingFixture = vi.hoisted(() => ({ root: undefined }));
vi.mock('node:fs/promises', async (loadOriginal) => {
  const original = await loadOriginal();
  return {
    ...original,
    realpath: vi.fn(original.realpath),
    readFile: (...args) => {
      // Unit cases bind synthetic checkouts without modifying the repository's
      // fail-closed template. Native cases below read real copied binding files.
      if (
        bindingFixture.root !== undefined &&
        args[0] instanceof URL &&
        args[0].href === new URL('../plugins/stara/checkout.json', import.meta.url).href
      ) {
        return Promise.resolve(JSON.stringify({ repoRoot: bindingFixture.root }));
      }
      return original.readFile(...args);
    },
  };
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const plugin = join(root, 'tooling/plugins/stara');
const entry = join(plugin, 'scripts/mcp.mjs');
const apiRoot = join(root, 'backend/api');
const apiRequire = createRequire(join(apiRoot, 'package.json'));
const cleanups = [];
const diagnostic =
  'Stara plugin could not start. Run plugin setup from the intended trusted Stara checkout with its pinned Node and a built @stara/api.';
let launchStaraMcp;
let configureStaraPlugin;
let pin;

beforeAll(async () => {
  pin = (await readFile(join(root, '.node-version'), 'utf8')).trim();
  ({ launchStaraMcp } = await import(pathToFileURL(join(plugin, 'scripts/launch.mjs')).href));
  ({ configureStaraPlugin } = await import(
    pathToFileURL(join(root, 'tooling/scripts/configure-stara-plugin.mjs')).href
  ));
});

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
  bindingFixture.root = undefined;
});

async function temporary(parentDirectory = tmpdir()) {
  const parent = await realpath(parentDirectory);
  const directory = await mkdtemp(join(parent, 'stara-plugin-'));
  cleanups.push(async () => {
    const target = await realpath(directory);
    const child = relative(parent, target);
    if (!child || isAbsolute(child) || child.startsWith(`..${sep}`) || child === '..') {
      throw new Error('Refusing cleanup outside the owned plugin fixture');
    }
    await rm(target, { recursive: true, force: true });
  });
  return directory;
}

async function fixture(options = {}) {
  const repository = join(
    await temporary(),
    options.directory ?? 'checkout with spaces # synthetic-secret',
  );
  await mkdir(join(repository, 'backend/api/dist/mcp'), { recursive: true });
  await writeFile(
    join(repository, 'package.json'),
    JSON.stringify({ name: options.name ?? 'stara', type: 'module' }),
  );
  await writeFile(
    join(repository, 'backend/api/package.json'),
    JSON.stringify({ name: options.apiName ?? '@stara/api', type: 'module' }),
  );
  await writeFile(join(repository, '.node-version'), options.pin ?? pin);
  if (!options.missingBuild) {
    await writeFile(join(repository, 'backend/api/dist/mcp/index.js'), 'export {};\n');
  }
  bindingFixture.root = await realpath(repository);
  return repository;
}

async function boundPluginFor(repository) {
  const destination = join(await temporary(), 'bound-plugin');
  await cp(plugin, destination, { recursive: true });
  await writeFile(
    join(destination, 'checkout.json'),
    JSON.stringify({ repoRoot: await realpath(repository) }),
  );
  return destination;
}

describe('Stara plugin launch boundary', () => {
  it.each([
    { label: 'missing', bytes: undefined },
    { label: 'malformed', bytes: '{synthetic-secret' },
    { label: 'empty', bytes: '{"repoRoot":""}' },
    { label: 'relative', bytes: '{"repoRoot":"synthetic-secret"}' },
    { label: 'null', bytes: 'null' },
    { label: 'wrong type', bytes: '{"repoRoot":12}' },
    { label: 'missing property', bytes: '{}' },
  ])('refuses a $label fixed binding file under native Node', async ({ bytes }) => {
    const repository = await fixture();
    const boundPlugin = await boundPluginFor(repository);
    const binding = join(boundPlugin, 'checkout.json');
    if (bytes === undefined) await rm(binding);
    else await writeFile(binding, bytes);
    const result = spawnSync(process.execPath, [join(boundPlugin, 'scripts/mcp.mjs')], {
      cwd: root,
      env: { ...process.env, STARA_REPO_ROOT: repository },
      input: '',
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${diagnostic}\n`);
  });

  it('rejects a mismatched environment root before any realpath lookup', async () => {
    const repository = await fixture();
    const otherRoot = await fixture();
    bindingFixture.root = repository;
    vi.mocked(realpath).mockClear();
    const load = vi.fn();
    await expect(
      launchStaraMcp({ env: { STARA_REPO_ROOT: otherRoot }, version: pin, load }),
    ).rejects.toThrow(diagnostic);
    expect(realpath).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('accepts a lexically normalized spelling of its bound checkout', async () => {
    const repository = await fixture();
    const load = vi.fn();
    await launchStaraMcp({
      env: { STARA_REPO_ROOT: `${repository}${sep}.${sep}` },
      version: pin,
      load,
    });
    expect(load).toHaveBeenCalledExactlyOnceWith(
      pathToFileURL(await realpath(join(repository, 'backend/api/dist/mcp/index.js'))).href,
    );
  });

  it('refuses environment retargeting away from the configured checkout binding', async () => {
    const configuredRoot = await fixture();
    const otherRoot = await fixture();
    const boundPlugin = join(dirname(configuredRoot), 'bound-plugin');
    await cp(plugin, boundPlugin, { recursive: true });
    await writeFile(
      join(boundPlugin, 'checkout.json'),
      JSON.stringify({ repoRoot: await realpath(configuredRoot) }),
    );
    const result = spawnSync(process.execPath, [join(boundPlugin, 'scripts/mcp.mjs')], {
      cwd: root,
      env: { ...process.env, STARA_REPO_ROOT: otherRoot },
      input: '',
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${diagnostic}\n`);
  });

  it('refuses the unconfigured source plugin even when an environment checkout is valid', async () => {
    const repository = await fixture();
    const result = spawnSync(process.execPath, [entry], {
      cwd: root,
      env: { ...process.env, STARA_REPO_ROOT: repository },
      input: '',
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${diagnostic}\n`);
  });

  it('rejects a junction alias that differs from the configured canonical binding', async () => {
    const repository = await fixture();
    const selected = join(dirname(repository), 'selected-checkout-link');
    await symlink(repository, selected, process.platform === 'win32' ? 'junction' : 'dir');
    const load = vi.fn();
    await expect(
      launchStaraMcp({ env: { STARA_REPO_ROOT: selected }, version: pin, load }),
    ).rejects.toThrow(diagnostic);
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['backend/api', 'backend/api/dist/mcp'])(
    'rejects a descendant junction escaping the selected root through %s',
    async (relativePath) => {
      const repository = await fixture();
      // A sibling whose name starts with the selected root also exercises the
      // separator boundary, which a plain string-prefix check would miss.
      const outside = join(dirname(repository), `${basename(repository)}-outside`);
      const selectedPath = join(repository, relativePath);
      await cp(selectedPath, outside, { recursive: true });
      await rm(selectedPath, { recursive: true, force: true });
      await symlink(outside, selectedPath, process.platform === 'win32' ? 'junction' : 'dir');
      const load = vi.fn();
      await expect(
        launchStaraMcp({ env: { STARA_REPO_ROOT: repository }, version: pin, load }),
      ).rejects.toThrow(diagnostic);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it('uses the inherited explicit checkout and current Node for the default invocation', async () => {
    // Vitest's module resolver cannot import the encoded # path; native Node is
    // exercised with that path below, while this case covers option defaults.
    const repository = await fixture({ directory: 'checkout' });
    vi.stubEnv('STARA_REPO_ROOT', repository);
    await expect(launchStaraMcp()).resolves.toBeUndefined();
  });

  it('loads the explicit checkout containing spaces and # under native Node', async () => {
    const repository = await fixture();
    const boundPlugin = await boundPluginFor(repository);
    const result = spawnSync(process.execPath, [join(boundPlugin, 'scripts/mcp.mjs')], {
      cwd: root,
      env: { ...process.env, STARA_REPO_ROOT: repository },
      input: '',
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('uses the explicit checkout and a file URL that survives spaces and fragments', async () => {
    const repository = await fixture();
    const load = vi.fn().mockResolvedValue({});
    await launchStaraMcp({ env: { STARA_REPO_ROOT: repository }, version: pin, load });
    expect(load).toHaveBeenCalledExactlyOnceWith(
      pathToFileURL(join(repository, 'backend/api/dist/mcp/index.js')).href,
    );
  });

  it.each([undefined, '', '.', 'backend/api', 'https://synthetic-secret.invalid/repo'])(
    'refuses missing or nonabsolute checkout %s without loading anything',
    async (repository) => {
      await fixture();
      const load = vi.fn();
      await expect(
        launchStaraMcp({ env: { STARA_REPO_ROOT: repository }, version: pin, load }),
      ).rejects.toThrow(diagnostic);
      expect(load).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['wrong root package', { name: 'synthetic-secret' }],
    ['wrong API package', { apiName: 'synthetic-secret' }],
    ['missing compiled server', { missingBuild: true }],
    ['mismatched Node pin', { pin: '0.0.0' }],
    ['empty Node pin', { pin: '' }],
    ['nonversion Node pin', { pin: 'synthetic-secret' }],
  ])('refuses %s before loading the MCP server', async (_label, options) => {
    const repository = await fixture(options);
    const load = vi.fn();
    await expect(
      launchStaraMcp({ env: { STARA_REPO_ROOT: repository }, version: pin, load }),
    ).rejects.toThrow(diagnostic);
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['package.json', 'backend/api/package.json', '.node-version'])(
    'refuses malformed or missing metadata %s',
    async (path) => {
      const repository = await fixture();
      await writeFile(join(repository, path), 'synthetic-secret{');
      const load = vi.fn();
      await expect(
        launchStaraMcp({ env: { STARA_REPO_ROOT: repository }, version: pin, load }),
      ).rejects.toThrow(diagnostic);
      expect(load).not.toHaveBeenCalled();
      await rm(join(repository, path));
      await expect(
        launchStaraMcp({ env: { STARA_REPO_ROOT: repository }, version: pin, load }),
      ).rejects.toThrow(diagnostic);
    },
  );

  it('propagates a failed import to the CLI error boundary', async () => {
    const repository = await fixture();
    await expect(
      launchStaraMcp({
        env: { STARA_REPO_ROOT: repository },
        version: pin,
        load: async () => {
          throw new Error('synthetic-secret');
        },
      }),
    ).rejects.toThrow(diagnostic);
  });
});

describe('Stara plugin packaged stdio journey', () => {
  let Client;
  let StdioClientTransport;
  let createServer;

  beforeAll(async () => {
    await promisify(execFile)(
      process.execPath,
      [apiRequire.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
      { cwd: apiRoot, timeout: 30000, windowsHide: true },
    );
    ({ Client } = await import(
      pathToFileURL(apiRequire.resolve('@modelcontextprotocol/sdk/client/index.js')).href
    ));
    ({ StdioClientTransport } = await import(
      pathToFileURL(apiRequire.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
    ));
    ({ createServer } = await import(pathToFileURL(join(apiRoot, 'dist/server.js')).href));
  });

  it('declares one stdio server using the packaged launcher and a supported manifest', async () => {
    const manifest = JSON.parse(await readFile(join(plugin, 'plugin.json'), 'utf8'));
    const compatibility = JSON.parse(
      await readFile(join(plugin, '.codex-plugin/plugin.json'), 'utf8'),
    );
    const mcp = JSON.parse(await readFile(join(plugin, 'mcp.json'), 'utf8'));
    expect(manifest.name).toBe('stara');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(compatibility.name).toBe(manifest.name);
    expect(compatibility.version).toBe(manifest.version);
    expect(compatibility.mcpServers).toBeUndefined();
    await expect(access(join(plugin, '.mcp.json'))).rejects.toThrow();
    expect(Object.keys(mcp.mcpServers)).toEqual(['stara']);
    expect(mcp.mcpServers.stara.type).toBe('stdio');
    expect(mcp.mcpServers.stara.command).toBe('node');
    expect(mcp.mcpServers.stara.args).toEqual(['${PLUGIN_ROOT}/scripts/mcp.mjs']);
    expect(mcp.mcpServers.stara.env).toEqual({
      STARA_REPO_ROOT: '',
      STARA_API_URL: 'http://127.0.0.1:3000',
    });
    expect(mcp.mcpServers.stara.env_vars).toBeUndefined();
    expect(mcp.mcpServers.stara.url).toBeUndefined();
    expect(JSON.parse(await readFile(join(plugin, 'checkout.json'), 'utf8'))).toEqual({
      repoRoot: '',
    });
  });

  it('starts from a relocated plugin, calls exactly the two real local tools, and reports unavailable API', async () => {
    const directory = await temporary(join(root, '.artifacts'));
    const cachedPlugin = join(directory, 'cache with spaces # plugin');
    const api = createServer({
      logStream: new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    });
    cleanups.push(() => api.close());
    const origin = await api.listen({ host: '127.0.0.1', port: 0 });
    const destination = join(directory, 'prepared');
    await configureStaraPlugin({ repoRoot: root, destination, apiOrigin: origin });
    await cp(join(destination, 'plugins/stara'), cachedPlugin, { recursive: true });
    const mcp = JSON.parse(await readFile(join(cachedPlugin, 'mcp.json'), 'utf8'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: mcp.mcpServers.stara.args.map((arg) => arg.replace('${PLUGIN_ROOT}', cachedPlugin)),
      cwd: directory,
      env: mcp.mcpServers.stara.env,
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const client = new Client({ name: 'stara-plugin-synthetic-test', version: '0.0.0' });
    cleanups.push(() => client.close());
    const errors = [];
    client.onerror = (error) => errors.push(error);
    await client.connect(transport);
    expect(client.getServerVersion()).toEqual({ name: 'stara', version: '0.0.0' });
    expect((await client.listTools()).tools.map(({ name }) => name).sort()).toEqual([
      'stara_get_health',
      'stara_get_runtime_config',
    ]);
    expect((await client.callTool({ name: 'stara_get_health' })).structuredContent).toEqual({
      status: 'ok',
    });
    expect(
      (await client.callTool({ name: 'stara_get_runtime_config', arguments: {} }))
        .structuredContent,
    ).toEqual({ schemaVersion: 1, environment: 'development' });
    await api.close();
    for (const name of ['stara_get_health', 'stara_get_runtime_config']) {
      const result = await client.callTool({ name });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(origin);
    }
    expect(errors).toEqual([]);
    expect(stderr).toBe('');
  });

  it.each([
    'missing',
    'relative',
    'wrong-root',
    'missing-build',
    'node-pin',
    'import-failure',
    'invalid-api',
    'eof',
  ])('closes stdio with bounded sanitized behavior for %s', async (scenario) => {
    const env = { ...process.env, STARA_API_URL: 'http://127.0.0.1:3000' };
    delete env.STARA_REPO_ROOT;
    if (scenario === 'relative') env.STARA_REPO_ROOT = 'synthetic-secret';
    if (scenario === 'wrong-root')
      env.STARA_REPO_ROOT = await fixture({ name: 'synthetic-secret' });
    if (scenario === 'missing-build') env.STARA_REPO_ROOT = await fixture({ missingBuild: true });
    if (scenario === 'node-pin') env.STARA_REPO_ROOT = await fixture({ pin: '0.0.0' });
    if (scenario === 'import-failure') {
      env.STARA_REPO_ROOT = await fixture();
      await writeFile(
        join(env.STARA_REPO_ROOT, 'backend/api/dist/mcp/index.js'),
        "throw new Error('synthetic-secret');\n",
      );
    }
    if (scenario === 'invalid-api' || scenario === 'eof') env.STARA_REPO_ROOT = root;
    if (scenario === 'invalid-api') env.STARA_API_URL = 'https://synthetic-secret.invalid';
    const bindingRoot =
      env.STARA_REPO_ROOT && isAbsolute(env.STARA_REPO_ROOT)
        ? env.STARA_REPO_ROOT
        : await fixture();
    const boundPlugin = await boundPluginFor(bindingRoot);
    const result = spawnSync(process.execPath, [join(boundPlugin, 'scripts/mcp.mjs')], {
      cwd: root,
      env,
      input: '',
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(scenario === 'eof' ? 0 : 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('synthetic-secret');
    if (scenario === 'eof') expect(result.stderr).toBe('');
    else if (scenario === 'invalid-api') {
      expect(result.stderr).toBe(
        'Stara MCP startup failed. Check STARA_API_URL and the stdio transport.\n',
      );
    } else expect(result.stderr).toBe(`${diagnostic}\n`);
  });
});
