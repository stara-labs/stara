import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../src/mcp/server.js');
  vi.doUnmock('@modelcontextprotocol/sdk/server/stdio.js');
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('connects the MCP entrypoint to stdio without logging on stdout', async () => {
  vi.stubEnv('STARA_API_URL', 'http://127.0.0.1:4567');
  const connect = vi.fn().mockResolvedValue(undefined);
  const createMcpServer = vi.fn(() => ({ connect }));
  vi.doMock('../../src/mcp/server.js', () => ({ createMcpServer }));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../../src/mcp/index.js');
  expect(createMcpServer).toHaveBeenCalledWith({ apiOrigin: 'http://127.0.0.1:4567' });
  expect(connect).toHaveBeenCalledOnce();
  expect(log).not.toHaveBeenCalled();
});

it('reports connection failures on stderr with a nonzero exit code', async () => {
  const previousExitCode = process.exitCode;
  vi.stubEnv('STARA_API_URL', 'http://127.0.0.1:3000');
  vi.doMock('../../src/mcp/server.js', () => ({
    createMcpServer: () => ({ connect: vi.fn().mockRejectedValue(new Error('synthetic-secret')) }),
  }));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await import('../../src/mcp/index.js');
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      'Stara MCP startup failed. Check STARA_API_URL and the stdio transport.',
    );
  } finally {
    process.exitCode = previousExitCode;
  }
});
