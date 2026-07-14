import { act, fireEvent, render, screen } from '@testing-library/react';
import { RepositoryProvider } from '../../app/RepositoryContext';
import type { FocusDialRepository, Goal, Session } from '../../domain/models';
import { createMemoryRepository } from '../../storage/memoryRepository';
import { FocusScreen } from './FocusScreen';

const STUDY_ID = 'activity-study';
const EXERCISE_ID = 'activity-exercise';
const WORK_ID = 'activity-work';

function activeSession(activityId: string, startedAt: number): Session {
  return {
    id: `session-${activityId}`,
    activityId,
    startedAt,
    endedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

function renderFocus(repository: FocusDialRepository) {
  return render(
    <RepositoryProvider repository={repository}>
      <FocusScreen />
    </RepositoryProvider>,
  );
}

async function settleRepositoryQueries(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

describe('FocusScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts Study in one click, avoids duplicates, and switches to Exercise without a gap', async () => {
    const repository = createMemoryRepository();
    renderFocus(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    await settleRepositoryQueries();
    expect(await repository.getActiveSession()).toMatchObject({
      activityId: STUDY_ID,
      startedAt: 10_000,
    });

    vi.setSystemTime(15_000);
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    await settleRepositoryQueries();
    expect(await repository.listSessions()).toHaveLength(1);

    vi.setSystemTime(25_000);
    fireEvent.click(screen.getByRole('button', { name: 'Exercise' }));
    await settleRepositoryQueries();
    expect(await repository.getActiveSession()).toMatchObject({
      activityId: EXERCISE_ID,
      startedAt: 25_000,
    });
    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.endedAt).toBe(25_000);
    expect(sessions[1]?.startedAt).toBe(25_000);
  });

  it('serializes rapid same-activity clicks so only one Study session starts', async () => {
    const repository = createMemoryRepository();
    renderFocus(repository);
    await settleRepositoryQueries();
    const study = screen.getByRole('button', { name: 'Study' });

    fireEvent.click(study);
    fireEvent.click(study);
    await settleRepositoryQueries();

    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions.filter((session) => session.endedAt === null)).toHaveLength(1);
    expect(await repository.getActiveSession()).toMatchObject({ activityId: STUDY_ID });
  });

  it('serializes rapid Study then Exercise clicks and keeps a coherent undo', async () => {
    const repository = createMemoryRepository();
    renderFocus(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exercise' }));
    await settleRepositoryQueries();

    const sessions = await repository.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.endedAt === null)).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      activityId: STUDY_ID,
      startedAt: 10_000,
      endedAt: 10_001,
    });
    expect(sessions[1]).toMatchObject({
      activityId: EXERCISE_ID,
      startedAt: 10_001,
      endedAt: null,
    });
    expect(await repository.getActiveSession()).toMatchObject({ activityId: EXERCISE_ID });
    expect(screen.getByRole('heading', { name: 'Exercise' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Undo switch' }));
    await settleRepositoryQueries();
    expect(await repository.getActiveSession()).toMatchObject({
      activityId: STUDY_ID,
      startedAt: 10_000,
      endedAt: null,
    });
    expect(await repository.listSessions()).toHaveLength(1);
  });

  it('keeps the latest Work undo when an obsolete Exercise undo is already queued', async () => {
    const repository = createMemoryRepository({ sessions: [activeSession(STUDY_ID, 1_000)] });
    renderFocus(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Exercise' }));
    await settleRepositoryQueries();
    expect(await repository.getActiveSession()).toMatchObject({ activityId: EXERCISE_ID });
    const obsoleteUndo = screen.getByRole('button', { name: 'Undo switch' });

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    fireEvent.click(obsoleteUndo);
    await settleRepositoryQueries();

    expect(await repository.getActiveSession()).toMatchObject({ activityId: WORK_ID });
    expect((await repository.listSessions()).filter((session) => session.endedAt === null)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Work' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo switch' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Undo switch' }));
    await settleRepositoryQueries();
    expect(await repository.getActiveSession()).toMatchObject({
      activityId: EXERCISE_ID,
      startedAt: 10_000,
      endedAt: null,
    });
    expect((await repository.listSessions()).filter((session) => session.endedAt === null)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Exercise' })).toBeVisible();
  });

  it('derives the elapsed display from the active session startedAt', async () => {
    vi.setSystemTime(70_999);
    const repository = createMemoryRepository({ sessions: [activeSession(STUDY_ID, 10_000)] });
    renderFocus(repository);
    await settleRepositoryQueries();

    expect(screen.getByRole('timer')).toHaveTextContent('00:01:00');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByRole('timer')).toHaveTextContent('00:01:01');
  });

  it('shows enabled daily and weekly goal progress for the active activity and keeps it live', async () => {
    const now = new Date(2026, 6, 13, 12).getTime();
    vi.setSystemTime(now);
    const goals: Goal[] = [
      {
        id: 'daily-minimum',
        activityId: STUDY_ID,
        period: 'daily',
        direction: 'minimum',
        targetMinutes: 60,
        enabled: true,
      },
      {
        id: 'weekly-maximum',
        activityId: STUDY_ID,
        period: 'weekly',
        direction: 'maximum',
        targetMinutes: 20,
        enabled: true,
      },
      {
        id: 'disabled',
        activityId: STUDY_ID,
        period: 'daily',
        direction: 'minimum',
        targetMinutes: 1,
        enabled: false,
      },
    ];
    const repository = createMemoryRepository({
      goals,
      sessions: [activeSession(STUDY_ID, now - 30 * 60_000)],
    });
    renderFocus(repository);
    await settleRepositoryQueries();

    const progress = screen.getByRole('region', { name: 'Current activity goals' });
    expect(progress).toHaveTextContent('Daily minimum');
    expect(progress).toHaveTextContent('30 of 60 minutes');
    expect(progress).toHaveTextContent('30 minutes remaining');
    expect(progress).toHaveTextContent('Weekly maximum');
    expect(progress).toHaveTextContent('10 minutes over this period’s limit');
    expect(progress).not.toHaveTextContent('1 minute');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(progress).toHaveTextContent('31 of 60 minutes');
    expect(progress).toHaveTextContent('29 minutes remaining');
    expect(progress).toHaveTextContent('11 minutes over this period’s limit');
  });

  it('offers Resume Study after pause and clears the suggestion after stop', async () => {
    const repository = createMemoryRepository({ sessions: [activeSession(STUDY_ID, 1_000)] });
    renderFocus(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await settleRepositoryQueries();
    expect(screen.getByRole('button', { name: 'Resume Study' })).toBeVisible();
    expect(await repository.getActiveSession()).toBeUndefined();
    expect(await repository.getPreferences()).toMatchObject({ lastPausedActivityId: STUDY_ID });

    vi.setSystemTime(20_000);
    fireEvent.click(screen.getByRole('button', { name: 'Resume Study' }));
    await settleRepositoryQueries();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeVisible();

    vi.setSystemTime(30_000);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settleRepositoryQueries();
    expect(screen.queryByRole('button', { name: 'Resume Study' })).not.toBeInTheDocument();
    expect(await repository.getActiveSession()).toBeUndefined();
    expect(await repository.getPreferences()).toMatchObject({ lastPausedActivityId: null });
  });

  it('undoes a switch to restore the previous active activity for ten seconds', async () => {
    const study = activeSession(STUDY_ID, 1_000);
    const repository = createMemoryRepository({ sessions: [study] });
    renderFocus(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Exercise' }));
    await settleRepositoryQueries();
    expect(screen.getByRole('heading', { name: 'Exercise' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo switch' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Undo switch' }));
    await settleRepositoryQueries();
    expect(screen.getByRole('heading', { name: 'Study' })).toBeVisible();
    expect(await repository.getActiveSession()).toEqual(study);

    vi.setSystemTime(20_000);
    fireEvent.click(screen.getByRole('button', { name: 'Exercise' }));
    await settleRepositoryQueries();
    expect(screen.getByRole('button', { name: 'Undo switch' })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByRole('button', { name: 'Undo switch' })).not.toBeInTheDocument();
  });

  it('leaves the persistent emotion action to the app shell', async () => {
    renderFocus(createMemoryRepository());
    await settleRepositoryQueries();

    expect(screen.queryByRole('button', { name: 'How do you feel?' })).not.toBeInTheDocument();
  });
});
