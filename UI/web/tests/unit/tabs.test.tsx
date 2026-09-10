import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Tabs } from '../../src/Tabs';
import { contexts } from '../../src/fixtures';
import { createWorkspace } from '../../src/workspace';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('UI-TABS-01 dragging moves a canonical working tab and never moves Home', () => {
  const move = vi.fn();
  render(
    <Tabs
      contexts={contexts}
      open={createWorkspace().open}
      active="home"
      mobile={false}
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onMove={move}
      onPicker={vi.fn()}
    />,
  );
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: '',
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key),
  };
  const from = screen.getByRole('tab', { name: /Resolve client/ }).parentElement!;
  const to = screen.getByRole('tab', { name: /Prepare client/ }).parentElement!;
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
  expect(move).toHaveBeenCalledWith('intake', 1);
  expect(screen.getByRole('tab', { name: 'Home' }).parentElement).toHaveAttribute(
    'draggable',
    'false',
  );
});
