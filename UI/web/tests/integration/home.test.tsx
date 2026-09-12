import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home } from '../../src/Home';

afterEach(cleanup);

describe('STR-1 Home coordination collection', () => {
  it('filters accurate counted views and applies contextual ordering', async () => {
    const user = userEvent.setup();
    render(<Home selected="" onSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Needs Your Attention, 2 items' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: 'Sort Home' })).toHaveValue('priority');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort Home' }), 'oldest');
    expect(within(screen.getByRole('table')).getAllByRole('row')[1]).toHaveTextContent(
      'Resolve client intake source conflict',
    );
    await user.click(screen.getByRole('tab', { name: 'In Progress, 3 items' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByText('Approve partner evidence boundary')).not.toBeInTheDocument();
  });

  it('keeps lifecycle and attention distinct and opens one fixture-backed Conversation', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const select = vi.fn();
    render(<Home selected="source-conflict" onSelect={select} onOpen={open} />);
    const row = screen
      .getByRole('button', {
        name: 'Resolve client intake source conflict Choose the governing address so the intake draft can advance.',
      })
      .closest('tr')!;
    expect(row).toHaveTextContent('In progress');
    expect(row).toHaveTextContent('Blocked');
    expect(row).toHaveTextContent('Responsible lead');
    await user.click(
      within(row).getByRole('button', { name: 'Review: Resolve client intake source conflict' }),
    );
    expect(select).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('intake-conversation');
  });

  it('renders loading, empty, and retryable error states honestly', async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <Home selected="" onSelect={vi.fn()} onOpen={vi.fn()} dataState="loading" />,
    );
    expect(screen.getByText('Loading synthetic Home items…')).toBeVisible();
    rerender(<Home selected="" onSelect={vi.fn()} onOpen={vi.fn()} dataState="empty" />);
    expect(screen.getByText('No synthetic items are in this view.')).toBeVisible();
    rerender(
      <Home selected="" onSelect={vi.fn()} onOpen={vi.fn()} dataState="error" onRetry={retry} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No verified Work is shown');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
