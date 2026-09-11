export interface PublicRuntimeConfig {
  schemaVersion: 1;
  environment: 'development' | 'staging';
}

export function parseRuntimeConfig(value: unknown): PublicRuntimeConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid runtime configuration');
  }
  const keys = Object.keys(value);
  const config = value as Record<string, unknown>;
  if (
    keys.length !== 2 ||
    !keys.includes('schemaVersion') ||
    !keys.includes('environment') ||
    config.schemaVersion !== 1 ||
    (config.environment !== 'development' && config.environment !== 'staging')
  ) {
    throw new Error('Invalid runtime configuration');
  }
  return { schemaVersion: 1, environment: config.environment };
}

export async function loadRuntimeConfig(signal?: AbortSignal): Promise<PublicRuntimeConfig> {
  try {
    const response = await fetch('/api/runtime-config', { cache: 'no-store', signal });
    if (!response.ok || signal?.aborted) throw new Error('Runtime configuration unavailable');
    return parseRuntimeConfig(await response.json());
  } catch {
    throw new Error('Runtime configuration unavailable');
  }
}
