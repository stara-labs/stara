import type { FastifyInstance } from 'fastify';
import { readConfig, readRuntimeConfig } from './config.js';
import { createServer } from './server.js';

export interface ProcessRuntime {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): void;
  setExitCode(code: number): void;
  exit(code: number): void;
}

const processRuntime: ProcessRuntime = {
  on: (signal, listener) => {
    process.on(signal, listener);
  },
  off: (signal, listener) => {
    process.off(signal, listener);
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
  exit: (code) => {
    process.exit(code);
  },
};

export async function startMain(
  options: {
    env?: NodeJS.ProcessEnv;
    server?: FastifyInstance;
    runtime?: ProcessRuntime;
  } = {},
): Promise<{ shutdown(): Promise<void> } | undefined> {
  let server = options.server;
  const runtime = options.runtime ?? processRuntime;
  let shutdownPromise: Promise<void> | undefined;
  const onSignal = () => {
    void shutdown();
  };

  function shutdown(): Promise<void> {
    const activeServer = server!;
    shutdownPromise ??= new Promise<void>((resolve) => {
      let settled = false;
      // Keep the deadline referenced: a hung close hook must not silently exit zero.
      const deadline = setTimeout(() => finish('shutdown_timeout'), 5000);
      function finish(event: 'shutdown_complete' | 'shutdown_failed' | 'shutdown_timeout') {
        if (settled) return;
        settled = true;
        if (event !== 'shutdown_complete') runtime.setExitCode(1);
        clearTimeout(deadline);
        runtime.off('SIGINT', onSignal);
        runtime.off('SIGTERM', onSignal);
        if (event === 'shutdown_complete') {
          activeServer.log.info({ event }, 'API stopped');
        } else {
          activeServer.log.error({ event }, 'API shutdown failed');
          activeServer.server.closeAllConnections();
          runtime.exit(1);
        }
        resolve();
      }
      void activeServer.close().then(
        () => finish('shutdown_complete'),
        () => finish('shutdown_failed'),
      );
    });
    return shutdownPromise;
  }

  try {
    const env = options.env ?? process.env;
    const config = readConfig(env);
    const runtimeConfig = readRuntimeConfig(env);
    server ??= createServer({ runtimeConfig });
    await server.listen(config);
    runtime.on('SIGINT', onSignal);
    runtime.on('SIGTERM', onSignal);
    return { shutdown };
  } catch {
    server ??= createServer();
    server.log.error({ event: 'startup_failed' }, 'API startup failed');
    runtime.setExitCode(1);
    await shutdown();
    return undefined;
  }
}
