import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(screen.getByRole('combobox', { name: 'Add People or Agents' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start conversation' });
    expect(start).toBeDisabled();
    await user.type(composer, '   ');
    expect(start).toBeDisabled();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(screen.getByRole('heading', { name: 'New conversation' })).toBeVisible();
    await user.clear(composer);
    await user.type(composer, 'Coordinate the evidence review');
    expect(start).toBeEnabled();
    await user.clear(composer);
    expect(start).toBeDisabled();
  });

  it('uses the same creation surface from global and destination entry points', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.getByRole('region', { name: 'New conversation' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'New conversation' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    await user.click(screen.getByRole('button', { name: 'New Conversation' }));
    expect(screen.getAllByRole('region', { name: 'New conversation' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveAttribute(
      'placeholder',
      'Ask a question, request work, or coordinate a review…',
    );
  });

  it('dismisses the picker predictably without losing applied selections', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    const add = screen.getByRole('button', { name: 'Add People or Agents' });
    await user.click(add);
    let picker = screen.getByRole('region', {
      name: 'Recent and recommended people and Agents',
    });
    await user.click(within(picker).getByRole('checkbox', { name: /Operations Lead/ }));
    await user.click(within(picker).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Remove Operations Lead' })).toBeVisible();
    await user.click(add);
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole('region', { name: 'Recent and recommended people and Agents' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Operations Lead' })).toBeVisible();
    await user.click(add);
    picker = screen.getByRole('region', { name: 'Recent and recommended people and Agents' });
    await user.keyboard('{Escape}');
    expect(picker).not.toBeInTheDocument();
    expect(add).toHaveFocus();
  });

  it('reopens removed participants unchecked while retaining remaining selections', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    const add = screen.getByRole('button', { name: 'Add People or Agents' });
    await user.click(add);
    let picker = screen.getByRole('region', {
      name: 'Recent and recommended people and Agents',
    });
    await user.click(within(picker).getByRole('checkbox', { name: /Customer lead/ }));
    await user.click(within(picker).getByRole('checkbox', { name: /Product Agent/ }));
    await user.click(within(picker).getByRole('button', { name: 'Apply' }));
    await user.click(screen.getByRole('button', { name: 'Remove Customer lead' }));
    await user.click(add);
    picker = screen.getByRole('region', { name: 'Recent and recommended people and Agents' });
    expect(within(picker).getByRole('checkbox', { name: /Customer lead/ })).not.toBeChecked();
    expect(within(picker).getByRole('checkbox', { name: /Product Agent/ })).toBeChecked();
  });

  it('searches, applies, and removes mixed participant fixtures', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    const add = screen.getByRole('button', { name: 'Add People or Agents' });
    await user.click(add);
    const picker = screen.getByRole('region', {
      name: 'Recent and recommended people and Agents',
    });
    expect(within(picker).getByRole('group', { name: 'People' })).toBeVisible();
    expect(within(picker).getByRole('group', { name: 'Agents' })).toBeVisible();
    const search = within(picker).getByRole('searchbox', { name: 'Search people or Agents' });
    expect(search).toHaveFocus();
    await user.click(within(picker).getByRole('checkbox', { name: /Customer lead/ }));
    await user.click(within(picker).getByRole('checkbox', { name: /Intake Agent/ }));
    expect(within(picker).getByText('2 selected')).toBeVisible();
    await user.clear(search);
    await user.type(search, 'does not exist');
    expect(within(picker).getByText('No matching participants.')).toBeVisible();
    await user.clear(search);
    expect(within(picker).getByRole('checkbox', { name: /Customer lead/ })).toBeChecked();
    await user.click(within(picker).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('button', { name: 'Remove Customer lead' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove Intake Agent' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove Customer lead' }));
    expect(screen.queryByRole('button', { name: 'Remove Customer lead' })).not.toBeInTheDocument();
  });

  it('filters and selects directly from the inline To combobox', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    const entry = screen.getByRole('combobox', { name: 'Add People or Agents' });
    await user.type(entry, 'Intake');
    const suggestions = screen.getByRole('region', {
      name: 'Recent and recommended people and Agents',
    });
    expect(within(suggestions).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(within(suggestions).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
    await user.click(within(suggestions).getByRole('checkbox', { name: /Intake Agent/ }));
    expect(screen.getByRole('button', { name: 'Remove Intake Agent' })).toBeVisible();
    expect(suggestions).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
  });

  it('creates a no-participant session context, focuses it, and reopens it canonically', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Message' }),
      'Coordinate the evidence review with the responsible group',
    );
    await user.click(screen.getByRole('button', { name: 'Start conversation' }));
    const heading = screen.getByRole('heading', {
      name: 'Coordinate the evidence review with the r…',
    });
    expect(heading).toBeVisible();
    expect(heading).toHaveFocus();
    expect(screen.getAllByText('No person or Agent was contacted.')).not.toHaveLength(0);
    expect(
      screen.getByText('Coordinate the evidence review with the responsible group'),
    ).toBeVisible();
    expect(screen.getAllByRole('tab', { name: /Coordinate the evidence review/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    await user.click(screen.getByRole('button', { name: /Open Coordinate the evidence review/ }));
    expect(screen.getAllByRole('tab', { name: /Coordinate the evidence review/ })).toHaveLength(1);
  });

  it('creates a mixed-participant session context without contacting participants', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.click(screen.getByRole('button', { name: 'Add People or Agents' }));
    const picker = screen.getByRole('region', {
      name: 'Recent and recommended people and Agents',
    });
    await user.click(within(picker).getByRole('checkbox', { name: /Customer lead/ }));
    await user.click(within(picker).getByRole('checkbox', { name: /Evidence Researcher/ }));
    await user.click(within(picker).getByRole('button', { name: 'Apply' }));
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Review the evidence set');
    await user.click(screen.getByRole('button', { name: 'Start conversation' }));
    expect(screen.getByText('Participants: Customer lead, Evidence Researcher')).toBeVisible();
    expect(screen.getAllByText('No person or Agent was contacted.')).not.toHaveLength(0);
  });

  it('cancels to the previous context and keeps mentions unavailable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Design-partner preparation/ }));
    const origin = screen.getByRole('button', { name: 'New conversation' });
    await user.click(origin);
    expect(screen.getByRole('button', { name: '@ Mention' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '@ Mention' })).toHaveAccessibleDescription(
      'Mentions are not implemented.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Design-partner preparation' })).toBeVisible();
    expect(origin).toHaveFocus();
  });
});
