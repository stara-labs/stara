import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';

afterEach(cleanup);

describe('UI-SHELL-02 focus, inspect, open', () => {
  it('Given Home, when an attention row is selected and reviewed, then its Conversation opens once', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('complementary', { name: 'Context panel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Home' })).not.toBeInTheDocument();
    const row = screen.getByRole('button', {
      name: 'Resolve client intake source conflict Choose the governing address so the intake draft can advance.',
    });
    await user.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('complementary', { name: 'Context panel' })).not.toBeInTheDocument();
    const review = screen.getByRole('button', {
      name: 'Review: Resolve client intake source conflict',
    });
    await user.click(review);
    expect(screen.getByRole('tab', { name: /Client intake source decision/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByRole('tab', { name: /Client intake source decision/ })).toHaveLength(1);
  });
  it('Given contextual inspection, when activity opens, then the canonical tab is focused without duplication', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole('button', { name: 'Review: Resolve client intake source conflict' }),
    );
    expect(screen.getByRole('tab', { name: /Client intake source decision/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByRole('tab', { name: /Client intake source decision/ })).toHaveLength(1);
    expect(
      within(screen.getByRole('tabpanel', { name: 'Client intake source decision' })).getByText(
        'External effect: None',
      ),
    ).toBeVisible();
  });
  it('Given a draft, when switching and reopening, then draft, selection, and scroll are restored in session', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Design-partner preparation/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Conversation draft' }),
      'Keep the evidence boundary explicit.',
    );
    const center = screen.getByRole('region', { name: 'Design-partner preparation content' });
    fireEvent.scroll(center, { target: { scrollTop: 80 } });
    await user.click(screen.getByRole('button', { name: /Home, 2 items need attention/ }));
    await user.click(screen.getByRole('tab', { name: /Design-partner preparation/ }));
    expect(screen.getByRole('textbox', { name: 'Conversation draft' })).toHaveValue(
      'Keep the evidence boundary explicit.',
    );
    expect(center.scrollTop).toBe(80);
    await user.click(screen.getByRole('button', { name: 'Close Design-partner preparation' }));
    await user.click(screen.getByRole('button', { name: 'Working contexts' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /Open Design-partner preparation/,
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Conversation draft' })).toHaveValue(
      'Keep the evidence boundary explicit.',
    );
  });
});
