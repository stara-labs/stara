import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readMcpConfig } from './config.js';

const healthSchema = z.object({ status: z.literal('ok') });
const runtimeSchema = z.object({
  schemaVersion: z.literal(1),
  environment: z.enum(['development', 'staging']),
});

export function createMcpServer(options: { apiOrigin: string; fetcher?: typeof fetch }) {
  const origin = readMcpConfig({ STARA_API_URL: options.apiOrigin });
  const fetcher = options.fetcher ?? fetch;
  const server = new McpServer(
    { name: 'stara', version: '0.0.0' },
    {
      instructions:
        'Stara scaffold: tools read local service availability and public runtime configuration. Work items, conversations, persistence, and agent execution are not available through this server.',
    },
  );

  async function readApi(
    path: string,
    schema: typeof healthSchema | typeof runtimeSchema,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    try {
      const response = await fetcher(`${origin}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error();
      // Zod's object parser retains only the public response fields.
      const result = schema.parse(await response.json());
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Stara API request failed. Check the local API is running and returns the expected response.',
          },
        ],
      };
    }
  }

  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    'stara_get_health',
    {
      title: 'Get Stara service health',
      description:
        'Check whether the local Stara HTTP service can answer requests. This does not establish product health or dependency readiness.',
      inputSchema: z.strictObject({}).default({}),
      outputSchema: healthSchema,
      annotations,
    },
    (_args, extra) => readApi('/api/health', healthSchema, extra.signal),
  );
  server.registerTool(
    'stara_get_runtime_config',
    {
      title: 'Get Stara public runtime configuration',
      description:
        'Read the local Stara API schema version and environment (development or staging). Contains no credentials or private operational configuration.',
      inputSchema: z.strictObject({}).default({}),
      outputSchema: runtimeSchema,
      annotations,
    },
    (_args, extra) => readApi('/api/runtime-config', runtimeSchema, extra.signal),
  );
  return server;
}
