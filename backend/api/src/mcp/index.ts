import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readMcpConfig } from './config.js';
import { createMcpServer } from './server.js';

try {
  const server = createMcpServer({ apiOrigin: readMcpConfig(process.env) });
  await server.connect(new StdioServerTransport());
} catch {
  // stdout belongs exclusively to MCP JSON-RPC.
  console.error('Stara MCP startup failed. Check STARA_API_URL and the stdio transport.');
  process.exitCode = 1;
}
