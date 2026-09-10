import { expect, it, vi } from 'vitest';

it('runs the startup orchestrator from the executable entrypoint', async () => {
  const startMain = vi.fn().mockResolvedValue(undefined);
  vi.doMock('../../src/main.js', () => ({ startMain }));
  try {
    await import('../../src/index.js');
    expect(startMain).toHaveBeenCalledExactlyOnceWith();
  } finally {
    vi.doUnmock('../../src/main.js');
    vi.resetModules();
  }
});
