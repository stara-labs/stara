/** Local stdio clients may select a port, but cannot redirect tools to remote APIs. */
export function readMcpConfig(env: NodeJS.ProcessEnv): string {
  const value = env.STARA_API_URL ?? 'http://127.0.0.1:3000';
  try {
    const url = new URL(value);
    if (
      value !== value.trim() ||
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    // Construct the destination from literal hosts and a numeric port. Never
    // propagate the operator's URL string into a request, even after validation.
    const host = url.hostname === '[::1]' ? '[::1]' : '127.0.0.1';
    const port = Number(url.port || 80);
    return `http://${host}${port === 80 ? '' : `:${port}`}`;
  } catch {
    throw new Error(
      'STARA_API_URL must be an HTTP loopback origin with no credentials, path, query, or fragment',
    );
  }
}
