import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyListenOptions } from 'fastify';
import { createServer } from '../../src/server.js';
import { startMain } from '../../src/main.js';
import { captureLogs, simulatedProcess } from '../helpers.js';

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const logs = captureLogs();
  const server = createServer({ logStream: logs.stream });
  const process = simulatedProcess();
  const lifecycle: {
    listen(options: FastifyListenOptions): Promise<string>;
    close(): Promise<void>;
  } = server;
  const listen = vi.spyOn(lifecycle, 'listen').mockResolvedValue('http://127.0.0.1:3000');
  const close = vi.spyOn(lifecycle, 'close').mockResolvedValue();
  const forceClose = vi.spyOn(server.server, 'closeAllConnections');
  return { server, logs, ...process, listen, close, forceClose };
}

describe('startup and bounded shutdown with simulated process boundaries', () => {
  it('validates before listening and returns an idempotent shutdown handle', async () => {
    const fixture = setup();
    const running = await startMain({ env: {}, runtime: fixture.runtime, server: fixture.server });
    expect(fixture.listen).toHaveBeenCalledWith({ host: '127.0.0.1', port: 3000 });
    expect(fixture.signals.listenerCount('SIGINT')).toBe(1);
    expect(fixture.signals.listenerCount('SIGTERM')).toBe(1);
    await Promise.all([running!.shutdown(), running!.shutdown()]);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.exit).not.toHaveBeenCalled();
    expect(fixture.signals.eventNames()).toEqual([]);
  });

  it.each(['SIGINT', 'SIGTERM'])(
    'closes gracefully on %s and removes both listeners',
    async (signal) => {
      const fixture = setup();
      const running = await startMain({
        env: {},
        runtime: fixture.runtime,
        server: fixture.server,
      });
      fixture.signals.emit(signal);
      fixture.signals.emit(signal);
      await running!.shutdown();
      expect(fixture.close).toHaveBeenCalledTimes(1);
      expect(fixture.runtime.exit).not.toHaveBeenCalled();
      expect(fixture.signals.eventNames()).toEqual([]);
    },
  );

  it('rejects invalid configuration without logging environment values or listening', async () => {
    const fixture = setup();
    const running = await startMain({
      env: { PORT: 'synthetic-config-secret' },
      runtime: fixture.runtime,
      server: fixture.server,
    });
    expect(running).toBeUndefined();
    expect(fixture.listen).not.toHaveBeenCalled();
    expect(fixture.runtime.setExitCode).toHaveBeenCalledWith(1);
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.logs.text()).toContain('startup_failed');
    expect(fixture.logs.text()).not.toContain('synthetic-config-secret');
  });

  it('closes and reports a sanitized startup failure when listen fails', async () => {
    const fixture = setup();
    fixture.listen.mockRejectedValue(new Error('synthetic-bind-secret'));
    expect(
      await startMain({ env: {}, runtime: fixture.runtime, server: fixture.server }),
    ).toBeUndefined();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(fixture.runtime.setExitCode).toHaveBeenCalledWith(1);
    expect(fixture.logs.text()).not.toContain('synthetic-bind-secret');
    expect(fixture.signals.eventNames()).toEqual([]);
  });

  it('forces connection cleanup and failure exit when close rejects', async () => {
    const fixture = setup();
    fixture.close.mockRejectedValue(new Error('synthetic-close-secret'));
    const running = await startMain({ env: {}, runtime: fixture.runtime, server: fixture.server });
    await running!.shutdown();
    expect(fixture.forceClose).toHaveBeenCalledOnce();
    expect(fixture.runtime.exit).toHaveBeenCalledWith(1);
    expect(fixture.logs.text()).toContain('shutdown_failed');
    expect(fixture.logs.text()).not.toContain('synthetic-close-secret');
    expect(fixture.signals.eventNames()).toEqual([]);
  });

  it('enforces the default five-second bound even when close never settles', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    fixture.close.mockImplementation(() => new Promise(() => {}));
    const running = await startMain({ env: {}, runtime: fixture.runtime, server: fixture.server });
    const shutdown = running!.shutdown();
    await vi.advanceTimersByTimeAsync(4999);
    expect(fixture.runtime.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;
    expect(fixture.forceClose).toHaveBeenCalledOnce();
    expect(fixture.runtime.exit).toHaveBeenCalledWith(1);
    expect(fixture.logs.text()).toContain('shutdown_timeout');
    expect(fixture.signals.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds cleanup after a failed startup', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    fixture.close.mockImplementation(() => new Promise(() => {}));
    const startup = startMain({
      env: { PORT: 'bad' },
      runtime: fixture.runtime,
      server: fixture.server,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await startup).toBeUndefined();
    expect(fixture.runtime.exit).toHaveBeenCalledWith(1);
  });

  it('ignores close completion after the deadline has already forced exit', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    let finishClose!: () => void;
    fixture.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const running = await startMain({ env: {}, runtime: fixture.runtime, server: fixture.server });
    const shutdown = running!.shutdown();
    await vi.advanceTimersByTimeAsync(5000);
    await shutdown;
    finishClose();
    await Promise.resolve();
    expect(fixture.runtime.exit).toHaveBeenCalledTimes(1);
    expect(fixture.logs.text()).not.toContain('shutdown_complete');
  });

  it('sets the native exit code and exits on cleanup failure using the default environment', async () => {
    const fixture = setup();
    const originalExitCode = process.exitCode;
    vi.stubEnv('PORT', 'synthetic-invalid-port');
    fixture.close.mockRejectedValue(new Error('simulated close failure'));
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as typeof process.exit);
    try {
      expect(await startMain({ server: fixture.server })).toBeUndefined();
      expect(process.exitCode).toBe(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = originalExitCode;
      vi.unstubAllEnvs();
    }
  });

  it('constructs its default server and reads the default environment', async () => {
    vi.stubEnv('PORT', 'synthetic-invalid-port');
    const { runtime } = simulatedProcess();
    try {
      expect(await startMain({ runtime })).toBeUndefined();
      expect(runtime.setExitCode).toHaveBeenCalledWith(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
