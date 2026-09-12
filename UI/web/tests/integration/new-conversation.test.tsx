import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';

afterEach(cleanup);

describe('STR-2 fixture-backed New Conversation', () => {
  it('opens Conversations without creating a conversation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(screen.getByRole('button', { name: 'Conversations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { name: 'Conversations' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('uses one focused creation surface and refuses whitespace submission', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    const composer = screen.getByRole('textbox', { name: 'Message' });
    expect(composer).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start Conversation' });
    expect(start).toBeDisabled();
    await user.type(composer, '   ');
    expect(start).toBeDisabled();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(screen.getByRole('heading', { name: 'New Conversation' })).toBeVisible();
    await user.clear(composer);
    await user.type(composer, 'Coordinate the evidence review');
    expect(start).toBeEnabled();
    await user.clear(composer);
    expect(start).toBeDisabled();
  });

  it('searches, applies, and removes mixed participant fixtures', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    const add = screen.getByRole('button', { name: 'Add participants' });
    await user.click(add);
    const picker = screen.getByRole('dialog', { name: 'Add participants' });
    expect(within(picker).getByRole('group', { name: 'People' })).toBeVisible();
    expect(within(picker).getByRole('group', { name: 'Agents' })).toBeVisible();
    const search = within(picker).getByRole('searchbox', { name: 'Search participants' });
    expect(search).toHaveFocus();
    await user.click(within(picker).getByRole('checkbox', { name: /Responsible lead/ }));
    await user.click(within(picker).getByRole('checkbox', { name: /Intake Agent/ }));
    expect(within(picker).getByText('2 selected')).toBeVisible();
    await user.clear(search);
    await user.type(search, 'does not exist');
    expect(within(picker).getByText('No matching participants.')).toBeVisible();
    await user.clear(search);
    expect(within(picker).getByRole('checkbox', { name: /Responsible lead/ })).toBeChecked();
    await user.click(within(picker).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Remove Responsible lead' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Intake Agent' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove Responsible lead' }));
    expect(
      screen.queryByRole('button', { name: 'Remove Responsible lead' }),
    ).not.toBeInTheDocument();
  });

  it('creates one session-only context and reopens it canonically', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message' }),
      'Coordinate the evidence review with the responsible group',
    );
    await user.click(screen.getByRole('button', { name: 'Start Conversation' }));
    expect(
      screen.getByRole('heading', { name: 'Coordinate the evidence review with the r…' }),
    ).toBeVisible();
    expect(screen.getAllByText('No person or Agent was contacted.')).not.toHaveLength(0);
    expect(
      screen.getByText('Coordinate the evidence review with the responsible group'),
    ).toBeVisible();
    expect(screen.getAllByRole('tab', { name: /Coordinate the evidence review/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    await user.click(screen.getByRole('button', { name: /Open Coordinate the evidence review/ }));
    expect(screen.getAllByRole('tab', { name: /Coordinate the evidence review/ })).toHaveLength(1);
  });

  it('cancels to the previous context and keeps mentions unavailable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Design-partner preparation/ }));
    const origin = screen.getByRole('button', { name: 'New conversation' });
    await user.click(origin);
    expect(screen.getByRole('button', { name: '@ Mention' })).toBeDisabled();
    expect(screen.getByText('Mentions are not implemented.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Design-partner preparation' })).toBeVisible();
    expect(origin).toHaveFocus();
  });
});
