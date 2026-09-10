import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../../src/server.js';
import { startMain } from '../../src/main.js';
import { captureLogs, simulatedProcess } from '../helpers.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe('real loopback network', () => {
  it('serves the exact health response over HTTP and releases the listener', async () => {
    const logs = captureLogs();
    const server = createServer({ logStream: logs.stream });
    cleanup.push(() => server.close());
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${address}/api/health`, {
      headers: {
        authorization: 'Bearer synthetic-network-secret',
        cookie: 'sid=synthetic-network-cookie',
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":"ok"}');
    expect(logs.text()).not.toContain('synthetic-network-');
    await server.close();
    await expect(fetch(`${address}/api/health`)).rejects.toThrow();
  });

  it('reports a real port collision and closes without leaked bind details', async () => {
    const occupied = createNetServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) =>
          occupied.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const logs = captureLogs();
    const server = createServer({ logStream: logs.stream });
    cleanup.push(() => server.close());
    const { runtime } = simulatedProcess();
    const port = (occupied.address() as AddressInfo).port;
    expect(
      await startMain({ server, runtime, env: { HOST: '127.0.0.1', PORT: String(port) } }),
    ).toBeUndefined();
    expect(runtime.setExitCode).toHaveBeenCalledWith(1);
    expect(server.server.listening).toBe(false);
    expect(logs.text()).toContain('startup_failed');
    expect(logs.text()).not.toContain('EADDRINUSE');
  });

  it('wires the default process runtime and drains an in-flight HTTP request', async () => {
    const server = createServer();
    let release!: () => void;
    let arrived!: () => void;
    const requestArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const responseReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.get('/simulated-slow', async () => {
      arrived();
      await responseReady;
      return { completed: true };
    });
    const listen = server.listen.bind(server);
    vi.spyOn(server, 'listen').mockImplementation(() => listen({ host: '127.0.0.1', port: 0 }));
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
    const running = await startMain({ server, env: {} });
    cleanup.push(() => running!.shutdown());
    const address = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
    const response = fetch(`${address}/simulated-slow`);
    await requestArrived;
    expect(process.listenerCount('SIGINT')).toBe(before.int + 1);
    const closing = running!.shutdown();
    release();
    expect(await (await response).json()).toEqual({ completed: true });
    await closing;
    expect(server.server.listening).toBe(false);
    expect(process.listenerCount('SIGINT')).toBe(before.int);
    expect(process.listenerCount('SIGTERM')).toBe(before.term);
  });
});
