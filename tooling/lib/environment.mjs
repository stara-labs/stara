import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { hashBytes } from './integrity.mjs';
import { sanitize } from './evidence.mjs';

export function composeSettings(root, env = {}) {
  const port = (name, fallback) => {
    const value = env[name] ?? String(fallback);
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 65535)
      throw new Error(`Invalid ${name}; expected port 1..65535`);
    return Number(value);
  };
  const webPort = port('STARA_WEB_PORT', 5173);
  const apiPort = port('STARA_API_PORT', 3000);
  if (webPort === apiPort) throw new Error('UI and API ports must be distinct');
  return { project: `stara-${hashBytes(root).slice(0, 12)}`, webPort, apiPort };
}

export async function environment(runtime, mode) {
  if (!['start', 'dev', 'down', 'logs'].includes(mode))
    throw new Error('Unknown environment command');
  const root = await realpath(runtime.root);
  const settings = composeSettings(root, runtime.env);
  const env = {
    ...runtime.env,
    STARA_WEB_PORT: String(settings.webPort),
    STARA_API_PORT: String(settings.apiPort),
  };
  const prefix = [
    'compose',
    '--project-name',
    settings.project,
    '--project-directory',
    root,
    '--file',
    join(root, 'compose.yaml'),
  ];
  const docker = (args, timeout = 30000) =>
    runtime.run('docker', [...prefix, ...args], { env, timeout });
  await runtime.run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15000 });
  if (mode === 'down') {
    await docker(['down', '--timeout', '10']);
    return settings;
  }
  if (mode === 'logs') {
    runtime.output((await docker(['logs', '--no-color', '--tail', '200'])).stdout);
    return settings;
  }
  const config = JSON.parse((await docker(['config', '--format', 'json'])).stdout);
  for (const [service, internal, published] of [
    ['web', 5173, settings.webPort],
    ['api', 3000, settings.apiPort],
  ]) {
    const item = config.services?.[service];
    if (
      !item ||
      item.container_name ||
      item.network_mode ||
      !item.ports?.length ||
      item.ports.some(
        (port) =>
          !['127.0.0.1', '::1'].includes(port.host_ip) ||
          Number(port.target) !== internal ||
          Number(port.published) !== published,
      )
    ) {
      throw new Error(`Compose ${service} must use isolated names and approved loopback ports`);
    }
  }
  if (
    Object.values(config.networks ?? {}).some((network) => network.external) ||
    Object.values(config.volumes ?? {}).some((volume) => volume.external)
  )
    throw new Error('External Compose resources are not allowed');
  try {
    await docker(['up', '--detach', '--build', '--wait', '--wait-timeout', '90'], 180000);
  } catch (cause) {
    throw new Error(
      sanitize(
        `Local services failed to start; check Docker, configuration, and occupied STARA_WEB_PORT/STARA_API_PORT ports\n${cause?.message ?? cause}`,
        env,
        4096,
      ),
      { cause },
    );
  }
  const web = `http://localhost:${settings.webPort}`;
  const api = `http://localhost:${settings.apiPort}`;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const health = await runtime.fetch(`${api}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const body = await health.json();
      const page = await runtime.fetch(web, { signal: AbortSignal.timeout(2000) });
      if (
        health.status === 200 &&
        JSON.stringify(body) === '{"status":"ok"}' &&
        page.status === 200
      ) {
        runtime.output(`UI: ${web}\nAPI: ${api}/api/health`);
        return { ...settings, web, api };
      }
    } catch {
      /* Retry transient connection failures within the fixed readiness bound. */
    }
    await runtime.sleep(1000);
  }
  throw new Error(
    'Local UI/API readiness failed after 30 bounded attempts; inspect environment:logs',
  );
}
