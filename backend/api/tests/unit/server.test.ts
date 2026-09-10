import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../src/server.js';
import { captureLogs } from '../helpers.js';

const servers: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function setup() {
  const logs = captureLogs();
  const server = createServer({ logStream: logs.stream });
  servers.push(server);
  return { server, logs };
}

describe('health-only HTTP contract', () => {
  it('returns exactly the approved response', async () => {
    const { server } = setup();
    const response = await server.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toBe('{"status":"ok"}');
  });

  it.each(['/', '/health', '/api/ready', '/api/health/'])(
    'does not expose another endpoint at %s',
    async (url) => {
      const { server } = setup();
      const response = await server.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'Not Found' });
    },
  );

  it.each(['POST', 'PUT', 'DELETE', 'HEAD'] as const)(
    'does not expose %s health',
    async (method) => {
      const { server } = setup();
      expect((await server.inject({ method, url: '/api/health' })).statusCode).toBe(404);
    },
  );

  it('does not reflect untrusted URLs in not-found responses or logs', async () => {
    const { server, logs } = setup();
    const response = await server.inject('/synthetic-path-secret?token=synthetic-query-secret');
    expect(response.body + logs.text()).not.toContain('synthetic-');
    expect(logs.records().length).toBeGreaterThan(0);
  });

  it('omits request secrets and sanitizes explicit error logs', async () => {
    const { server, logs } = setup();
    await server.inject({
      url: '/api/health?token=synthetic-query-secret',
      headers: {
        authorization: 'Bearer synthetic-auth-secret',
        cookie: 'sid=synthetic-cookie-secret',
        'x-request-id': 'synthetic-request-id-secret',
      },
    });
    server.log.error(
      {
        err: new Error('synthetic-error-secret'),
        headers: { authorization: 'synthetic-header-secret', cookie: 'synthetic-cookie-secret' },
      },
      'simulated failure',
    );
    expect(logs.text()).not.toContain('synthetic-');
    expect(logs.text()).toContain('[Redacted]');
    expect(
      logs
        .records()
        .every((record) => typeof record.level === 'number' && typeof record.msg === 'string'),
    ).toBe(true);
  });

  it.each([undefined, 400, 418, 499, 500, 302, 700, 401.5])(
    'sanitizes thrown errors with status %s',
    async (statusCode) => {
      const { server, logs } = setup();
      server.get('/simulated-failure', async () => {
        throw Object.assign(new Error('synthetic-stack-secret'), { statusCode });
      });
      const response = await server.inject('/simulated-failure');
      const clientError =
        Number.isInteger(statusCode) && Number(statusCode) >= 400 && Number(statusCode) < 500;
      expect(response.statusCode).toBe(clientError ? statusCode : 500);
      expect(response.json()).toEqual({
        error: clientError ? 'Request failed' : 'Internal Server Error',
      });
      expect(response.body + logs.text()).not.toContain('synthetic-stack-secret');
    },
  );

  it('sanitizes invalid URL errors', async () => {
    const { server, logs } = setup();
    const response = await server.inject('/%zz-synthetic-url-secret');
    expect(response.statusCode).toBe(400);
    expect(response.body + logs.text()).not.toContain('synthetic-url-secret');
  });

  it('sanitizes JSON parser failures', async () => {
    const { server, logs } = setup();
    server.post('/simulated-json', async () => ({ accepted: true }));
    const response = await server.inject({
      method: 'POST',
      url: '/simulated-json',
      headers: { 'content-type': 'application/json' },
      payload: '{"synthetic-body-secret"',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Request failed' });
    expect(response.body + logs.text()).not.toContain('synthetic-body-secret');
  });
});
