import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { App } from '../../app/App';
import { RepositoryProvider } from '../../app/RepositoryContext';
import { DEFAULT_PREFERENCES } from '../../domain/defaults';
import type {
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Preferences,
  Session,
} from '../../domain/models';
import { createDexieRepository } from '../../storage/dexieRepository';
import { createMemoryRepository } from '../../storage/memoryRepository';
import { TodayScreen } from '../today/TodayScreen';
import { WeekScreen } from '../week/WeekScreen';
import {
  SettingsScreen,
  archiveActivity,
  archiveEmotion,
  assignQuickSlot,
  saveGoal,
} from './SettingsScreen';

async function settleRepositoryQueries(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve();
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

interface PreferenceWriteControl {
  started: Promise<void>;
  release: () => void;
  completed: Promise<void>;
}

function controlPreferenceWrites(
  repository: FocusDialRepository,
  outcomes: readonly ('success' | 'failure')[],
): { writes: PreferenceWriteControl[]; startedOrder: number[]; startedValues: boolean[] } {
  const putPreferences = repository.putPreferences.bind(repository);
  const startedOrder: number[] = [];
  const startedValues: boolean[] = [];
  const controls = outcomes.map((outcome) => ({
    outcome,
    started: deferred(),
    release: deferred(),
    completed: deferred(),
  }));
  let writeIndex = 0;
  repository.putPreferences = async (preferences) => {
    const index = writeIndex;
    const control = controls[index];
    if (control === undefined) throw new Error(`Unexpected preference write ${index + 1}.`);
    writeIndex += 1;
    startedOrder.push(index);
    startedValues.push(preferences.reducedMotion);
    control.started.resolve();
    try {
      await control.release.promise;
      if (control.outcome === 'failure') throw new Error(`Preference write ${index + 1} failed.`);
      await putPreferences(preferences);
    } finally {
      control.completed.resolve();
    }
  };

  return {
    writes: controls.map((control) => ({
      started: control.started.promise,
      release: control.release.resolve,
      completed: control.completed.promise,
    })),
    startedOrder,
    startedValues,
  };
}

function renderSettings(repository: FocusDialRepository = createMemoryRepository()) {
  return {
    repository,
    ...render(
      <RepositoryProvider repository={repository}>
        <SettingsScreen />
      </RepositoryProvider>,
    ),
  };
}

function completedSession(activityId: string): Session {
  return {
    id: 'session-history',
    activityId,
    startedAt: new Date(2026, 6, 13, 13, 5).getTime(),
    endedAt: new Date(2026, 6, 13, 14, 5).getTime(),
    createdAt: new Date(2026, 6, 13, 13, 5).getTime(),
    updatedAt: new Date(2026, 6, 13, 14, 5).getTime(),
  };
}

describe('settings mutation helpers', () => {
  it('replaces a quick-slot owner atomically while preserving all four occupied slots', async () => {
    const repository = createMemoryRepository();
    const write = vi.spyOn(repository, 'runWrite');

    await assignQuickSlot(repository, 'activity-eat', 1);

    expect(write).toHaveBeenCalledTimes(1);
    const activities = await repository.listActivities();
    expect(activities.find(({ id }) => id === 'activity-study')?.quickSlot).toBeNull();
    expect(activities.find(({ id }) => id === 'activity-eat')?.quickSlot).toBe(1);
    expect(activities.filter(({ quickSlot }) => quickSlot === 1)).toHaveLength(1);
    expect(activities.filter(({ quickSlot }) => quickSlot !== null)).toHaveLength(4);
    expect(activities.flatMap(({ quickSlot }) => quickSlot ?? []).sort()).toEqual([1, 2, 3, 4]);
  });

  it('atomically swaps two current quick owners when one moves to the other slot', async () => {
    const repository = createMemoryRepository();
    const write = vi.spyOn(repository, 'runWrite');

    await assignQuickSlot(repository, 'activity-study', 2);

    expect(write).toHaveBeenCalledTimes(1);
    const activities = await repository.listActivities();
    expect(activities.find(({ id }) => id === 'activity-study')?.quickSlot).toBe(2);
    expect(activities.find(({ id }) => id === 'activity-exercise')?.quickSlot).toBe(1);
    expect(activities.filter(({ quickSlot }) => quickSlot !== null)).toHaveLength(4);
  });

  it.each([null, 0, 5, Number.NaN])('rejects invalid runtime quick slot %s before a write', async (slot) => {
    const repository = createMemoryRepository();
    const before = await repository.listActivities(true);
    const write = vi.spyOn(repository, 'runWrite');

    await expect(assignQuickSlot(
      repository,
      'activity-eat',
      slot as Parameters<typeof assignQuickSlot>[2],
    )).rejects.toThrow('Quick slot must be 1, 2, 3, or 4.');

    expect(write).not.toHaveBeenCalled();
    expect(await repository.listActivities(true)).toEqual(before);
  });

  it('requires active quick owners to be reassigned before archive and retains history', async () => {
    const active: Session = { ...completedSession('activity-study'), id: 'active', endedAt: null };
    const history = completedSession('activity-study');
    const repository = createMemoryRepository({ sessions: [active, history] });

    await expect(archiveActivity(repository, 'activity-study', 1234)).rejects.toThrow(
      'Stop the active activity before archiving it.',
    );
    expect((await repository.listActivities())[0]?.archivedAt).toBeNull();

    await repository.runWrite(() => repository.putSession({ ...active, endedAt: 2000 }));
    await expect(archiveActivity(repository, 'activity-study', 5678)).rejects.toThrow(
      'Assign another activity to quick slot 1 before archiving Study.',
    );
    await assignQuickSlot(repository, 'activity-eat', 1);
    await archiveActivity(repository, 'activity-study', 5678);

    expect((await repository.listActivities()).some(({ id }) => id === 'activity-study')).toBe(false);
    expect((await repository.listActivities(true)).find(({ id }) => id === 'activity-study'))
      .toMatchObject({ name: 'Study', archivedAt: 5678, quickSlot: null });
    expect((await repository.listSessions()).map(({ activityId }) => activityId)).toEqual([
      'activity-study',
      'activity-study',
    ]);
  });

  it('archives an emotion without deleting its historical check-ins', async () => {
    const entry: EmotionEntry = {
      id: 'entry-happy',
      emotionId: 'emotion-happy',
      intensity: 4,
      comment: 'Good day',
      recordedAt: 100,
      activityId: null,
      sessionId: null,
      createdAt: 100,
      updatedAt: 100,
    };
    const repository = createMemoryRepository({ emotionEntries: [entry] });

    await archiveEmotion(repository, 'emotion-happy', 4321);

    expect((await repository.listEmotions()).some(({ id }) => id === 'emotion-happy')).toBe(false);
    expect((await repository.listEmotions(true)).find(({ id }) => id === 'emotion-happy'))
      .toMatchObject({ name: 'Happy', archivedAt: 4321 });
    expect(await repository.listEmotionEntries()).toEqual([entry]);
  });

  it.each([
    ['daily', 'minimum'],
    ['daily', 'maximum'],
    ['weekly', 'minimum'],
    ['weekly', 'maximum'],
  ] as const)('saves a %s %s goal from whole hours and minutes', async (period, direction) => {
    const repository = createMemoryRepository();
    const goal = await saveGoal(repository, {
      id: `goal-${period}-${direction}`,
      activityId: 'activity-study',
      period,
      direction,
      hours: 1,
      minutes: 15,
      enabled: true,
    });

    expect(goal).toMatchObject({ period, direction, targetMinutes: 75 });
    expect(await repository.listGoals()).toContainEqual(goal);
  });

  it('updates a goal and rejects zero, fractional, and missing-activity targets', async () => {
    const repository = createMemoryRepository();
    const original = await saveGoal(repository, {
      id: 'goal-study',
      activityId: 'activity-study',
      period: 'daily',
      direction: 'minimum',
      hours: 1,
      minutes: 0,
      enabled: true,
    });

    await saveGoal(repository, {
      ...original,
      period: 'weekly',
      direction: 'maximum',
      hours: 0,
      minutes: 45,
    });
    expect(await repository.listGoals()).toEqual([
      expect.objectContaining({
        id: 'goal-study',
        period: 'weekly',
        direction: 'maximum',
        targetMinutes: 45,
      }),
    ]);

    await expect(saveGoal(repository, {
      ...original,
      hours: 0,
      minutes: 0,
    })).rejects.toThrow('Goal target must be a positive whole number of minutes.');
    await expect(saveGoal(repository, {
      ...original,
      hours: 0,
      minutes: 1.5,
    })).rejects.toThrow('Goal target must be a positive whole number of minutes.');
    await expect(saveGoal(repository, {
      ...original,
      activityId: 'activity-missing',
      hours: 1,
      minutes: 0,
    })).rejects.toThrow('Choose an active activity for this goal.');
  });

  it('rejects unsupported goal periods and directions at the repository boundary', async () => {
    const repository = createMemoryRepository();
    const valid = {
      activityId: 'activity-study',
      period: 'daily',
      direction: 'minimum',
      hours: 1,
      minutes: 0,
      enabled: true,
    } as const;

    await expect(saveGoal(repository, {
      ...valid,
      period: 'monthly',
    } as unknown as Parameters<typeof saveGoal>[1])).rejects.toThrow(
      'Goal period must be daily or weekly.',
    );
    await expect(saveGoal(repository, {
      ...valid,
      direction: 'average',
    } as unknown as Parameters<typeof saveGoal>[1])).rejects.toThrow(
      'Goal direction must be minimum or maximum.',
    );
    expect(await repository.listGoals()).toEqual([]);
  });
});

describe('SettingsScreen', () => {
  it('offers exactly slots 1–4 and never offers a None quick-slot assignment', async () => {
    renderSettings();
    await settleRepositoryQueries();

    const study = screen.getByRole('article', { name: 'Study activity settings' });
    expect(within(study).getByLabelText('Quick slot')).toHaveDisplayValue('Slot 1');
    expect(within(study).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Slot 1',
      'Slot 2',
      'Slot 3',
      'Slot 4',
    ]);
  });

  it('renames, recolors, reorders, adds, and validates activities', async () => {
    const user = userEvent.setup();
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    const study = screen.getByRole('article', { name: 'Study activity settings' });
    await user.clear(within(study).getByLabelText('Name'));
    await user.type(within(study).getByLabelText('Name'), '  Deep Study  ');
    fireEvent.change(within(study).getByLabelText('Color'), { target: { value: '#123456' } });
    await user.click(within(study).getByRole('button', { name: 'Save activity' }));
    await settleRepositoryQueries();

    const deepStudy = screen.getByRole('article', { name: 'Deep Study activity settings' });
    await user.click(within(deepStudy).getByRole('button', { name: 'Move down' }));
    await settleRepositoryQueries();
    expect((await repository.listActivities()).slice(0, 2).map(({ name }) => name)).toEqual([
      'Exercise',
      'Deep Study',
    ]);
    expect((await repository.listActivities()).find(({ id }) => id === 'activity-study'))
      .toMatchObject({ name: 'Deep Study', color: '#123456' });

    const eat = screen.getByRole('article', { name: 'Eat activity settings' });
    await user.selectOptions(within(eat).getByLabelText('Quick slot'), '1');
    await settleRepositoryQueries();
    expect((await repository.listActivities()).filter(({ quickSlot }) => quickSlot === 1))
      .toEqual([expect.objectContaining({ id: 'activity-eat' })]);

    await user.type(screen.getByLabelText('New activity name'), 'Deep Work');
    fireEvent.change(screen.getByLabelText('New activity color'), { target: { value: '#abcdef' } });
    await user.click(screen.getByRole('button', { name: 'Add activity' }));
    await settleRepositoryQueries();
    expect((await repository.listActivities()).at(-1)).toMatchObject({
      name: 'Deep Work',
      color: '#abcdef',
      archivedAt: null,
    });

    await user.type(screen.getByLabelText('New activity name'), ' '.repeat(2));
    await user.click(screen.getByRole('button', { name: 'Add activity' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Activity name must be 1–40 characters.');
    expect((await repository.listActivities()).filter(({ name }) => name === '')).toHaveLength(0);
  });

  it('preserves a rapid quick-slot assignment when saving another activity field', async () => {
    const { repository } = renderSettings();
    await settleRepositoryQueries();
    const eat = screen.getByRole('article', { name: 'Eat activity settings' });

    fireEvent.change(within(eat).getByLabelText('Quick slot'), { target: { value: '1' } });
    fireEvent.change(within(eat).getByLabelText('Name'), { target: { value: 'Lunch' } });
    fireEvent.click(within(eat).getByRole('button', { name: 'Save activity' }));
    await settleRepositoryQueries();

    expect((await repository.listActivities()).find(({ id }) => id === 'activity-eat'))
      .toMatchObject({ name: 'Lunch', quickSlot: 1 });
  });

  it('assigns distinct deterministic orders to rapidly added activities', async () => {
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    fireEvent.change(screen.getByLabelText('New activity name'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
    fireEvent.change(screen.getByLabelText('New activity name'), { target: { value: 'Beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add activity' }));
    await settleRepositoryQueries();

    const additions = (await repository.listActivities())
      .filter(({ name }) => name === 'Alpha' || name === 'Beta');
    expect(additions.map(({ name, sortOrder }) => ({ name, sortOrder }))).toEqual([
      { name: 'Alpha', sortOrder: 8 },
      { name: 'Beta', sortOrder: 9 },
    ]);
  });

  it('accepts a 40-character trimmed activity name with surrounding whitespace', async () => {
    const user = userEvent.setup();
    const { repository } = renderSettings();
    await settleRepositoryQueries();
    const study = screen.getByRole('article', { name: 'Study activity settings' });
    const name = 'A'.repeat(40);

    await user.clear(within(study).getByLabelText('Name'));
    await user.type(within(study).getByLabelText('Name'), `  ${name}  `);
    await user.click(within(study).getByRole('button', { name: 'Save activity' }));
    await settleRepositoryQueries();

    expect((await repository.listActivities()).find(({ id }) => id === 'activity-study')?.name)
      .toBe(name);
  });

  it('renames, recolors, reorders, adds, and archives emotions', async () => {
    const user = userEvent.setup();
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    const happy = screen.getByRole('article', { name: 'Happy emotion settings' });
    await user.clear(within(happy).getByLabelText('Name'));
    await user.type(within(happy).getByLabelText('Name'), 'Joyful');
    fireEvent.change(within(happy).getByLabelText('Color'), { target: { value: '#fedcba' } });
    await user.click(within(happy).getByRole('button', { name: 'Save emotion' }));
    await settleRepositoryQueries();
    const joyful = screen.getByRole('article', { name: 'Joyful emotion settings' });
    await user.click(within(joyful).getByRole('button', { name: 'Move down' }));

    await user.type(screen.getByLabelText('New emotion name'), 'Content');
    await user.click(screen.getByRole('button', { name: 'Add emotion' }));
    await settleRepositoryQueries();
    const content = screen.getByRole('article', { name: 'Content emotion settings' });
    await user.click(within(content).getByRole('button', { name: 'Archive emotion' }));
    await settleRepositoryQueries();

    const emotions = await repository.listEmotions(true);
    expect(emotions.slice(0, 2).map(({ name }) => name)).toEqual(['Calm', 'Joyful']);
    expect(emotions.find(({ id }) => id === 'emotion-happy')).toMatchObject({ color: '#fedcba' });
    expect(emotions.find(({ name }) => name === 'Content')?.archivedAt).not.toBeNull();
    expect(screen.getByText('Content (archived)')).toBeVisible();
  });

  it('assigns distinct deterministic orders to rapidly added emotions', async () => {
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    fireEvent.change(screen.getByLabelText('New emotion name'), { target: { value: 'Hopeful' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add emotion' }));
    fireEvent.change(screen.getByLabelText('New emotion name'), { target: { value: 'Steady' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add emotion' }));
    await settleRepositoryQueries();

    const additions = (await repository.listEmotions(true))
      .filter(({ name }) => name === 'Hopeful' || name === 'Steady');
    expect(additions.map(({ name, sortOrder }) => ({ name, sortOrder }))).toEqual([
      { name: 'Hopeful', sortOrder: 9 },
      { name: 'Steady', sortOrder: 10 },
    ]);
  });

  it('rejects an emotion name longer than 40 trimmed characters', async () => {
    const user = userEvent.setup();
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    await user.type(screen.getByLabelText('New emotion name'), 'E'.repeat(41));
    await user.click(screen.getByRole('button', { name: 'Add emotion' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Emotion name must be 1–40 characters.');
    expect((await repository.listEmotions()).some(({ name }) => name === 'E'.repeat(40))).toBe(false);
  });

  it('creates, updates, and deletes goals', async () => {
    const user = userEvent.setup();
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    await user.selectOptions(screen.getByLabelText('New goal activity'), 'activity-exercise');
    await user.selectOptions(screen.getByLabelText('New goal period'), 'daily');
    await user.selectOptions(screen.getByLabelText('New goal direction'), 'maximum');
    await user.type(screen.getByLabelText('New goal hours'), '1');
    await user.type(screen.getByLabelText('New goal minutes'), '30');
    await user.click(screen.getByRole('button', { name: 'Add goal' }));
    await settleRepositoryQueries();

    const goal = screen.getByRole('article', { name: 'Exercise daily maximum goal' });
    await user.selectOptions(within(goal).getByLabelText('Period'), 'weekly');
    await user.selectOptions(within(goal).getByLabelText('Direction'), 'minimum');
    await user.clear(within(goal).getByLabelText('Hours'));
    await user.type(within(goal).getByLabelText('Hours'), '2');
    await user.clear(within(goal).getByLabelText('Minutes'));
    await user.type(within(goal).getByLabelText('Minutes'), '0');
    await user.click(within(goal).getByRole('button', { name: 'Save goal' }));
    await settleRepositoryQueries();
    expect(await repository.listGoals()).toEqual([
      expect.objectContaining({ period: 'weekly', direction: 'minimum', targetMinutes: 120 }),
    ]);

    const updated = screen.getByRole('article', { name: 'Exercise weekly minimum goal' });
    await user.click(within(updated).getByRole('button', { name: 'Delete goal' }));
    await settleRepositoryQueries();
    expect(await repository.listGoals()).toEqual([]);
  });

  it('preserves a dirty goal draft across an unrelated repository write', async () => {
    const goal: Goal = {
      id: 'goal-study',
      activityId: 'activity-study',
      period: 'daily',
      direction: 'minimum',
      targetMinutes: 60,
      enabled: true,
    };
    const repository = createMemoryRepository({ goals: [goal] });
    renderSettings(repository);
    await settleRepositoryQueries();
    const editor = screen.getByRole('article', { name: 'Study daily minimum goal' });

    fireEvent.change(within(editor).getByLabelText('Hours'), { target: { value: '2' } });
    fireEvent.change(within(editor).getByLabelText('Minutes'), { target: { value: '30' } });
    const preferences = await repository.getPreferences();
    await act(() => repository.runWrite(() => repository.putPreferences({
      ...preferences,
      reducedMotion: true,
    })));
    await settleRepositoryQueries();

    expect(within(editor).getByLabelText('Hours')).toHaveValue(2);
    expect(within(editor).getByLabelText('Minutes')).toHaveValue(30);
  });

  it('reloads a goal editor when the persisted goal actually changes', async () => {
    const goal: Goal = {
      id: 'goal-study',
      activityId: 'activity-study',
      period: 'daily',
      direction: 'minimum',
      targetMinutes: 60,
      enabled: true,
    };
    const repository = createMemoryRepository({ goals: [goal] });
    renderSettings(repository);
    await settleRepositoryQueries();
    const editor = screen.getByRole('article', { name: 'Study daily minimum goal' });
    fireEvent.change(within(editor).getByLabelText('Hours'), { target: { value: '2' } });

    await act(() => repository.runWrite(() => repository.putGoal({
      ...goal,
      targetMinutes: 180,
    })));
    await settleRepositoryQueries();

    expect(within(editor).getByLabelText('Hours')).toHaveValue(3);
    expect(within(editor).getByLabelText('Minutes')).toHaveValue(0);
  });

  it('applies week start, 24-hour time, and reduced motion immediately across the app', async () => {
    const user = userEvent.setup();
    const repository = createMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>,
    );
    await settleRepositoryQueries();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await settleRepositoryQueries();

    await user.selectOptions(screen.getByLabelText('Week starts on'), '0');
    await user.selectOptions(screen.getByLabelText('Time format'), '24');
    await user.click(screen.getByLabelText('Reduce motion'));
    await settleRepositoryQueries();

    expect(await repository.getPreferences()).toMatchObject({
      weekStartsOn: 0,
      hourCycle: 24,
      reducedMotion: true,
    });
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-reduced-motion', 'true');

    await user.click(screen.getByRole('button', { name: 'Week' }));
    await settleRepositoryQueries();
    expect(screen.getAllByText(/^Sunday,/).length).toBeGreaterThan(0);
  });

  it('keeps the reduced-motion checkbox checked while its preference write is in flight', async () => {
    const repository = createMemoryRepository();
    const { writes: [write] } = controlPreferenceWrites(repository, ['success']);
    renderSettings(repository);
    await settleRepositoryQueries();
    const checkbox = screen.getByLabelText('Reduce motion');

    fireEvent.click(checkbox);
    await write!.started;

    expect(checkbox).toBeChecked();
    await act(async () => {
      write!.release();
      await write!.completed;
    });
    await waitFor(async () => {
      expect(await repository.getPreferences()).toMatchObject({ reducedMotion: true });
      expect(checkbox).toBeChecked();
    });
  });

  it('keeps the newest reduced-motion intent rendered across blocked serialized ABA writes', async () => {
    const repository = createMemoryRepository();
    const { writes: [enable, disable], startedOrder } = controlPreferenceWrites(
      repository,
      ['success', 'success'],
    );
    renderSettings(repository);
    await settleRepositoryQueries();
    const checkbox = screen.getByLabelText('Reduce motion');

    fireEvent.click(checkbox);
    await enable!.started;
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(startedOrder).toEqual([0]);

    await act(async () => {
      enable!.release();
      await disable!.started;
    });
    expect(await repository.getPreferences()).toMatchObject({ reducedMotion: true });
    expect(checkbox).not.toBeChecked();
    expect(startedOrder).toEqual([0, 1]);

    await act(async () => {
      disable!.release();
      await disable!.completed;
    });
    await waitFor(async () => {
      expect(await repository.getPreferences()).toMatchObject({ reducedMotion: false });
      expect(checkbox).not.toBeChecked();
    });
  });

  it('rolls the newest reduced-motion intent back to persisted state when its write fails', async () => {
    const repository = createMemoryRepository();
    const { writes: [enable, disable] } = controlPreferenceWrites(
      repository,
      ['success', 'failure'],
    );
    renderSettings(repository);
    await settleRepositoryQueries();
    const checkbox = screen.getByLabelText('Reduce motion');

    fireEvent.click(checkbox);
    await enable!.started;
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await act(async () => {
      enable!.release();
      await disable!.started;
    });
    expect(await repository.getPreferences()).toMatchObject({ reducedMotion: true });
    expect(checkbox).not.toBeChecked();

    await act(async () => {
      disable!.release();
      await disable!.completed;
    });
    await waitFor(() => {
      expect(checkbox).toBeChecked();
      expect(screen.getByRole('alert')).toHaveTextContent('Preference write 2 failed.');
    });
    expect(await repository.getPreferences()).toMatchObject({ reducedMotion: true });
  });

  it('does not let an older failed reduced-motion write roll back the newer intent', async () => {
    const repository = createMemoryRepository();
    const { writes: [enable, disable], startedOrder } = controlPreferenceWrites(
      repository,
      ['failure', 'success'],
    );
    renderSettings(repository);
    await settleRepositoryQueries();
    const checkbox = screen.getByLabelText('Reduce motion');

    fireEvent.click(checkbox);
    await enable!.started;
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await act(async () => {
      enable!.release();
      await disable!.started;
    });
    expect(startedOrder).toEqual([0, 1]);
    expect(checkbox).not.toBeChecked();

    await act(async () => {
      disable!.release();
      await disable!.completed;
    });
    await waitFor(async () => {
      expect(await repository.getPreferences()).toMatchObject({ reducedMotion: false });
      expect(checkbox).not.toBeChecked();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('submits reduced-motion intents in user order across Settings unmount and remount', async () => {
    const repository = createMemoryRepository();
    const { writes: [enableA, disableA, enableB], startedValues } = controlPreferenceWrites(
      repository,
      ['success', 'success', 'success'],
    );
    render(
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const firstMountCheckbox = await screen.findByLabelText('Reduce motion');

    fireEvent.click(firstMountCheckbox);
    await enableA!.started;
    expect(firstMountCheckbox).toBeChecked();

    fireEvent.click(firstMountCheckbox);
    expect(firstMountCheckbox).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const secondMountCheckbox = await screen.findByLabelText('Reduce motion');
    expect(secondMountCheckbox).not.toBeChecked();

    fireEvent.click(secondMountCheckbox);
    expect(secondMountCheckbox).toBeChecked();
    expect(startedValues).toEqual([true]);

    await act(async () => {
      enableA!.release();
      await disableA!.started;
    });
    expect(startedValues).toEqual([true, false]);
    expect(secondMountCheckbox).toBeChecked();

    await act(async () => {
      disableA!.release();
      await enableB!.started;
    });
    expect(startedValues).toEqual([true, false, true]);
    expect(secondMountCheckbox).toBeChecked();

    await act(async () => {
      enableB!.release();
      await enableB!.completed;
    });
    await waitFor(async () => {
      expect(await repository.getPreferences()).toMatchObject({ reducedMotion: true });
      expect(secondMountCheckbox).toBeChecked();
    });
  });

  it('merges rapid preference changes with the latest repository values', async () => {
    const { repository } = renderSettings();
    await settleRepositoryQueries();

    fireEvent.change(screen.getByLabelText('Week starts on'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Time format'), { target: { value: '24' } });
    fireEvent.click(screen.getByLabelText('Reduce motion'));
    await settleRepositoryQueries();

    expect(await repository.getPreferences()).toMatchObject({
      weekStartsOn: 0,
      hourCycle: 24,
      reducedMotion: true,
    });
  });

  it('updates Focus quick slots and dial order through repository subscriptions', async () => {
    const user = userEvent.setup();
    const repository = createMemoryRepository();
    render(
      <RepositoryProvider repository={repository}>
        <App />
      </RepositoryProvider>,
    );
    await settleRepositoryQueries();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await settleRepositoryQueries();

    const eat = screen.getByRole('article', { name: 'Eat activity settings' });
    await user.selectOptions(within(eat).getByLabelText('Quick slot'), '1');
    const work = screen.getByRole('article', { name: 'Work activity settings' });
    await user.click(within(work).getByRole('button', { name: 'Move up' }));
    await settleRepositoryQueries();
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    await settleRepositoryQueries();

    expect([...document.querySelectorAll('.quick-activities__button')].map((node) => node.textContent))
      .toEqual(expect.arrayContaining(['Eat', 'Exercise', 'Work', 'Social']));
    expect(document.querySelector('.quick-activities__button')?.textContent).toContain('Eat');
    expect([...document.querySelectorAll('.dial__activity-name')].slice(0, 3).map((node) => node.textContent))
      .toEqual(['Study', 'Work', 'Exercise']);
  });

  it('uses the preferred hour cycle for every displayed timeline and Week time', async () => {
    const preferences: Preferences = { ...DEFAULT_PREFERENCES, hourCycle: 24 };
    const session = completedSession('activity-study');
    const checkIn: EmotionEntry = {
      id: 'emotion-entry',
      emotionId: 'emotion-happy',
      intensity: 5,
      comment: '',
      recordedAt: session.startedAt,
      activityId: 'activity-study',
      sessionId: session.id,
      createdAt: session.startedAt,
      updatedAt: session.startedAt,
    };
    const repository = createMemoryRepository({
      sessions: [session],
      emotionEntries: [checkIn],
      preferences,
    });

    const today = render(
      <RepositoryProvider repository={repository}>
        <TodayScreen date={new Date(2026, 6, 13)} />
      </RepositoryProvider>,
    );
    await settleRepositoryQueries();
    expect(screen.getByText('13:05 – 14:05')).toBeVisible();
    expect(screen.getByText('13:05', { selector: 'time' })).toBeVisible();
    today.unmount();

    render(
      <RepositoryProvider repository={repository}>
        <WeekScreen now={new Date(2026, 6, 15, 12)} />
      </RepositoryProvider>,
    );
    await settleRepositoryQueries();
    expect(screen.getByText(/at 13:05/)).toBeVisible();
  });
});

it('persists customized settings across IndexedDB repository recreation', async () => {
  const databaseName = `focus-dial-settings-${Date.now()}-${Math.random()}`;
  try {
    const first = createDexieRepository(databaseName);
    await assignQuickSlot(first, 'activity-eat', 1);
    await saveGoal(first, {
      id: 'goal-persisted',
      activityId: 'activity-eat',
      period: 'weekly',
      direction: 'minimum',
      hours: 2,
      minutes: 0,
      enabled: true,
    });
    const preferences = await first.getPreferences();
    await first.runWrite(() => first.putPreferences({
      ...preferences,
      weekStartsOn: 0,
      hourCycle: 24,
      reducedMotion: true,
    }));

    const recreated = createDexieRepository(databaseName);
    expect((await recreated.listActivities()).find(({ id }) => id === 'activity-eat')?.quickSlot)
      .toBe(1);
    expect(await recreated.listGoals()).toEqual([
      expect.objectContaining({ id: 'goal-persisted', targetMinutes: 120 }),
    ]);
    expect(await recreated.getPreferences()).toMatchObject({
      weekStartsOn: 0,
      hourCycle: 24,
      reducedMotion: true,
    });
  } finally {
    await Dexie.delete(databaseName);
  }
});
