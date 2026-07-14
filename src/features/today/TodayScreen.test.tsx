import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RepositoryProvider } from '../../app/RepositoryContext';
import type { EmotionEntry, FocusDialRepository, Goal, Session } from '../../domain/models';
import { createMemoryRepository } from '../../storage/memoryRepository';
import { TodayScreen } from './TodayScreen';

const DAY = new Date(2026, 6, 13);

function at(hour: number, minute = 0): number {
  return new Date(2026, 6, 13, hour, minute).getTime();
}

function session(
  id: string,
  activityId: string,
  startHour: number,
  endHour: number | null,
  startMinute = 0,
  endMinute = 0,
): Session {
  const startedAt = at(startHour, startMinute);
  return {
    id,
    activityId,
    startedAt,
    endedAt: endHour === null ? null : at(endHour, endMinute),
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

function emotionEntry(
  id: string,
  emotionId: string,
  intensity: EmotionEntry['intensity'],
  recordedAt: number,
  comment: string,
  activityId: string | null = null,
  sessionId: string | null = null,
): EmotionEntry {
  return {
    id,
    emotionId,
    intensity,
    comment,
    recordedAt,
    activityId,
    sessionId,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  };
}

function renderToday(repository: FocusDialRepository) {
  return render(
    <RepositoryProvider repository={repository}>
      <TodayScreen date={DAY} />
    </RepositoryProvider>,
  );
}

async function settleRepositoryQueries(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

function changeDateTime(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('TodayScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows chronological rows with tracked, activity, and internal-gap totals', async () => {
    const repository = createMemoryRepository({
      sessions: [
        session('work', 'activity-work', 11, null, 30),
        session('exercise', 'activity-exercise', 10, 11),
        session('study', 'activity-study', 8, 9),
      ],
    });
    renderToday(repository);
    await settleRepositoryQueries();

    const rows = within(screen.getByRole('list', { name: 'Daily timeline' })).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('heading').textContent)).toEqual([
      'Study',
      'Exercise',
      'Work',
    ]);
    expect(screen.getByLabelText('Tracked')).toHaveTextContent('2h 30m');
    expect(screen.getByLabelText('Untracked')).toHaveTextContent('1h 30m');
    expect(screen.getByLabelText('Study total')).toHaveTextContent('1h');
    expect(screen.getByLabelText('Exercise total')).toHaveTextContent('1h');
    expect(screen.getByLabelText('Work total')).toHaveTextContent('30m');
  });

  it('includes enabled daily and weekly minimum and maximum progress in the daily summary', async () => {
    const goals: Goal[] = [
      {
        id: 'daily-maximum',
        activityId: 'activity-study',
        period: 'daily',
        direction: 'maximum',
        targetMinutes: 30,
        enabled: true,
      },
      {
        id: 'weekly-minimum',
        activityId: 'activity-study',
        period: 'weekly',
        direction: 'minimum',
        targetMinutes: 120,
        enabled: true,
      },
      {
        id: 'disabled',
        activityId: 'activity-study',
        period: 'daily',
        direction: 'minimum',
        targetMinutes: 10,
        enabled: false,
      },
    ];
    const repository = createMemoryRepository({
      goals,
      sessions: [session('study', 'activity-study', 8, 9)],
    });
    renderToday(repository);
    await settleRepositoryQueries();

    const progress = screen.getByRole('list', { name: 'Goal progress' });
    expect(progress).toHaveTextContent('Study daily maximum');
    expect(progress).toHaveTextContent('60 of 30 minutes');
    expect(progress).toHaveTextContent('30 minutes over this period’s limit');
    expect(progress).toHaveTextContent('Study weekly minimum');
    expect(progress).toHaveTextContent('60 of 120 minutes');
    expect(progress).toHaveTextContent('60 minutes remaining');
    expect(progress).not.toHaveTextContent('10 minutes remaining');
  });

  it('opens a gap editor with the gap times prefilled', async () => {
    const repository = createMemoryRepository({
      sessions: [
        session('study', 'activity-study', 8, 9),
        session('exercise', 'activity-exercise', 10, 11),
      ],
    });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: /Fill gap/ }));

    expect(screen.getByLabelText('Start')).toHaveValue('2026-07-13T09:00');
    expect(screen.getByLabelText('End')).toHaveValue('2026-07-13T10:00');
  });

  it('shows untracked time only between the first and last session or emotion event', async () => {
    const repository = createMemoryRepository({
      sessions: [session('study', 'activity-study', 9, 10)],
      emotionEntries: [
        emotionEntry('before', 'emotion-calm', 3, at(8), ''),
        emotionEntry('after', 'emotion-focused', 4, at(11), ''),
      ],
    });
    renderToday(repository);
    await settleRepositoryQueries();

    expect(screen.getByLabelText('Untracked')).toHaveTextContent('2h');
    const gaps = screen.getByRole('region', { name: 'Untracked gaps' });
    expect(within(gaps).getAllByRole('button', { name: /Fill gap/ })).toHaveLength(2);
    expect(gaps).toHaveTextContent('8:00 AM – 9:00 AM');
    expect(gaps).toHaveTextContent('10:00 AM – 11:00 AM');
    expect(gaps).not.toHaveTextContent('12:00 AM');
    expect(gaps).not.toHaveTextContent('12:00 PM');
  });

  it('creates a valid manual entry', async () => {
    const repository = createMemoryRepository();
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'activity-eat' } });
    changeDateTime('Start', '2026-07-13T07:00');
    changeDateTime('End', '2026-07-13T07:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await settleRepositoryQueries();

    expect(await repository.listSessions()).toEqual([
      expect.objectContaining({
        activityId: 'activity-eat',
        startedAt: at(7),
        endedAt: at(7, 30),
      }),
    ]);
    expect(screen.getByRole('heading', { name: 'Eat' })).toBeVisible();
  });

  it('rejects a non-positive edit and preserves every form value', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const repository = createMemoryRepository({ sessions: [study] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Study' }));
    fireEvent.change(screen.getByLabelText('Activity'), { target: { value: 'activity-social' } });
    changeDateTime('Start', '2026-07-13T09:30');
    changeDateTime('End', '2026-07-13T09:00');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    expect(screen.getByRole('alert')).toHaveTextContent('End must be after start');
    expect(screen.getByLabelText('Activity')).toHaveValue('activity-social');
    expect(screen.getByLabelText('Start')).toHaveValue('2026-07-13T09:30');
    expect(screen.getByLabelText('End')).toHaveValue('2026-07-13T09:00');
    expect(await repository.getSession(study.id)).toEqual(study);
  });

  it('waits for an explicit choice before trimming a neighbor in the same write', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const exercise = session('exercise', 'activity-exercise', 10, 11);
    const repository = createMemoryRepository({ sessions: [study, exercise] });
    const write = vi.spyOn(repository, 'runWrite');
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Study' }));
    changeDateTime('End', '2026-07-13T10:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    const dialog = screen.getByRole('dialog', { name: 'Resolve overlap' });
    expect(dialog).toHaveTextContent('Study');
    expect(dialog).toHaveTextContent('Exercise');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Shorten this entry' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Trim neighboring entry' })).toBeVisible();
    expect(await repository.getSession(exercise.id)).toEqual(exercise);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Trim neighboring entry' }));
    await settleRepositoryQueries();

    expect(write).toHaveBeenCalledTimes(1);
    expect(await repository.getSession(study.id)).toMatchObject({ endedAt: at(10, 30) });
    expect(await repository.getSession(exercise.id)).toMatchObject({ startedAt: at(10, 30) });
    expect(document.querySelector('.today-header')).not.toHaveAttribute('inert');
    expect(document.querySelector('.today-header')).not.toHaveAttribute('aria-hidden');
  });

  it('deletes an entry and offers temporary Undo', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const repository = createMemoryRepository({ sessions: [study] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Study' }));
    await settleRepositoryQueries();
    expect(await repository.getSession(study.id)).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await settleRepositoryQueries();
    expect(await repository.getSession(study.id)).toEqual(study);
  });

  it('undoes an edit and restores both the entry and trimmed neighbor', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const exercise = session('exercise', 'activity-exercise', 10, 11);
    const repository = createMemoryRepository({ sessions: [study, exercise] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Study' }));
    changeDateTime('End', '2026-07-13T10:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trim neighboring entry' }));
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    await settleRepositoryQueries();
    expect(await repository.getSession(study.id)).toEqual(study);
    expect(await repository.getSession(exercise.id)).toEqual(exercise);
  });

  it('rejects a future start for an active session and preserves the input', async () => {
    const active = session('work', 'activity-work', 11, null);
    const repository = createMemoryRepository({ sessions: [active] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Work' }));
    expect(screen.queryByLabelText('End')).not.toBeInTheDocument();
    changeDateTime('Start', '2026-07-13T12:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Active start cannot be in the future');
    expect(screen.getByLabelText('Start')).toHaveValue('2026-07-13T12:30');
    expect(await repository.getSession(active.id)).toEqual(active);
  });

  it('edits an active session start without ending the active session', async () => {
    const active = session('work', 'activity-work', 11, null);
    const repository = createMemoryRepository({ sessions: [active] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Work' }));
    changeDateTime('Start', '2026-07-13T10:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    await settleRepositoryQueries();

    expect(await repository.getSession(active.id)).toMatchObject({
      startedAt: at(10, 30),
      endedAt: null,
    });
    expect(await repository.getActiveSession()).toMatchObject({ id: active.id, endedAt: null });
  });

  it('rejects shortening an active conflict and mutates no repository record', async () => {
    const exercise = session('exercise', 'activity-exercise', 10, 11);
    const active = session('work', 'activity-work', 11, null);
    const repository = createMemoryRepository({ sessions: [exercise, active] });
    const write = vi.spyOn(repository, 'runWrite');
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Work' }));
    changeDateTime('Start', '2026-07-13T09:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Shorten this entry' }));

    expect(screen.getByRole('alert')).toHaveTextContent('active entry must stay open');
    expect(write).not.toHaveBeenCalled();
    expect(await repository.getSession(exercise.id)).toEqual(exercise);
    expect(await repository.getSession(active.id)).toEqual(active);
  });

  it('trims a previous neighbor while preserving an active candidate', async () => {
    const study = session('study', 'activity-study', 9, 10);
    const active = session('work', 'activity-work', 11, null);
    const repository = createMemoryRepository({ sessions: [study, active] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Work' }));
    changeDateTime('Start', '2026-07-13T09:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trim neighboring entry' }));
    await settleRepositoryQueries();

    expect(await repository.getSession(study.id)).toMatchObject({ endedAt: at(9, 30) });
    expect(await repository.getSession(active.id)).toMatchObject({
      startedAt: at(9, 30),
      endedAt: null,
    });
    expect(await repository.getActiveSession()).toMatchObject({ id: active.id, endedAt: null });
  });

  it('rejects trimming a future neighbor around an active candidate and mutates nothing', async () => {
    const exercise = session('exercise', 'activity-exercise', 10, 11);
    const active = session('work', 'activity-work', 11, null);
    const repository = createMemoryRepository({ sessions: [exercise, active] });
    const write = vi.spyOn(repository, 'runWrite');
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Work' }));
    changeDateTime('Start', '2026-07-13T09:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trim neighboring entry' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'future neighboring entry cannot be trimmed while this entry stays active',
    );
    expect(write).not.toHaveBeenCalled();
    expect(await repository.getSession(exercise.id)).toEqual(exercise);
    expect(await repository.getSession(active.id)).toEqual(active);
  });

  it('hides and inerts the editor under a conflict, then restores focus when cancelled', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const exercise = session('exercise', 'activity-exercise', 10, 11);
    const repository = createMemoryRepository({ sessions: [study, exercise] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Study' }));
    changeDateTime('End', '2026-07-13T10:30');
    const saveButton = screen.getByRole('button', { name: 'Save entry' });
    saveButton.focus();
    fireEvent.click(saveButton);

    const hiddenEditor = screen.getByRole('dialog', { name: 'Edit entry', hidden: true });
    const editorLayer = hiddenEditor.closest('.session-editor__backdrop');
    expect(editorLayer).toHaveAttribute('inert');
    expect(editorLayer).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('dialog', { name: 'Resolve overlap' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('dialog', { name: 'Edit entry' })).toBeVisible();
    expect(saveButton).toHaveFocus();
  });

  it('expires the temporary Undo action after ten seconds', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const repository = createMemoryRepository({ sessions: [study] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Study' }));
    await settleRepositoryQueries();
    expect(screen.getByRole('button', { name: 'Undo delete' })).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.queryByRole('button', { name: 'Undo delete' })).not.toBeInTheDocument();
  });

  it('integrates emotion markers chronologically and reveals linked details', async () => {
    const study = session('study', 'activity-study', 8, 9);
    const work = session('work', 'activity-work', 11, 12);
    const repository = createMemoryRepository({
      sessions: [work, study],
      emotionEntries: [
        emotionEntry(
          'calm-four',
          'emotion-calm',
          4,
          at(9, 15),
          'Quiet progress',
          study.activityId,
          study.id,
        ),
        emotionEntry('calm-two', 'emotion-calm', 2, at(10, 30), 'Settled'),
      ],
    });
    renderToday(repository);
    await settleRepositoryQueries();

    const timeline = screen.getByRole('list', { name: 'Daily timeline' });
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Study'),
      expect.stringContaining('Calm'),
      expect.stringContaining('Calm'),
      expect.stringContaining('Work'),
    ]);
    const marker = within(timeline).getByRole('button', {
      name: 'Calm, intensity 4, 9:15 AM',
    });
    fireEvent.click(marker);
    expect(within(marker.closest('li')!).getByText('Quiet progress')).toBeVisible();
    expect(within(marker.closest('li')!).getByText('Study')).toBeVisible();
    expect(screen.getByLabelText('Calm count')).toHaveTextContent('2');
    expect(screen.getByLabelText('Calm intensity range')).toHaveTextContent('2–4');
    expect(screen.queryByLabelText(/mood score/i)).not.toBeInTheDocument();
  });

  it('filters emotion markers by comment case-insensitively', async () => {
    const repository = createMemoryRepository({
      emotionEntries: [
        emotionEntry('calm', 'emotion-calm', 4, at(9), 'Quiet Progress'),
        emotionEntry('tired', 'emotion-tired', 3, at(10), 'Need a walk'),
      ],
    });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.change(screen.getByLabelText('Search emotion comments'), {
      target: { value: 'PROGRESS' },
    });

    expect(screen.getByRole('button', { name: 'Calm, intensity 4, 9:00 AM' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Tired, intensity 3, 10:00 AM' })).not.toBeInTheDocument();
  });

  it('edits and deletes an emotion marker with temporary Undo', async () => {
    const original = emotionEntry(
      'calm',
      'emotion-calm',
      4,
      at(9),
      'Quiet progress',
      'activity-study',
      'study',
    );
    const repository = createMemoryRepository({ emotionEntries: [original] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Calm, intensity 4, 9:00 AM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Calm check-in' }));
    fireEvent.click(screen.getByRole('radio', { name: '5 — very strong' }));
    fireEvent.change(screen.getByLabelText('Comment (optional)'), {
      target: { value: 'Very settled' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await settleRepositoryQueries();
    expect(await repository.listEmotionEntries()).toEqual([
      { ...original, intensity: 5, comment: 'Very settled', updatedAt: at(12) },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }));
    await settleRepositoryQueries();
    expect(await repository.listEmotionEntries()).toEqual([original]);

    fireEvent.click(screen.getByRole('button', { name: 'Calm, intensity 4, 9:00 AM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Calm check-in' }));
    await settleRepositoryQueries();
    expect(await repository.listEmotionEntries()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await settleRepositoryQueries();
    expect(await repository.listEmotionEntries()).toEqual([original]);
  });

  it('restores focus to the surviving marker after an edit save', async () => {
    const original = emotionEntry('calm', 'emotion-calm', 4, at(9), 'Quiet progress');
    const repository = createMemoryRepository({ emotionEntries: [original] });
    renderToday(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Calm, intensity 4, 9:00 AM' }));
    const editButton = screen.getByRole('button', { name: 'Edit Calm check-in' });
    editButton.focus();
    fireEvent.click(editButton);
    fireEvent.click(screen.getByRole('radio', { name: '5 — very strong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));
    await settleRepositoryQueries();

    expect(screen.getByRole('button', {
      name: 'Calm, intensity 5, 9:00 AM',
    })).toHaveFocus();
  });
});
