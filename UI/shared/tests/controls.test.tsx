import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Dialog, Icon, IconButton, Status, TextArea } from '../src';

afterEach(cleanup);
describe('UI-PRIMITIVES-01 accessible controls', () => {
  it('names tools, associates tooltips, and keeps disabled commands inert', async () => {
    const user = userEvent.setup();
    const click = vi.fn();
    render(
      <>
        <IconButton icon="close" label="Close review" onClick={click} />
        <Button disabled onClick={click}>
          Unavailable
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Close review' })).toHaveAccessibleDescription(
      'Close review',
    );
    await user.click(screen.getByRole('button', { name: 'Unavailable' }));
    expect(click).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close review' }));
    expect(click).toHaveBeenCalledOnce();
  });
  it('keeps language alongside operational state and labels editable fields', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Status state="attention">Needs attention</Status>
        <Status state="running" compact>
          Running
        </Status>
        <TextArea label="Draft" defaultValue="" />
        <Icon name="work" />
      </>,
    );
    expect(screen.getByText('Needs attention')).toBeVisible();
    expect(screen.getByText('Running')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Draft' }), 'A bounded draft');
    expect(screen.getByRole('textbox')).toHaveValue('A bounded draft');
  });
  it('restores focus after dismissing a dialog and supports Escape', async () => {
    const dismiss = vi.fn();
    const user = userEvent.setup();
    const { rerender, unmount } = render(<Button>Open review</Button>);
    screen.getByRole('button').focus();
    rerender(
      <>
        <Button>Open review</Button>
        <Dialog title="Review" onDismiss={dismiss}>
          <p>Fixture only</p>
        </Dialog>
      </>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Review');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(dismiss).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Close Review' }));
    expect(dismiss).toHaveBeenCalledTimes(2);
    rerender(<Button>Open review</Button>);
    expect(screen.getByRole('button')).toHaveFocus();
    unmount();
  });
});
