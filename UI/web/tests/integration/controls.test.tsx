import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { setViewport } from '../setup';

afterEach(() => {
  cleanup();
  setViewport(1440);
});

describe('UI-SHELL-03 shell controls', () => {
  it('Given a working set, keyboard navigation, reordering and close preserve Home navigation', async () => {
    const user = userEvent.setup();
    render(<App />);
    screen.getByRole('tab', { name: /Prepare client/ }).focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Design-partner/ })).toHaveFocus());
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(screen.getByRole('status')).toHaveTextContent('position 4');
    await user.keyboard('{Home}');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Prepare client/ })).toHaveFocus());
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('tab', { name: /Prepare client/ })).not.toBeInTheDocument();
    screen.getByRole('tab', { name: /Resolve client/ }).focus();
    await user.keyboard('{End}');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Design-partner/ })).toHaveFocus());
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('tab', { name: /Design-partner/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Home, 2 items need attention' }),
    ).toBeInTheDocument();
  });
  it('Given the context picker, searching, reordering, and dismissing are keyboard accessible', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Working contexts' }));
    await user.click(screen.getByRole('button', { name: 'Move Resolve client intake earlier' }));
    expect(screen.getByRole('status')).toHaveTextContent('position 3');
    await user.click(screen.getByRole('button', { name: 'Move Resolve client intake later' }));
    expect(screen.getByRole('status')).toHaveTextContent('position 4');
    await user.type(screen.getByRole('searchbox'), 'does not exist');
    expect(screen.getByText('No matching contexts.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close Working contexts' }));
    await user.click(screen.getByRole('button', { name: 'Search contexts' }));
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'Conversation');
    expect(screen.getByRole('searchbox')).toHaveValue('Conversation');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('Given Home, the theme and navigation controls preserve awareness and context', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(
      screen.getByRole('button', { name: 'Home, 2 items need attention' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    await user.click(screen.getByRole('tab', { name: 'Recently Completed, 1 item' }));
    await user.click(
      screen.getByRole('button', { name: 'View: Record accepted onboarding scope' }),
    );
    await user.click(screen.getByRole('button', { name: 'Home, 2 items need attention' }));
    await user.click(screen.getByRole('tab', { name: 'In Progress, 3 items' }));
    await user.click(screen.getByRole('button', { name: 'Open: Prepare design-partner brief' }));
    await user.click(
      screen.getByRole('button', { name: 'Select contribution from Human contributor' }),
    );
    expect(
      screen.getByRole('button', { name: 'Select contribution from Human contributor' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
  it('Given source comparison, choices and notes never alter operational facts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Resolve client intake/ }));
    await user.click(screen.getByRole('radio', { name: /Client account record/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Review notes' }),
      'Await responsible lead',
    );
    await user.click(screen.getByRole('button', { name: 'Inspect context' }));
    await user.click(screen.getByRole('button', { name: 'View supporting evidence' }));
    const panel = screen.getByRole('complementary', { name: 'Context panel' });
    await user.click(within(panel).getByRole('radio', { name: /Client account record/ }));
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(
      within(panel).getByText('No external write or verification has occurred.'),
    ).toBeVisible();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Sources' })).toHaveFocus();
    await user.keyboard('{Home}{End}{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Context' })).toHaveFocus();
    await user.click(screen.getByRole('tab', { name: 'Sources' }));
    await user.click(screen.getByRole('button', { name: 'Open in Knowledge' }));
    expect(screen.getByRole('heading', { name: 'Onboarding source review' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Working contexts' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Open Resolve client intake',
      }),
    );
    expect(screen.getByRole('textbox', { name: 'Review notes' })).toHaveValue(
      'Await responsible lead',
    );
    expect(screen.getByRole('radio', { name: /Client account record/ })).toBeChecked();
  });
  it('Given a general context, inspection explains responsibility and opens the same context', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: /Design-partner preparation/ }));
    await user.click(screen.getByRole('button', { name: 'Inspect context' }));
    const panel = screen.getByRole('complementary', { name: 'Context panel' });
    expect(within(panel).getByRole('heading', { name: 'Responsibility' })).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Open context' }));
    expect(screen.getAllByRole('tab', { name: /Design-partner preparation/ })).toHaveLength(1);
  });
  it('Given a new conversation, only an unsent local draft is created', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.click(screen.getByRole('button', { name: 'Close New conversation' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(screen.getByRole('heading', { name: 'Untitled conversation' })).toBeVisible();
    expect(
      screen.getByText('A local conversation draft. No agent or person has received a message.'),
    ).toBeVisible();
    expect(
      within(screen.getByRole('tabpanel', { name: 'Untitled conversation' })).queryAllByRole(
        'button',
        { name: /Select contribution/ },
      ),
    ).toHaveLength(0);
  });
  it('Given responsive inspection, the layer closes at 900 and keyboard focus stays in the reopened layer', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Show details' }));
    act(() => setViewport(900));
    expect(screen.queryByRole('complementary', { name: 'Context panel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show details' }));
    const heading = screen.getByRole('heading', { name: 'Which address should govern this form?' });
    heading.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Open activity' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show details' })).toHaveFocus());
    act(() => setViewport(700));
    expect(screen.queryByRole('tab', { name: 'Home' })).not.toBeInTheDocument();
    act(() => setViewport(1440));
    expect(screen.getByRole('tab', { name: /Design-partner preparation/ })).toBeVisible();
  });
});
