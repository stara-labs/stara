import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin, ViteDevServer } from 'vite';
import { loadConfigFromFile } from 'vite';
import { describe, expect, it, vi } from 'vitest';

const config = (await loadConfigFromFile(
  { command: 'serve', mode: 'test' },
  resolve('vite.config.ts'),
  undefined,
  'silent',
  undefined,
  'native',
))!.config;
const requireUi = createRequire(resolve('../shared/package.json'));
const license = readFileSync(
  join(dirname(requireUi.resolve('@fontsource-variable/inter/package.json')), 'LICENSE'),
  'utf8',
);
const plugin = (config.plugins as Plugin[]).find((entry) => entry.name === 'inter-license')!;

function request(url: string, method = 'GET') {
  const use = vi.fn();
  expect(plugin.configureServer).toBeTypeOf('function');
  const configure = plugin.configureServer as (server: ViteDevServer) => void;
  configure({ middlewares: { use } } as unknown as ViteDevServer);
  const middleware = use.mock.calls[0][0] as Connect.NextHandleFunction;
  const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
  const next = vi.fn();
  middleware({ url, method } as IncomingMessage, response as unknown as ServerResponse, next);
  return { response, next };
}

describe('UI-LICENSE-01 public dependency license', () => {
  it('serves the exact dependency license as plain text during development', () => {
    for (const url of ['/licenses/Inter-OFL.txt', '/licenses/Inter-OFL.txt?download=1']) {
      const { response, next } = request(url);
      expect(next).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(200);
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
      expect(response.end).toHaveBeenCalledWith(license);
    }
  });

  it('supports HEAD without a body and leaves other paths and methods untouched', () => {
    const { response, next } = request('/licenses/Inter-OFL.txt', 'HEAD');
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.end).toHaveBeenCalledWith(undefined);
    for (const [url, method] of [
      ['/licenses/Inter-OFL.txt/other', 'GET'],
      ['/licenses/another.txt', 'GET'],
      ['/api/health', 'GET'],
      ['/licenses/Inter-OFL.txt', 'POST'],
    ]) {
      const result = request(url, method);
      expect(result.next).toHaveBeenCalledOnce();
      expect(result.response.end).not.toHaveBeenCalled();
    }
  });

  it('continues to emit the same license in the production build', () => {
    const emitFile = vi.fn();
    const generate = plugin.generateBundle as unknown as (this: {
      emitFile: typeof emitFile;
    }) => void;
    generate.call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'licenses/Inter-OFL.txt',
      source: license,
    });
  });
});
