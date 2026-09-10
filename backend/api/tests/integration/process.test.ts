import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sendSignal } from '../helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const cleanup: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  await promisify(execFile)(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
    { cwd: root },
  );
});
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function availablePort() {
  const reservation = createNetServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function launch(env: NodeJS.ProcessEnv, mode = 'entrypoint') {
  const child = spawn(process.execPath, ['tests/fixtures/process.mjs', mode], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  let output = '';
  child.stdout!.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr!.on('data', (chunk) => {
    output += String(chunk);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', (code) => resolve(code));
    child.once('error', reject);
  });
  const ready = new Promise<void>((resolve) => {
    child.once('message', () => resolve());
  });
  cleanup.push(async () => {
    child.kill();
    await exited;
  });
  return { child, ready, exited, output: () => output };
}

describe('compiled executable process', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'serves HTTP and gracefully exits after the %s process event',
    async (signal) => {
      const port = await availablePort();
      const app = launch({ PORT: String(port) });
      await app.ready;
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('{"status":"ok"}');
      sendSignal(app.child, signal);
      expect(await app.exited).toBe(0);
      expect(app.output()).toContain('shutdown_complete');
      await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    },
  );

  it('exits nonzero for invalid startup configuration without exposing values', async () => {
    const app = launch({ HOST: 'synthetic-invalid-host/secret', PORT: '3000' });
    expect(await app.exited).toBe(1);
    expect(app.output()).toContain('startup_failed');
    expect(app.output()).not.toContain('synthetic-invalid-host');
  });

  it('forces a real process to exit within the shutdown deadline when a close hook stalls', async () => {
    const port = await availablePort();
    const app = launch({ PORT: String(port) }, 'stall-close');
    await app.ready;
    const started = performance.now();
    sendSignal(app.child, 'SIGTERM');
    expect(await app.exited).toBe(1);
    expect(performance.now() - started).toBeLessThan(8500);
    expect(app.output()).toContain('shutdown_timeout');
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  });
});
