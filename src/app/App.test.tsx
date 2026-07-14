import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FocusDialRepository } from '../domain/models';
import { createMemoryRepository } from '../storage/memoryRepository';
import { App } from './App';
import { RepositoryProvider } from './RepositoryContext';

function renderApp(
  repository: FocusDialRepository = createMemoryRepository(),
  appProps: { reloadPage?: () => void } = {},
) {
  return {
    repository,
    ...render(
    <RepositoryProvider repository={repository}>
      <App {...appProps} />
    </RepositoryProvider>,
    ),
  };
}

async function settleRepositoryQueries(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

it('renders the offline status globally when the app starts offline', () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);

  renderApp();

  expect(screen.getByText('Offline — changes stay on this device')).toHaveAttribute(
    'aria-live',
    'polite',
  );
});

it('opens on Focus and navigates among all four destinations', async () => {
  const user = userEvent.setup();
  renderApp();
  expect(screen.getByRole('heading', { name: 'What are you doing?' })).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Today' }));
  expect(screen.getByRole('heading', { name: 'Today' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByRole('heading', { name: 'This week' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

it.each(['Focus', 'Today', 'Week', 'Settings']) (
  'opens the global emotion sheet from %s and restores focus on Cancel',
  async (destination) => {
    const user = userEvent.setup();
    renderApp();
    if (destination !== 'Focus') {
      await user.click(screen.getByRole('button', { name: destination }));
    }

    const invoker = screen.getByRole('button', { name: 'How do you feel?' });
    expect(screen.getAllByRole('button', { name: 'How do you feel?' })).toHaveLength(1);
    await user.click(invoker);
    expect(screen.getByRole('dialog', { name: 'How do you feel?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel check-in' }));

    expect(invoker).toHaveFocus();
  },
);

it('restores focus to the global invoker after Save', async () => {
  const user = userEvent.setup();
  const repository = createMemoryRepository();
  renderApp(repository);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  const invoker = screen.getByRole('button', { name: 'How do you feel?' });

  await user.click(invoker);
  await settleRepositoryQueries();
  await user.click(screen.getByRole('radio', { name: 'Happy' }));
  await user.click(screen.getByRole('button', { name: 'Save check-in' }));
  await settleRepositoryQueries();

  expect(invoker).toHaveFocus();
  expect(await repository.listEmotionEntries()).toHaveLength(1);
});

it('catches a repository read rejection and exposes actionable global storage status', async () => {
  const user = userEvent.setup();
  const repository = createMemoryRepository();
  const reloadPage = vi.fn();
  repository.getPreferences = async () => {
    throw new DOMException('IndexedDB is unavailable.', 'InvalidStateError');
  };

  renderApp(repository, { reloadPage });
  await settleRepositoryQueries();

  const status = screen.getByRole('alert', { name: 'Storage status' });
  expect(status).toHaveTextContent('Browser storage is unavailable');
  expect(status).toHaveTextContent('Settings');
  expect(status).toHaveTextContent('download a backup');
  expect(status).toHaveTextContent('restore browser storage access');
  expect(status).toHaveTextContent('then reload Focus Dial');
  await user.click(within(status).getByRole('button', { name: 'Reload Focus Dial' }));
  expect(reloadPage).toHaveBeenCalledTimes(1);
  expect(repository.getHealth()).toMatchObject({ status: 'unavailable' });
});

it('preserves a form draft after quota failure, gates later writes, and keeps backup export available', async () => {
  const user = userEvent.setup();
  const repository = createMemoryRepository();
  repository.putActivity = async () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  renderApp(repository);
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await settleRepositoryQueries();

  const draft = screen.getByLabelText('New activity name');
  await user.type(draft, 'Keep this draft');
  fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
  await settleRepositoryQueries();

  expect(draft).toHaveValue('Keep this draft');
  const status = screen.getByRole('alert', { name: 'Storage status' });
  expect(status).toHaveTextContent('Browser storage is full');
  const attemptedAfterFailure = vi.fn();
  await expect(repository.runWrite(async () => {
    attemptedAfterFailure();
  })).rejects.toThrow('Browser storage is full');
  expect(attemptedAfterFailure).not.toHaveBeenCalled();

  const data = screen.getByRole('region', { name: 'Your data' });
  const backup = within(data).getByRole('button', { name: 'Download JSON backup' });
  expect(backup).toBeEnabled();
  await user.click(backup);
  await settleRepositoryQueries();
  expect(download).toHaveBeenCalledTimes(1);
});
