import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMcpConfig } from '../../src/mcp/config.js';
import { createMcpServer } from '../../src/mcp/server.js';

describe('MCP local API configuration', () => {
  it('defaults to the local Stara API', () => {
    expect(readMcpConfig({})).toBe('http://127.0.0.1:3000');
  });

  it.each(['http://127.0.0.1:4321', 'http://[::1]:4321/'])(
    'accepts an explicit loopback origin %s',
    (url) => expect(readMcpConfig({ STARA_API_URL: url })).toBe(new URL(url).origin),
  );

  it.each([
    '',
    'invalid',
    'https://example.com',
    'http://0.0.0.0:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3000/api',
    'http://user:synthetic-password@127.0.0.1:3000',
    'http://127.0.0.1:3000/?token=synthetic-secret',
    'http://127.0.0.1:3000/#fragment',
    ' http://127.0.0.1:3000',
  ])('rejects unsupported origins without echoing input: %s', (url) => {
    expect(() => readMcpConfig({ STARA_API_URL: url })).toThrow(
      'STARA_API_URL must be an HTTP loopback origin with no credentials, path, query, or fragment',
    );
  });
});

describe('MCP protocol tools', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  async function connect(fetcher: typeof fetch = vi.fn()) {
    const server = createMcpServer({ apiOrigin: 'http://127.0.0.1:3000', fetcher });
    const client = new Client({ name: 'stara-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    closers.push(
      () => client.close(),
      () => server.close(),
    );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  it('advertises only the two implemented, read-only API tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'stara_get_health',
      'stara_get_runtime_config',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.inputSchema).toMatchObject({ type: 'object', properties: {} });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it.each([
    ['stara_get_health', '/api/health', { status: 'ok' }],
    [
      'stara_get_runtime_config',
      '/api/runtime-config',
      { schemaVersion: 1, environment: 'development' },
    ],
    [
      'stara_get_runtime_config',
      '/api/runtime-config',
      { schemaVersion: 1, environment: 'staging' },
    ],
  ] as const)('reads and allowlists %s results', async (name, path, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ...expected, privateField: 'synthetic-secret' }));
    const client = await connect(fetcher);
    const result = await client.callTool({ name, arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(expected) }]);
    expect(fetcher).toHaveBeenCalledWith(
      `http://127.0.0.1:3000${path}`,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ['HTTP error', () => Promise.resolve(new Response('synthetic-secret', { status: 500 }))],
    ['invalid JSON', () => Promise.resolve(new Response('synthetic-secret'))],
    ['invalid schema', () => Promise.resolve(Response.json({ status: 'synthetic-secret' }))],
    ['connection failure', () => Promise.reject(new Error('synthetic-secret'))],
    ['timeout', () => Promise.reject(new DOMException('synthetic-secret', 'TimeoutError'))],
  ] as const)('reports sanitized tool errors for %s', async (_name, fetcher) => {
    const client = await connect(fetcher);
    const result = await client.callTool({ name: 'stara_get_health' });
    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Stara API request failed. Check the local API is running and returns the expected response.',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('rejects unsupported runtime environments', async () => {
    const client = await connect(async () =>
      Response.json({ schemaVersion: 1, environment: 'production' }),
    );
    expect((await client.callTool({ name: 'stara_get_runtime_config' })).isError).toBe(true);
  });

  it('rejects tool arguments instead of accepting arbitrary request targets', async () => {
    const fetcher = vi.fn();
    const client = await connect(fetcher);
    const result = await client.callTool({
      name: 'stara_get_health',
      arguments: { url: 'https://example.com' },
    });
    expect(result.isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not dispatch unknown tools', async () => {
    const fetcher = vi.fn();
    const client = await connect(fetcher);
    expect((await client.callTool({ name: 'stara_execute_agent' })).isError).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
