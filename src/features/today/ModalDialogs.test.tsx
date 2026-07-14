import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DEFAULT_ACTIVITIES } from '../../domain/defaults';
import { SessionEditor } from './SessionEditor';

function EditorHarness(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open editor</button>
      {open && (
        <SessionEditor
          activities={DEFAULT_ACTIVITIES}
          initialActivityId="activity-study"
          initialStart={new Date(2026, 6, 13, 9).getTime()}
          initialEnd={new Date(2026, 6, 13, 10).getTime()}
          active={false}
          mode="edit"
          error={null}
          saving={false}
          onCancel={() => setOpen(false)}
          onSave={() => undefined}
        />
      )}
    </>
  );
}

function ConfirmHarness(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open confirmation</button>
      {open && (
        <ConfirmDialog
          title="Resolve overlap"
          onCancel={() => setOpen(false)}
          actions={(
            <>
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button">Shorten this entry</button>
              <button type="button">Trim neighboring entry</button>
            </>
          )}
        >
          <p>Choose a resolution.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

it('opens SessionEditor modally, focuses its first field, and restores focus after Escape', () => {
  render(<EditorHarness />);
  const opener = screen.getByRole('button', { name: 'Open editor' });

  opener.focus();
  fireEvent.click(opener);

  expect(screen.getByRole('dialog', { name: 'Edit entry' })).toHaveAttribute('open');
  expect(screen.getByRole('dialog', { name: 'Edit entry' })).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByLabelText('Activity')).toHaveFocus();
  expect(opener).toHaveAttribute('inert');
  expect(opener).toHaveAttribute('aria-hidden', 'true');

  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit entry' }), { key: 'Escape' });

  expect(screen.queryByRole('dialog', { name: 'Edit entry' })).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(opener).not.toHaveAttribute('inert');
  expect(opener).not.toHaveAttribute('aria-hidden');
});

it('restores the SessionEditor invoker after the visible Cancel action', () => {
  render(<EditorHarness />);
  const opener = screen.getByRole('button', { name: 'Open editor' });
  opener.focus();
  fireEvent.click(opener);

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it.each([
  ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
  ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })],
])('focuses ConfirmDialog Cancel and restores its invoker after %s', (_name, close) => {
  render(<ConfirmHarness />);
  const opener = screen.getByRole('button', { name: 'Open confirmation' });

  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

  close();

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it('traps fallback keyboard focus inside ConfirmDialog', () => {
  render(<ConfirmHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
  const dialog = screen.getByRole('dialog');
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const last = screen.getByRole('button', { name: 'Trim neighboring entry' });

  last.focus();
  fireEvent.keyDown(dialog, { key: 'Tab' });
  expect(cancel).toHaveFocus();

  cancel.focus();
  fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
  expect(last).toHaveFocus();
});

it('uses native showModal and close when the runtime provides them', () => {
  const showModalDescriptor = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    'showModal',
  );
  const closeDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  const showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function closeDialog(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: close,
  });

  try {
    const view = render(<EditorHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));
    expect(showModal).toHaveBeenCalledOnce();

    view.unmount();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (showModalDescriptor === undefined) {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    }
    else Object.defineProperty(HTMLDialogElement.prototype, 'showModal', showModalDescriptor);
    if (closeDescriptor === undefined) {
      Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
    else Object.defineProperty(HTMLDialogElement.prototype, 'close', closeDescriptor);
  }
});
