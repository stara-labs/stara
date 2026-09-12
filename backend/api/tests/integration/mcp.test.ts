import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createServer } from '../../src/server.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { captureLogs } from '../helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = fileURLToPath(new URL('../../dist/mcp/index.js', import.meta.url));
const require = createRequire(import.meta.url);
const cleanup: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  await promisify(execFile)(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
    { cwd: root },
  );
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it('runs a compiled MCP child against the real Stara HTTP API', async () => {
  const api = createServer({ logStream: captureLogs().stream });
  cleanup.push(() => api.close());
  const origin = await api.listen({ host: '127.0.0.1', port: 0 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint],
    env: { STARA_API_URL: origin },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr!.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: 'stara-integration', version: '0.0.0' });
  cleanup.push(() => client.close());
  const protocolErrors: Error[] = [];
  client.onerror = (error) => {
    protocolErrors.push(error);
  };
  await client.connect(transport);
  expect(client.getServerVersion()).toEqual({ name: 'stara', version: '0.0.0' });
  expect((await client.listTools()).tools).toHaveLength(2);
  expect((await client.callTool({ name: 'stara_get_health' })).structuredContent).toEqual({
    status: 'ok',
  });
  expect(
    (await client.callTool({ name: 'stara_get_runtime_config', arguments: {} })).structuredContent,
  ).toEqual({ schemaVersion: 1, environment: 'development' });
  await api.close();
  expect((await client.callTool({ name: 'stara_get_health' })).isError).toBe(true);
  expect(protocolErrors).toEqual([]);
  expect(stderr).toBe('');
});

it('uses the default HTTP adapter and rejects redirects without contacting their destination', async () => {
  const api = createServer({ logStream: captureLogs().stream });
  let redirectedRequests = 0;
  api.get('/redirect-target', async () => {
    redirectedRequests++;
    return { status: 'ok' };
  });
  api.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/health') await reply.redirect('/redirect-target');
  });
  cleanup.push(() => api.close());
  const origin = await api.listen({ host: '127.0.0.1', port: 0 });
  const server = createMcpServer({ apiOrigin: origin });
  cleanup.push(() => server.close());
  const client = new Client({ name: 'stara-integration', version: '0.0.0' });
  cleanup.push(() => client.close());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  expect((await client.callTool({ name: 'stara_get_health' })).isError).toBe(true);
  expect(redirectedRequests).toBe(0);
});

it.each([
  ['http://127.0.0.1:3000', 0, ''],
  ['http://example.com/?fixture=synthetic-secret', 1, 'Stara MCP startup failed.'],
] as const)(
  'exits with code %s after input closes or startup fails',
  async (origin, code, diagnostic) => {
    const child = spawn(process.execPath, [entrypoint], {
      env: { ...process.env, STARA_API_URL: origin },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const closed = once(child, 'close');
    cleanup.push(async () => {
      child.kill();
      await closed;
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.stdin.end();
    expect((await closed)[0]).toBe(code);
    expect(stdout).toBe('');
    expect(stderr).toContain(diagnostic);
    expect(stderr).not.toContain('synthetic-secret');
  },
);
