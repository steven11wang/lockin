import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RepositoryProvider } from '../../app/RepositoryContext';
import { App } from '../../app/App';
import type { FocusDialRepository, Session } from '../../domain/models';
import { createMemoryRepository } from '../../storage/memoryRepository';
import { TimerService } from '../focus/timerService';
import { EmotionSheet } from './EmotionSheet';

function activeSession(): Session {
  return {
    id: 'active-study',
    activityId: 'activity-study',
    startedAt: 1_000,
    endedAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function settleRepositoryQueries(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

function renderSheet(
  repository: FocusDialRepository,
  onClose: () => void = vi.fn(),
  recordedAt?: number,
) {
  return {
    onClose,
    ...render(
      <RepositoryProvider repository={repository}>
        <EmotionSheet
          open
          onClose={onClose}
          {...(recordedAt === undefined ? {} : { recordedAt })}
        />
      </RepositoryProvider>,
    ),
  };
}

describe('EmotionSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens from Focus, records the save time and active context, and leaves the timer running', async () => {
    const active = activeSession();
    const repository = createMemoryRepository({ sessions: [active] });
    render(
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>,
    );
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'How do you feel?' }));
    await settleRepositoryQueries();
    const dialog = screen.getByRole('dialog', { name: 'How do you feel?' });
    expect(within(dialog).getByRole('radio', { name: 'Calm' })).toBeVisible();
    for (const label of [
      '1 — very mild',
      '2 — mild',
      '3 — moderate',
      '4 — strong',
      '5 — very strong',
    ]) {
      expect(within(dialog).getByRole('radio', { name: label })).toBeVisible();
    }

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Calm' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '4 — strong' }));
    fireEvent.change(within(dialog).getByLabelText('Comment (optional)'), {
      target: { value: '  Quiet focus\nwith steady progress  ' },
    });
    vi.setSystemTime(15_000);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save check-in' }));
    await settleRepositoryQueries();

    expect(await repository.listEmotionEntries()).toEqual([
      expect.objectContaining({
        emotionId: 'emotion-calm',
        intensity: 4,
        comment: 'Quiet focus\nwith steady progress',
        recordedAt: 15_000,
        activityId: active.activityId,
        sessionId: active.id,
      }),
    ]);
    expect(await repository.getActiveSession()).toEqual(active);
  });

  it('requires an emotion and can save with no active timer', async () => {
    const repository = createMemoryRepository();
    renderSheet(repository, vi.fn(), 20_000);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an emotion');
    expect(await repository.listEmotionEntries()).toEqual([]);

    fireEvent.click(screen.getByRole('radio', { name: 'Happy' }));
    fireEvent.click(screen.getByRole('radio', { name: '2 — mild' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await settleRepositoryQueries();

    expect(await repository.listEmotionEntries()).toEqual([
      expect.objectContaining({
        recordedAt: 20_000,
        activityId: null,
        sessionId: null,
      }),
    ]);
  });

  it('closes on Cancel and Escape without saving and restores focus to the invoker', async () => {
    const repository = createMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>,
    );
    await settleRepositoryQueries();
    const invoker = screen.getByRole('button', { name: 'How do you feel?' });

    invoker.focus();
    fireEvent.click(invoker);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel check-in' }));
    expect(invoker).toHaveFocus();
    expect(await repository.listEmotionEntries()).toEqual([]);

    fireEvent.click(invoker);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'How do you feel?' }), { key: 'Escape' });
    expect(invoker).toHaveFocus();
    expect(await repository.listEmotionEntries()).toEqual([]);
  });

  it('does not link a session that began after the saved timestamp', async () => {
    const future = { ...activeSession(), startedAt: 11_000, createdAt: 11_000, updatedAt: 11_000 };
    const repository = createMemoryRepository({ sessions: [future] });
    renderSheet(repository, vi.fn(), 10_000);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('radio', { name: 'Calm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await settleRepositoryQueries();

    expect(await repository.listEmotionEntries()).toEqual([
      expect.objectContaining({ activityId: null, sessionId: null }),
    ]);
    expect(await repository.getActiveSession()).toEqual(future);
  });

  it('atomically links the session covering savedAt across an in-flight switch', async () => {
    const original = activeSession();
    const repository = createMemoryRepository({ sessions: [original] });
    const switchReachedBoundary = deferred();
    const finishSwitch = deferred();
    const putSession = repository.putSession.bind(repository);
    repository.putSession = async (session) => {
      await putSession(session);
      if (session.id === original.id && session.endedAt === 9_000) {
        switchReachedBoundary.resolve();
        await finishSwitch.promise;
      }
    };
    const timer = new TimerService(repository, () => 'exercise-session');
    const switchPromise = timer.switchTo('activity-exercise', 9_000);
    await switchReachedBoundary.promise;

    renderSheet(repository);
    await settleRepositoryQueries();
    fireEvent.click(screen.getByRole('radio', { name: 'Focused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await settleRepositoryQueries();
    finishSwitch.resolve();
    await act(async () => {
      await switchPromise;
      for (let step = 0; step < 8; step += 1) await Promise.resolve();
    });

    expect(await repository.listEmotionEntries()).toEqual([
      expect.objectContaining({
        recordedAt: 10_000,
        activityId: 'activity-exercise',
        sessionId: 'exercise-session',
      }),
    ]);
    expect(await repository.getActiveSession()).toMatchObject({
      id: 'exercise-session',
      activityId: 'activity-exercise',
      startedAt: 9_000,
      endedAt: null,
    });
  });

  it('does not retain stale activity linkage across an in-flight pause', async () => {
    vi.useRealTimers();
    const original = activeSession();
    const repository = createMemoryRepository({ sessions: [original] });
    const pauseReachedBoundary = deferred();
    const finishPause = deferred();
    const emotionWriteQueued = deferred();
    const putSession = repository.putSession.bind(repository);
    repository.putSession = async (session) => {
      if (session.id === original.id && session.endedAt === 9_000) {
        pauseReachedBoundary.resolve();
        await finishPause.promise;
      }
      await putSession(session);
    };
    const runWrite = repository.runWrite.bind(repository);
    let writeCount = 0;
    repository.runWrite = (operation) => {
      writeCount += 1;
      if (writeCount === 2) emotionWriteQueued.resolve();
      return runWrite(operation);
    };
    const timer = new TimerService(repository);
    const pausePromise = timer.pause(9_000);
    await pauseReachedBoundary.promise;
    const saveCompleted = deferred();

    renderSheet(repository, saveCompleted.resolve, 10_000);
    fireEvent.click(await screen.findByRole('radio', { name: 'Focused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await emotionWriteQueued.promise;
    await act(async () => {
      finishPause.resolve();
      await Promise.all([pausePromise, saveCompleted.promise]);
    });

    expect(await repository.listEmotionEntries()).toEqual([
      expect.objectContaining({
        recordedAt: 10_000,
        activityId: null,
        sessionId: null,
      }),
    ]);
    expect(await repository.getActiveSession()).toBeUndefined();
    expect(await repository.getPreferences()).toMatchObject({
      lastPausedActivityId: 'activity-study',
    });
  });

  it('ignores Cancel and Escape while a save write is in flight', async () => {
    const repository = createMemoryRepository();
    const writeStarted = deferred();
    const finishWrite = deferred();
    const putEmotionEntry = repository.putEmotionEntry.bind(repository);
    repository.putEmotionEntry = async (entry) => {
      writeStarted.resolve();
      await finishWrite.promise;
      await putEmotionEntry(entry);
    };
    const onClose = vi.fn();
    renderSheet(repository, onClose);
    await settleRepositoryQueries();
    fireEvent.click(screen.getByRole('radio', { name: 'Happy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await writeStarted.promise;

    const dialog = screen.getByRole('dialog', { name: 'How do you feel?' });
    expect(screen.getByRole('button', { name: 'Cancel check-in' })).toBeDisabled();
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    finishWrite.resolve();
    await settleRepositoryQueries();
    expect(onClose).toHaveBeenCalledOnce();
    expect(await repository.listEmotionEntries()).toHaveLength(1);
  });
});
