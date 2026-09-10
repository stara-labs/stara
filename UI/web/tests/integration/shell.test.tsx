import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';

afterEach(cleanup);

describe('UI-SHELL-02 focus, inspect, open', () => {
  it('Given Home, when an attention row is selected and reviewed, then inspection preserves Home and returns focus', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('complementary', { name: 'Context panel' })).not.toBeInTheDocument();
    const row = screen.getByRole('button', {
      name: 'Select: Choose the governing address for the client form',
    });
    await user.click(row);
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('complementary', { name: 'Context panel' })).not.toBeInTheDocument();
    const review = screen.getByRole('button', { name: 'Review address decision' });
    await user.click(review);
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('complementary', { name: 'Context panel' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide details' }));
    await waitFor(() => expect(review).toHaveFocus());
  });
  it('Given contextual inspection, when activity opens, then the canonical tab is focused without duplication', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Review address decision' }));
    await user.click(screen.getByRole('button', { name: 'Open activity' }));
    expect(screen.getByRole('tab', { name: /Resolve client intake/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getAllByRole('tab', { name: /Resolve client intake/ })).toHaveLength(1);
    expect(
      within(screen.getByRole('tabpanel', { name: 'Resolve client intake' })).getByText(
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
    await user.click(screen.getByRole('tab', { name: 'Home' }));
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
