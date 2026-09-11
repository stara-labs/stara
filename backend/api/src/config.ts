import { isIP } from 'node:net';

export interface ServerConfig {
  host: string;
  port: number;
}

export interface PublicRuntimeConfig {
  schemaVersion: 1;
  environment: 'development' | 'staging';
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv): PublicRuntimeConfig {
  const environment = env.STARA_ENVIRONMENT === undefined ? 'development' : env.STARA_ENVIRONMENT;
  if (environment !== 'development' && environment !== 'staging') {
    throw new Error('STARA_ENVIRONMENT must be development or staging');
  }
  return { schemaVersion: 1, environment };
}

export function readConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const host = env.HOST ?? '127.0.0.1';
  const port = env.PORT ?? '3000';
  const hostname =
    host.length <= 253 &&
    !/^[\d.]+$/.test(host) &&
    host.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label));

  if (!isIP(host) && !hostname) {
    throw new Error('HOST must be an IP address or DNS hostname');
  }
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return { host, port: Number(port) };
}
