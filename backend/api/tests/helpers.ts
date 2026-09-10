import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { vi } from 'vitest';
import type { ProcessRuntime } from '../src/main.js';

export function sendSignal(child: ChildProcess, signal: 'SIGINT' | 'SIGTERM') {
  if (process.platform === 'win32') {
    child.send(signal);
  } else {
    child.disconnect();
    child.kill(signal);
  }
}

export function captureLogs() {
  let output = '';
  const stream = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk);
      done();
    },
  });
  return {
    stream,
    text: () => output,
    records: (): Record<string, unknown>[] =>
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

export function simulatedProcess() {
  const signals = new EventEmitter();
  const runtime: ProcessRuntime = {
    on: (signal, listener) => {
      signals.on(signal, listener);
    },
    off: (signal, listener) => {
      signals.off(signal, listener);
    },
    setExitCode: vi.fn(),
    exit: vi.fn(),
  };
  return { signals, runtime };
}
