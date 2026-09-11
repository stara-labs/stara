import { describe, expect, it } from 'vitest';
import * as config from '../../src/config.js';

describe('REL-09/10 public runtime configuration', () => {
  it('defaults only an absent environment to development and preserves bind configuration', () => {
    expect(config.readRuntimeConfig({})).toEqual({ schemaVersion: 1, environment: 'development' });
    expect(config.readConfig({ STARA_ENVIRONMENT: 'staging' })).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it.each(['development', 'staging'])(
    'accepts exactly %s without exposing other environment fields',
    (environment) => {
      const env = {
        STARA_ENVIRONMENT: environment,
        SECRET: 'synthetic-runtime-private-canary',
        PROJECT_ID: 'synthetic-private-project',
        PORT: '1234',
      };
      const before = { ...env };
      expect(config.readRuntimeConfig(env)).toEqual({ schemaVersion: 1, environment });
      expect(env).toEqual(before);
    },
  );

  it.each([
    '',
    ' ',
    ' staging',
    'staging ',
    'STAGING',
    'production',
    'test',
    'staging\n',
    'synthetic-runtime-private-canary',
  ])('rejects invalid environment case %# without echoing supplied content', (value) => {
    expect(typeof config.readRuntimeConfig).toBe('function');
    expect(() => config.readRuntimeConfig({ STARA_ENVIRONMENT: value })).toThrow(/\S/);
    try {
      config.readRuntimeConfig({ STARA_ENVIRONMENT: value });
    } catch (error) {
      expect(String(error)).not.toContain('synthetic-runtime-private-canary');
    }
  });
});
