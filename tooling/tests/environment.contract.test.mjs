import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupFixtures, passed, workspace, write } from './fixtures.mjs';

let control;
let createRuntime;
beforeAll(async () => {
  const workspaceUrl = new URL('../lib/workspace.mjs', import.meta.url);
  const processUrl = new URL('../lib/process.mjs', import.meta.url);
  control = await import(/* @vite-ignore */ workspaceUrl.href);
  ({ createRuntime } = await import(/* @vite-ignore */ processUrl.href));
});
afterEach(cleanupFixtures);

function options(root, overrides = {}) {
  const env = overrides.env ?? { STARA_SENTINEL: 'preserve' };
  return {
    root,
    node: process.execPath,
    pnpmPath: '/synthetic/pnpm.mjs',
    env,
    run: vi.fn(async (_command, args) =>
      passed(
        args.includes('config')
          ? JSON.stringify(validCompose(env))
          : args.includes('--version')
            ? '11.19.0'
            : '',
      ),
    ),
    output: vi.fn(),
    fetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok' }) })),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

function validCompose(env = {}) {
  return {
    services: {
      web: {
        ports: [
          { host_ip: '127.0.0.1', target: 5173, published: Number(env.STARA_WEB_PORT ?? 5173) },
        ],
      },
      api: {
        ports: [
          { host_ip: '127.0.0.1', target: 3000, published: Number(env.STARA_API_PORT ?? 3000) },
        ],
      },
    },
  };
}

describe('composeSettings: deterministic checkout scope and validated local ports', () => {
  it('pins defaults and derives the Compose name from the canonical root', async () => {
    const root = await workspace();
    const project = `stara-${createHash('sha256')
      .update(await realpath(root))
      .digest('hex')
      .slice(0, 12)}`;
    expect(control.composeSettings(root, {})).toEqual({ project, webPort: 5173, apiPort: 3000 });
  });

  it('gives independent checkouts independent Compose project names', async () => {
    const first = await workspace();
    const second = await workspace();
    expect(control.composeSettings(first, {}).project).not.toBe(
      control.composeSettings(second, {}).project,
    );
  });

  it('accepts distinct explicit ports at valid bounds and does not mutate the environment', async () => {
    const root = await workspace();
    const env = { STARA_WEB_PORT: '1', STARA_API_PORT: '65535', STARA_SENTINEL: 'keep' };
    expect(control.composeSettings(root, env)).toMatchObject({ webPort: 1, apiPort: 65535 });
    expect(env).toEqual({ STARA_WEB_PORT: '1', STARA_API_PORT: '65535', STARA_SENTINEL: 'keep' });
  });

  for (const name of ['STARA_WEB_PORT', 'STARA_API_PORT']) {
    it.each(['0', '65536', '-1', '1.5', 'not-a-port', '', 'Infinity'])(
      `rejects invalid ${name}=%j`,
      async (value) => {
        const root = await workspace();
        expect(() => control.composeSettings(root, { [name]: value })).toThrow();
      },
    );
  }

  it('rejects identical web and API ports before starting anything', async () => {
    const root = await workspace();
    expect(() =>
      control.composeSettings(root, { STARA_WEB_PORT: '4000', STARA_API_PORT: '4000' }),
    ).toThrow();
  });
});

describe('environment lifecycle: local, scoped, bounded and non-destructive', () => {
  it('preserves a bounded sanitized Docker startup cause in its actionable error', async () => {
    const root = await workspace();
    const secret = 'synthetic-startup-private-value';
    const state = options(root, {
      env: { STARA_SECRET: secret },
      run: vi.fn(async (_command, args) => {
        if (args.includes('config')) return passed(JSON.stringify(validCompose()));
        if (args.includes('up'))
          throw new Error(
            `Docker web build timed out while resolving base image; STARA_SECRET=${secret}; ${'x'.repeat(12_000)}`,
          );
        return passed();
      }),
    });
    let error;
    try {
      await control.environment(createRuntime(state), 'start');
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/web build timed out while resolving base image/);
    expect(error.message).not.toContain(secret);
    expect(error.message.length).toBeLessThanOrEqual(4096);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.run.mock.calls.flatMap(([, args]) => args)).not.toContain('down');
  });

  it.each(['start', 'dev'])(
    'starts %s with explicit project scope and announces only local readiness',
    async (mode) => {
      const root = await workspace();
      const state = options(root, {
        env: { STARA_WEB_PORT: '55173', STARA_API_PORT: '53000', STARA_SENTINEL: 'keep' },
      });
      await control.environment(createRuntime(state), mode);
      const calls = state.run.mock.calls;
      const compose = calls.filter(
        ([command, args]) => command === 'docker' && args.includes('compose'),
      );
      expect(compose.length).toBeGreaterThan(0);
      for (const [, args, runOptions] of compose) {
        expect(args).toContain('--project-name');
        expect(args).toContain(control.composeSettings(root, state.env).project);
        expect(runOptions.cwd).toBe(root);
        expect(runOptions.timeout).toBeGreaterThan(0);
        expect(Number.isFinite(runOptions.timeout)).toBe(true);
      }
      expect(compose.some(([, args]) => args.includes('up'))).toBe(true);
      expect(state.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
      const endpoints = state.fetch.mock.calls.map(([url]) => new URL(url));
      expect(endpoints.every((url) => ['127.0.0.1', 'localhost'].includes(url.hostname))).toBe(
        true,
      );
      expect(endpoints.some((url) => url.port === '53000' && url.pathname === '/api/health')).toBe(
        true,
      );
      expect(endpoints.some((url) => url.port === '55173')).toBe(true);
      expect(state.output.mock.calls.flat().join(' ')).toContain('55173');
      expect(state.env).toEqual({
        STARA_WEB_PORT: '55173',
        STARA_API_PORT: '53000',
        STARA_SENTINEL: 'keep',
      });
      expect(calls.flatMap(([, args]) => args)).not.toContain('--volumes');
    },
  );

  it.each(['down', 'logs'])(
    'runs scoped %s without startup, readiness probing, or volume deletion',
    async (mode) => {
      const root = await workspace();
      const state = options(root);
      await control.environment(createRuntime(state), mode);
      const docker = state.run.mock.calls.filter(([command]) => command === 'docker');
      expect(docker.some(([, args]) => args.includes(mode))).toBe(true);
      for (const [, args] of docker.filter(([, args]) => args.includes('compose'))) {
        expect(args).toContain('--project-name');
        expect(args).toContain(control.composeSettings(root, state.env).project);
        expect(args).not.toContain('--volumes');
        expect(args).not.toContain('-v');
        expect(args).not.toContain('prune');
        expect(args).not.toContain('up');
      }
      expect(state.fetch).not.toHaveBeenCalled();
    },
  );

  it('does not fall back to another port or delete data after an occupied-port failure', async () => {
    const root = await workspace();
    const state = options(root, {
      run: vi.fn(async (_command, args) => {
        if (args.includes('up')) throw new Error('synthetic occupied port 5173');
        if (args.includes('config')) return passed(JSON.stringify(validCompose()));
        return passed();
      }),
    });
    await write(root, 'sentinel-local-data.txt', 'preserve local data');
    await expect(control.environment(createRuntime(state), 'start')).rejects.toThrow(
      /occupied.*port/,
    );
    expect(await readFile(`${root}/sentinel-local-data.txt`, 'utf8')).toBe('preserve local data');
    expect(state.run.mock.calls.filter(([, args]) => args.includes('up'))).toHaveLength(1);
    expect(state.run.mock.calls.flatMap(([, args]) => args)).not.toContain('down');
    expect(state.output.mock.calls.flat().join(' ')).not.toMatch(/https?:\/\//);
  });

  it('reports missing Docker explicitly without false readiness URLs', async () => {
    const root = await workspace();
    const state = options(root, {
      run: vi.fn(async () => {
        throw new Error('synthetic Docker unavailable');
      }),
    });
    await expect(control.environment(createRuntime(state), 'start')).rejects.toThrow(
      /Docker unavailable/,
    );
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.output.mock.calls.flat().join(' ')).not.toMatch(/https?:\/\//);
  });

  it('fails readiness after a bounded number of attempts without publishing success URLs', async () => {
    const root = await workspace();
    const state = options(root, {
      fetch: vi.fn(async () => {
        throw new Error('synthetic not ready');
      }),
    });
    await expect(control.environment(createRuntime(state), 'start')).rejects.toThrow(
      /ready|readiness|health|timeout/i,
    );
    expect(state.fetch.mock.calls.length).toBeGreaterThan(0);
    expect(state.fetch.mock.calls.length).toBeLessThanOrEqual(120);
    expect(state.sleep.mock.calls.length).toBeLessThanOrEqual(60);
    expect(state.output.mock.calls.flat().join(' ')).not.toMatch(/https?:\/\//);
  });

  it('does not accept a non-OK HTTP response as readiness', async () => {
    const root = await workspace();
    const state = options(root, { fetch: vi.fn(async () => ({ ok: false, status: 503 })) });
    await expect(control.environment(createRuntime(state), 'start')).rejects.toThrow();
    expect(state.output.mock.calls.flat().join(' ')).not.toMatch(/https?:\/\//);
  });

  it('rejects an unknown environment mode before process effects', async () => {
    const root = await workspace();
    const state = options(root);
    await expect(control.environment(createRuntime(state), 'destroy-everything')).rejects.toThrow();
    expect(state.run).not.toHaveBeenCalled();
  });

  it.each([
    'missing-service',
    'public-binding',
    'wrong-target',
    'wrong-published',
    'container-name',
    'host-network',
    'external-network',
    'external-volume',
  ])('rejects unsafe Compose config: %s before starting services', async (mutation) => {
    const root = await workspace();
    const config = validCompose();
    if (mutation === 'missing-service') delete config.services.web;
    if (mutation === 'public-binding') config.services.web.ports[0].host_ip = '0.0.0.0';
    if (mutation === 'wrong-target') config.services.api.ports[0].target = 5432;
    if (mutation === 'wrong-published') config.services.web.ports[0].published = 5174;
    if (mutation === 'container-name') config.services.web.container_name = 'unrelated';
    if (mutation === 'host-network') config.services.api.network_mode = 'host';
    if (mutation === 'external-network') config.networks = { shared: { external: true } };
    if (mutation === 'external-volume') config.volumes = { shared: { external: true } };
    const state = options(root, {
      run: vi.fn(async (_command, args) =>
        passed(args.includes('config') ? JSON.stringify(config) : ''),
      ),
    });
    await expect(control.environment(createRuntime(state), 'start')).rejects.toThrow();
    expect(state.run.mock.calls.some(([, args]) => args.includes('up'))).toBe(false);
  });

  it('does not accept a healthy status with extra unexpected API response fields', async () => {
    const root = await workspace();
    const state = options(root, {
      fetch: vi.fn(async () => ({
        status: 200,
        json: async () => ({ status: 'ok', extra: true }),
      })),
    });
    await expect(control.environment(createRuntime(state), 'start')).rejects.toThrow(/readiness/i);
    expect(state.output.mock.calls.flat().join(' ')).not.toMatch(/https?:\/\//);
  });
});
