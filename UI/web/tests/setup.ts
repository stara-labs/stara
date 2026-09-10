import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

let viewport = 1440;
const listeners = new Map<string, Set<() => void>>();
export function setViewport(width: number) {
  viewport = width;
  for (const callbacks of listeners.values()) for (const callback of callbacks) callback();
}
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    get matches() {
      return viewport <= Number(query.match(/\d+/)?.[0]);
    },
    media: query,
    addEventListener: (_name: string, callback: () => void) => {
      if (!listeners.has(query)) listeners.set(query, new Set());
      listeners.get(query)!.add(callback);
    },
    removeEventListener: (_name: string, callback: () => void) =>
      listeners.get(query)?.delete(callback),
  })),
});
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
