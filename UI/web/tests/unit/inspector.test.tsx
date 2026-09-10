import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Inspector } from '../../src/Inspector';
import { contexts } from '../../src/fixtures';
import { freshMemory } from '../../src/workspace';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('UI-PANEL-01 pointer and keyboard resize obey minimum, maximum and center space', async () => {
  const width = vi.fn();
  const remember = vi.fn();
  const user = userEvent.setup();
  const tokens: Record<string, string> = {
    '--stara-frame-context-minimum': '296px',
    '--stara-frame-context-maximum': '464px',
    '--stara-frame-center-minimum': '520px',
    '--stara-space-4': '16px',
  };
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const value = computed(element);
    value.getPropertyValue = (name) => tokens[name] ?? '';
    return value;
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  render(
    <>
      <aside aria-label="Global navigation" />
      <Inspector
        context={contexts.home}
        memory={freshMemory()}
        overlay={false}
        width={336}
        onWidth={width}
        onRemember={remember}
        onOpen={vi.fn()}
        scroll={12}
        onScroll={vi.fn()}
      />
    </>,
  );
  const separator = screen.getByRole('separator');
  separator.focus();
  await user.keyboard('{ArrowLeft}{ArrowRight}');
  expect(width.mock.calls.map((call) => call[0])).toEqual([352, 320]);
  fireEvent.pointerDown(separator, { clientX: 500, pointerId: 1 });
  fireEvent.pointerMove(separator, { clientX: -500, pointerId: 1 });
  expect(width).toHaveBeenLastCalledWith(464);
  fireEvent.pointerMove(separator, { clientX: 2000, pointerId: 1 });
  expect(width).toHaveBeenLastCalledWith(296);
  fireEvent.pointerUp(separator, { pointerId: 1 });
  fireEvent.pointerCancel(separator, { pointerId: 1 });
  const calls = width.mock.calls.length;
  fireEvent.pointerMove(separator, { clientX: 400, pointerId: 1 });
  expect(width).toHaveBeenCalledTimes(calls);
});
