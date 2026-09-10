import { describe, expect, it } from 'vitest';
import { readConfig } from '../../src/config.js';

describe('startup configuration', () => {
  it('defaults to loopback port 3000', () => {
    expect(readConfig({})).toEqual({ host: '127.0.0.1', port: 3000 });
  });

  it.each(['0.0.0.0', '127.0.0.1', '::1', '::', 'localhost', 'api.internal'])(
    'accepts bind host %s',
    (host) => {
      expect(readConfig({ HOST: host, PORT: '65535' })).toEqual({ host, port: 65535 });
    },
  );

  it('accepts the lowest explicit port', () => {
    expect(readConfig({ PORT: '1' }).port).toBe(1);
  });

  it.each([
    '',
    '0',
    '-1',
    '65536',
    '1.2',
    '3e3',
    ' 3000',
    '3000 ',
    '+3000',
    '03000',
    'NaN',
    '3000/secret',
  ])('rejects invalid PORT %j without echoing it', (port) => {
    expect(() => readConfig({ PORT: port })).toThrow('PORT must be an integer from 1 to 65535');
  });

  it.each([
    '',
    ' ',
    ' localhost',
    'localhost ',
    'http://localhost',
    'localhost:3000',
    'bad/secret',
    '[::1]',
    'a\nb',
    '-api',
    'api-',
    'a..b',
    '999.999.999.999',
    'a'.repeat(254),
  ])('rejects invalid HOST %j without echoing it', (host) => {
    expect(() => readConfig({ HOST: host })).toThrow('HOST must be an IP address or DNS hostname');
  });
});
