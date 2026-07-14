import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../app/App';
import { RepositoryProvider } from '../../app/RepositoryContext';
import { DEFAULT_ACTIVITIES, DEFAULT_EMOTIONS, DEFAULT_PREFERENCES } from '../../domain/defaults';
import type { EmotionEntry, FocusDialRepository, Session } from '../../domain/models';
import { createMemoryRepository } from '../../storage/memoryRepository';
import { createBackup } from './backup';
import { DataTransferPanel } from './DataTransferPanel';

const session: Session = {
  id: 'session-imported',
  activityId: 'activity-study',
  startedAt: new Date('2026-07-12T23:30:00Z').getTime(),
  endedAt: new Date('2026-07-13T01:15:00Z').getTime(),
  createdAt: new Date('2026-07-12T23:30:00Z').getTime(),
  updatedAt: new Date('2026-07-13T01:15:00Z').getTime(),
};

const entry: EmotionEntry = {
  id: 'entry-imported',
  emotionId: 'emotion-calm',
  intensity: 4,
  comment: 'Quiet, then\n"focused"',
  recordedAt: new Date('2026-07-13T00:30:00Z').getTime(),
  activityId: 'activity-study',
  sessionId: session.id,
  createdAt: new Date('2026-07-13T00:30:00Z').getTime(),
  updatedAt: new Date('2026-07-13T00:30:00Z').getTime(),
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve();
  });
}

function renderPanel(repository: FocusDialRepository = createMemoryRepository()) {
  return {
    repository,
    ...render(
      <RepositoryProvider repository={repository}>
        <DataTransferPanel />
      </RepositoryProvider>,
    ),
  };
}

async function backupFile(name = 'focus-dial.json'): Promise<File> {
  const source = createMemoryRepository({ sessions: [session], emotionEntries: [entry] });
  const json = JSON.stringify(await createBackup(source));
  const file = new File([json], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => json });
  return file;
}

function textFile(contents: string, name: string): File {
  const file = new File([contents], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => contents });
  return file;
}

describe('DataTransferPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('downloads a lossless JSON backup and separate session and emotion CSVs', async () => {
    const user = userEvent.setup();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload(
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    renderPanel(createMemoryRepository({ sessions: [session], emotionEntries: [entry] }));

    await user.click(screen.getByRole('button', { name: 'Download JSON backup' }));
    await user.click(screen.getByRole('button', { name: 'Download session CSV' }));
    await user.click(screen.getByRole('button', { name: 'Download emotion CSV' }));

    expect(downloads).toHaveLength(3);
    expect(downloads[0]).toMatch(/^focus-dial-backup-.*\.json$/);
    expect(downloads[1]).toMatch(/^focus-dial-sessions-.*\.csv$/);
    expect(downloads[2]).toMatch(/^focus-dial-emotions-.*\.csv$/);
  });

  it('shows a count and date preview before enabling additive import', async () => {
    const user = userEvent.setup();
    const { repository } = renderPanel();
    const add = screen.getByRole('button', { name: 'Add new records' });
    const replace = screen.getByRole('button', { name: 'Replace all data' });
    expect(add).toBeDisabled();
    expect(replace).toBeDisabled();

    await user.upload(screen.getByLabelText('Choose a Focus Dial backup'), await backupFile());
    await settle();

    const preview = screen.getByRole('region', { name: 'Import preview' });
    expect(within(preview).getByText('7 activities')).toBeVisible();
    expect(within(preview).getByText('1 session')).toBeVisible();
    expect(within(preview).getByText('8 emotions')).toBeVisible();
    expect(within(preview).getByText('1 emotion entry')).toBeVisible();
    expect(within(preview).getByText('0 goals')).toBeVisible();
    expect(within(preview).getByText('15 existing IDs will be skipped')).toBeVisible();
    expect(within(preview).getAllByRole('time')).toHaveLength(2);
    expect(add).toBeEnabled();
    expect(replace).toBeEnabled();

    await user.click(add);
    await settle();
    expect(await repository.listSessions()).toEqual([session]);
    expect(await repository.listEmotionEntries()).toEqual([entry]);
    expect(screen.getByRole('status')).toHaveTextContent('Added new records from focus-dial.json.');
  });

  it.each([12, 24] as const)('formats import preview dates with the saved %s-hour preference', async (hourCycle) => {
    const user = userEvent.setup();
    const repository = createMemoryRepository({
      preferences: { ...DEFAULT_PREFERENCES, hourCycle },
    });
    renderPanel(repository);

    await user.upload(screen.getByLabelText('Choose a Focus Dial backup'), await backupFile());
    await settle();

    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: hourCycle === 24 ? 'h23' : 'h12',
    }).format(session.startedAt);
    expect(screen.getAllByRole('time')[0]).toHaveTextContent(expected);
  });

  it('shows all validation errors and retains the selected file until explicitly dismissed', async () => {
    const user = userEvent.setup();
    renderPanel();
    const invalid = textFile(JSON.stringify({
      kind: 'focus-dial-backup',
      version: 1,
      exportedAt: 'yesterday',
      activities: {},
      sessions: [],
      emotions: [],
      emotionEntries: [],
      goals: [],
      preferences: null,
    }), 'damaged.json');

    await user.upload(screen.getByLabelText('Choose a Focus Dial backup'), invalid);
    await settle();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('exportedAt must be a timestamp.');
    expect(alert).toHaveTextContent('activities must be an array.');
    expect(alert).toHaveTextContent('preferences must be an object.');
    expect(screen.getByText('Selected: damaged.json')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add new records' })).toBeDisabled();

    await user.click(within(alert).getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Selected: damaged.json')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Dismiss selected file' }));
    expect(screen.queryByText('Selected: damaged.json')).not.toBeInTheDocument();
  });

  it('rejects an out-of-range preview timestamp without throwing a RangeError', async () => {
    const user = userEvent.setup();
    renderPanel();
    const backup = await createBackup(createMemoryRepository({ sessions: [session] }));
    backup.sessions[0] = {
      ...backup.sessions[0]!,
      startedAt: 8_640_000_000_000_001,
      endedAt: 8_640_000_000_000_002,
      createdAt: 8_640_000_000_000_001,
      updatedAt: 8_640_000_000_000_002,
    };

    await user.upload(
      screen.getByLabelText('Choose a Focus Dial backup'),
      textFile(JSON.stringify(backup), 'out-of-range.json'),
    );
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('sessions[0].startedAt must be a timestamp.');
    expect(screen.queryByRole('region', { name: 'Import preview' })).not.toBeInTheDocument();
    expect(screen.getByText('Selected: out-of-range.json')).toBeVisible();
  });

  it('keeps a valid selected file and preview after a storage failure', async () => {
    const user = userEvent.setup();
    const repository = createMemoryRepository();
    renderPanel(repository);
    await user.upload(screen.getByLabelText('Choose a Focus Dial backup'), await backupFile('retry.json'));
    await settle();
    repository.runWrite = async () => { throw new Error('Browser storage is full.'); };

    await user.click(screen.getByRole('button', { name: 'Add new records' }));
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is full.');
    expect(screen.getByText('Selected: retry.json')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Import preview' })).toBeVisible();
  });

  it('keeps import success and committed records when the preview refresh later fails', async () => {
    const user = userEvent.setup();
    const repository = createMemoryRepository();
    const originalListActivities = repository.listActivities.bind(repository);
    let activityLoads = 0;
    let rejectRefresh: ((reason: unknown) => void) | undefined;
    repository.listActivities = async (includeArchived) => {
      activityLoads += 1;
      if (activityLoads === 3) {
        return new Promise((_resolve, reject) => { rejectRefresh = reject; });
      }
      return originalListActivities(includeArchived);
    };
    renderPanel(repository);
    await user.upload(screen.getByLabelText('Choose a Focus Dial backup'), await backupFile('saved.json'));
    await settle();

    await user.click(screen.getByRole('button', { name: 'Add new records' }));
    await settle();

    expect(await repository.listSessions()).toEqual([session]);
    expect(screen.getByRole('status')).toHaveTextContent('Added new records from saved.json.');
    expect(rejectRefresh).toBeTypeOf('function');

    await act(async () => {
      rejectRefresh?.(new Error('Preview storage read failed.'));
      await Promise.resolve();
    });
    await settle();

    expect(await repository.listEmotionEntries()).toEqual([entry]);
    expect(screen.getByRole('status')).toHaveTextContent('Added new records from saved.json.');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Import succeeded, but the preview could not be refreshed. Preview storage read failed.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('backup could not be imported');
    expect(screen.getByText('Selected: saved.json')).toBeVisible();
  });

  it('requires typing DELETE before atomically restoring approved defaults', async () => {
    const user = userEvent.setup();
    const repository = createMemoryRepository({ sessions: [session], emotionEntries: [entry] });
    renderPanel(repository);

    await user.click(screen.getByRole('button', { name: 'Delete local data' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete all local data?' });
    const confirmation = within(dialog).getByLabelText('Type DELETE to confirm');
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete all local data' });
    expect(deleteButton).toBeDisabled();
    await user.type(confirmation, 'delete');
    expect(deleteButton).toBeDisabled();
    await user.clear(confirmation);
    await user.type(confirmation, 'DELETE');
    expect(deleteButton).toBeEnabled();

    await user.click(deleteButton);
    await settle();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await repository.listActivities(true)).toEqual([...DEFAULT_ACTIVITIES]);
    expect(await repository.listSessions()).toEqual([]);
    expect(await repository.listEmotions(true)).toEqual([...DEFAULT_EMOTIONS]);
    expect(await repository.listEmotionEntries()).toEqual([]);
    expect(await repository.listGoals()).toEqual([]);
    expect(await repository.getPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps the global emotion action available from Settings', async () => {
    const user = userEvent.setup();
    render(
      <RepositoryProvider repository={createMemoryRepository()}>
        <App />
      </RepositoryProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await settle();

    expect(screen.getByRole('button', { name: 'How do you feel?' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your data' })).toBeVisible();
  });
});
