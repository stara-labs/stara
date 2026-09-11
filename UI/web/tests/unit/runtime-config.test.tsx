import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig, parseRuntimeConfig } from '../../src/runtime-config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('REL-09/10 runtime config parsing and same-origin loading', () => {
  it.each(['development', 'staging'])('accepts %s only in schema 1', (environment) => {
    expect(parseRuntimeConfig({ schemaVersion: 1, environment })).toEqual({
      schemaVersion: 1,
      environment,
    });
  });

  it.each([
    null,
    undefined,
    [],
    {},
    'staging',
    { schemaVersion: 1 },
    { environment: 'staging' },
    { schemaVersion: '1', environment: 'staging' },
    { schemaVersion: 2, environment: 'staging' },
    { schemaVersion: 1, environment: 'production' },
    { schemaVersion: 1, environment: 'STAGING' },
    { schemaVersion: 1, environment: 'staging ' },
    { schemaVersion: 1, environment: '' },
    { schemaVersion: 1, environment: 'staging', secret: 'synthetic-runtime-private-canary' },
  ])('rejects missing, malformed, or unrecognized configuration case %#', (value) => {
    expect(() => parseRuntimeConfig(value)).toThrow(/\S/);
  });

  it('fetches the fixed same-origin endpoint without caching and forwards cancellation', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: 1, environment: 'staging' }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await loadRuntimeConfig(controller.signal)).toEqual({
      schemaVersion: 1,
      environment: 'staging',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/runtime-config',
      expect.objectContaining({ cache: 'no-store', signal: controller.signal }),
    );
  });

  it.each([
    [
      'HTTP failure',
      () => Promise.resolve(new Response('synthetic-runtime-private-canary', { status: 503 })),
    ],
    ['invalid JSON', () => Promise.resolve(new Response('synthetic-runtime-private-canary'))],
    [
      'wrong schema',
      () =>
        Promise.resolve(new Response(JSON.stringify({ schemaVersion: 2, environment: 'staging' }))),
    ],
    ['missing config', () => Promise.resolve(new Response('{}'))],
    ['network failure', () => Promise.reject(new Error('synthetic-runtime-private-canary'))],
  ])('fails closed for %s', async (_name, result) => {
    vi.stubGlobal('fetch', vi.fn(result));
    await expect(loadRuntimeConfig()).rejects.toThrow();
  });
});
