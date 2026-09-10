import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { connect, createServer as createNetServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sendSignal } from '../helpers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const cleanup: (() => Promise<unknown>)[] = [];
const body = JSON.stringify({ simulated: 'unfinished request body' });

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

function bounded<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
      milliseconds,
    );
    void promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function launch() {
  const reservation = createNetServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(process.execPath, ['tests/fixtures/localhost-process.mjs'], {
    cwd: root,
    env: { ...process.env, HOST: 'localhost', PORT: String(port) },
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
    child.once('exit', resolve);
    child.once('error', reject);
  });
  const messages = new Map<string, unknown>();
  const listeners = new Map<string, (message: unknown) => void>();
  child.on('message', (message: { event: string }) => {
    messages.set(message.event, message);
    listeners.get(message.event)?.(message);
  });
  function message<T>(event: string): Promise<T> {
    return bounded(
      new Promise<T>((resolve, reject) => {
        if (messages.has(event)) resolve(messages.get(event) as T);
        else listeners.set(event, (value) => resolve(value as T));
        void exited.then(
          () => reject(new Error(`Process exited before ${event}: ${output}`)),
          reject,
        );
      }),
      3000,
      event,
    );
  }
  const sockets: Socket[] = [];
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    if (child.exitCode === null) child.kill();
    await bounded(exited, 3000, 'test process cleanup');
  });
  const ready = await message<{ primary: AddressInfo; addresses: AddressInfo[] }>('ready');
  expect(ready.addresses.map((address) => address.address).sort()).toEqual(['127.0.0.1', '::1']);
  const secondary = ready.addresses.find((address) => address.address !== ready.primary.address)!;

  async function open(listener: 'primary' | 'secondary', incompleteRequest = true) {
    const address = listener === 'primary' ? ready.primary : secondary;
    const socket = connect({ host: address.address, port });
    sockets.push(socket);
    let response = '';
    socket.on('data', (chunk) => {
      response += String(chunk);
    });
    // Connection resets are expected when the deadline terminates the child process.
    socket.on('error', () => {});
    await once(socket, 'connect');
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
    });
    if (incompleteRequest) {
      socket.write(
        `POST /api/health HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, -1)}`,
      );
      await message('request_started');
    }
    return { socket, closed, response: () => response };
  }
  return { child, exited, open, output: () => output };
}

describe.each(['primary', 'secondary'] as const)('localhost %s listener shutdown', (listener) => {
  it('drains an accepted request before logging success and exiting zero', async () => {
    const app = await launch();
    const client = await app.open(listener);
    sendSignal(app.child, 'SIGTERM');
    await delay(150);
    expect(app.output()).not.toContain('shutdown_complete');
    expect(app.child.exitCode).toBeNull();
    client.socket.write(body.slice(-1));
    expect(await bounded(app.exited, 3000, 'graceful drain')).toBe(0);
    await bounded(client.closed, 1000, 'client close');
    expect(client.response()).toContain('HTTP/1.1 404');
    expect(client.response()).toContain('{"error":"Not Found"}');
    expect(app.output()).toContain('shutdown_complete');
    expect(app.output()).not.toContain('shutdown_timeout');
  });

  it('exits nonzero within the bound when an accepted request never completes', async () => {
    const app = await launch();
    const client = await app.open(listener);
    const started = performance.now();
    sendSignal(app.child, 'SIGTERM');
    expect(await bounded(app.exited, 7000, 'five-second shutdown')).toBe(1);
    expect(performance.now() - started).toBeLessThan(7000);
    await bounded(client.closed, 1000, 'forced client close');
    expect(app.output()).toContain('shutdown_timeout');
    expect(app.output()).not.toContain('shutdown_complete');
  });

  it('finishes draining when the client abandons its accepted request', async () => {
    const app = await launch();
    const client = await app.open(listener);
    sendSignal(app.child, 'SIGINT');
    client.socket.destroy();
    expect(await bounded(app.exited, 3000, 'aborted request cleanup')).toBe(0);
    expect(app.output()).toContain('shutdown_complete');
    expect(app.output()).not.toContain('shutdown_timeout');
  });

  it('cleans up an idle connection without waiting for the request timeout', async () => {
    const app = await launch();
    const client = await app.open(listener, false);
    sendSignal(app.child, 'SIGTERM');
    expect(await bounded(app.exited, 3000, 'idle connection cleanup')).toBe(0);
    await bounded(client.closed, 1000, 'idle client close');
    expect(app.output()).toContain('shutdown_complete');
  });
});
