import { expect, it, vi } from 'vitest';

const render = vi.hoisted(() => vi.fn());
const createRoot = vi.hoisted(() => vi.fn(() => ({ render })));
vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('@stara/ui/styles', () => ({}));

it('UI-ENTRY-01 mounts the public application in its root', async () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  await import('../../src/main');
  expect(createRoot).toHaveBeenCalledWith(root);
  expect(render).toHaveBeenCalledOnce();
  root.remove();
});
