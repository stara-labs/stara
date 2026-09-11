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

async function availablePort() {
  const reservation = createNetServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

describe('REL-09/10 real runtime HTTP and startup boundary', () => {
  it.each(['development', 'staging'] as const)(
    'startup serves only %s runtime configuration and unchanged health',
    async (environment) => {
      const port = await availablePort();
      const { runtime } = simulatedProcess();
      const app = await startMain({
        runtime,
        env: {
          HOST: '127.0.0.1',
          PORT: String(port),
          STARA_ENVIRONMENT: environment,
          SECRET: 'synthetic-runtime-private-canary',
          PROJECT_ID: 'synthetic-private-project',
        },
      });
      expect(app).toBeDefined();
      cleanup.push(() => app!.shutdown());
      const origin = `http://127.0.0.1:${port}`;
      const response = await fetch(`${origin}/api/runtime-config`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.json()).toEqual({ schemaVersion: 1, environment });
      const health = await fetch(`${origin}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe('{"status":"ok"}');
    },
  );

  it('default direct server renders development and excludes runtime input extras', async () => {
    const logs = captureLogs();
    const server = createServer({ logStream: logs.stream });
    cleanup.push(() => server.close());
    const response = await server.inject({
      method: 'GET',
      url: '/api/runtime-config?token=synthetic-runtime-private-canary',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: 1, environment: 'development' });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(logs.text()).not.toContain('synthetic-runtime-private-canary');
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const other = await server.inject({ method, url: '/api/runtime-config' });
      expect(other.statusCode).toBe(404);
    }
  });

  it('response serialization cannot expose extra fields passed with validated runtime config', async () => {
    const logs = captureLogs();
    const runtimeConfig = {
      schemaVersion: 1 as const,
      environment: 'staging' as const,
      secret: 'synthetic-runtime-private-canary',
    };
    const server = createServer({ logStream: logs.stream, ...{ runtimeConfig } });
    cleanup.push(() => server.close());
    const response = await server.inject('/api/runtime-config');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ schemaVersion: 1, environment: 'staging' });
    expect(response.body + logs.text()).not.toContain('synthetic-runtime-private-canary');
  });

  it.each(['production', '', 'synthetic-runtime-private-canary'])(
    'invalid startup case %# opens no listener and emits only sanitized failure',
    async (value) => {
      const logs = captureLogs();
      const server = createServer({ logStream: logs.stream });
      cleanup.push(() => server.close());
      const listen = vi.spyOn(server, 'listen');
      const { runtime } = simulatedProcess();
      const app = await startMain({
        server,
        runtime,
        env: { STARA_ENVIRONMENT: value, PORT: String(await availablePort()) },
      });
      if (app) cleanup.push(() => app.shutdown());
      expect(app).toBeUndefined();
      expect(listen).not.toHaveBeenCalled();
      expect(server.server.listening).toBe(false);
      expect(runtime.setExitCode).toHaveBeenCalledWith(1);
      expect(logs.text()).toContain('startup_failed');
      expect(logs.text()).not.toContain('synthetic-runtime-private-canary');
    },
  );
});
