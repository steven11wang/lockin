import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { RepositoryProvider } from '../../app/RepositoryContext';
import type {
  Activity,
  Emotion,
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Preferences,
  Session,
} from '../../domain/models';
import { DEFAULT_PREFERENCES } from '../../domain/defaults';
import { createMemoryRepository } from '../../storage/memoryRepository';
import { WeekScreen } from './WeekScreen';

const NOW = new Date(2026, 6, 15, 12);

const study: Activity = {
  id: 'activity-study',
  name: 'Study',
  color: '#5B5BD6',
  sortOrder: 1,
  quickSlot: 1,
  archivedAt: null,
};
const exercise: Activity = {
  id: 'activity-exercise',
  name: 'Exercise',
  color: '#2E9D68',
  sortOrder: 2,
  quickSlot: 2,
  archivedAt: null,
};
const oldRoutine: Activity = {
  id: 'activity-old',
  name: 'Old routine',
  color: '#666666',
  sortOrder: 3,
  quickSlot: null,
  archivedAt: new Date(2026, 6, 14).getTime(),
};
const calm: Emotion = {
  id: 'emotion-calm',
  name: 'Calm',
  color: '#65BFA6',
  sortOrder: 1,
  archivedAt: null,
};
const happy: Emotion = {
  id: 'emotion-happy',
  name: 'Happy',
  color: '#F2B84B',
  sortOrder: 2,
  archivedAt: null,
};

function at(day: number, hour = 0, minute = 0): number {
  return new Date(2026, 6, day, hour, minute).getTime();
}

function session(
  id: string,
  activityId: string,
  day: number,
  startHour: number,
  endHour: number,
  startMinute = 0,
  endMinute = 0,
): Session {
  const startedAt = at(day, startHour, startMinute);
  return {
    id,
    activityId,
    startedAt,
    endedAt: at(day, endHour, endMinute),
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

function checkIn(
  id: string,
  emotionId: string,
  day: number,
  hour: number,
  minute: number,
  activityId: string | null,
  intensity: EmotionEntry['intensity'],
): EmotionEntry {
  const recordedAt = at(day, hour, minute);
  return {
    id,
    emotionId,
    intensity,
    comment: '',
    recordedAt,
    activityId,
    sessionId: null,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  };
}

function goal(
  id: string,
  activityId: string,
  direction: Goal['direction'],
  targetMinutes: number,
  period: Goal['period'] = 'weekly',
): Goal {
  return { id, activityId, direction, targetMinutes, period, enabled: true };
}

function renderWeek(repository: FocusDialRepository) {
  return render(
    <RepositoryProvider repository={repository}>
      <WeekScreen now={NOW} />
    </RepositoryProvider>,
  );
}

function renderLiveWeek(repository: FocusDialRepository) {
  return render(
    <RepositoryProvider repository={repository}>
      <WeekScreen />
    </RepositoryProvider>,
  );
}

async function settleRepositoryQueries(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 12; step += 1) await Promise.resolve();
  });
}

describe('WeekScreen', () => {
  it('shows accessible daily activity, comparison, goal, and qualified emotion detail', async () => {
    const repository = createMemoryRepository({
      activities: [study, exercise, oldRoutine],
      emotions: [calm, happy],
      sessions: [
        session('study-current', study.id, 13, 8, 10),
        session('exercise-current', exercise.id, 14, 18, 19),
        session('old-current', oldRoutine.id, 14, 23, 23, 0, 30),
        session('study-previous', study.id, 6, 8, 9),
      ],
      emotionEntries: [
        checkIn('calm-late', calm.id, 14, 18, 45, exercise.id, 4),
        checkIn('happy-first', happy.id, 13, 9, 0, null, 5),
        checkIn('calm-first', calm.id, 14, 18, 5, exercise.id, 2),
        checkIn('calm-middle', calm.id, 14, 18, 25, exercise.id, 3),
      ],
      goals: [
        goal('study-minimum', study.id, 'minimum', 180),
        goal('exercise-maximum', exercise.id, 'maximum', 30),
      ],
    });

    renderWeek(repository);
    await settleRepositoryQueries();

    const dailyBars = [...document.querySelectorAll('.week-day__bar')];
    expect(dailyBars).toHaveLength(7);
    expect(dailyBars.every((bar) => bar.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(screen.getByText('Monday, July 13: 2h tracked; Study 2h')).toBeVisible();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByText(
      'Tuesday, July 14: 1h 30m tracked; Exercise 1h, Old routine 30m',
    )).toBeVisible();

    const studyCard = screen.getByRole('article', { name: 'Study' });
    expect(studyCard).toHaveTextContent('Total 2h');
    expect(studyCard).toHaveTextContent('Daily average 17m');
    expect(studyCard).toHaveTextContent('Morning 2h');
    expect(studyCard).toHaveTextContent('Previous equivalent period 1h');
    expect(studyCard).toHaveTextContent('Change 1h more');
    expect(screen.getByRole('article', { name: 'Old routine' })).toHaveTextContent('Night 30m');
    expect(screen.getByLabelText('Total comparison')).toHaveTextContent(
      '3h 30m this period; 1h previous equivalent period; 2h 30m more',
    );

    const goals = screen.getByRole('region', { name: 'Goals and limits' });
    expect(goals).toHaveTextContent('Study weekly minimum');
    expect(goals).toHaveTextContent('60 minutes remaining');
    expect(goals).toHaveTextContent('Exercise weekly maximum');
    expect(goals).toHaveTextContent('30 minutes over this period’s limit');

    const moodStrip = within(screen.getByRole('list', { name: 'Chronological mood strip' }))
      .getAllByRole('listitem');
    expect(moodStrip.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Happy'),
      expect.stringContaining('Calm'),
      expect.stringContaining('Calm'),
      expect.stringContaining('Calm'),
    ]);
    expect(screen.getByText('Monday: Happy 1')).toBeVisible();
    expect(screen.getByText('Tuesday: Calm 3')).toBeVisible();
    const calmSummary = screen.getByRole('listitem', { name: 'Calm emotion summary' });
    expect(calmSummary).toHaveTextContent('3 check-ins');
    expect(calmSummary).toHaveTextContent('Intensity 2: 1, 3: 1, 4: 1');
    expect(screen.getByRole('list', { name: 'Emotion frequency by associated activity' }))
      .toHaveTextContent('Exercise: Calm 3');
    const timeFrequencies = screen.getByRole('list', { name: 'Emotion frequency by time band' });
    expect(timeFrequencies).toHaveTextContent('Morning: Happy 1');
    expect(timeFrequencies).toHaveTextContent('Evening: Calm 3');

    const patterns = screen.getByRole('region', { name: 'Observed patterns' });
    expect(patterns).toHaveTextContent(
      'Observed pattern: 3 of 3 check-ins during Exercise were Calm.',
    );
    expect(patterns).toHaveTextContent(
      'Observed pattern: 3 of 3 check-ins in the evening were Calm.',
    );
    expect(patterns).not.toHaveTextContent(/caused|diagnosis|treatment/i);
  });

  it('renders activity and time-band emotion frequencies below the pattern threshold', async () => {
    const repository = createMemoryRepository({
      activities: [study],
      emotions: [calm],
      emotionEntries: [checkIn('one-calm', calm.id, 13, 13, 0, study.id, 3)],
    });

    renderWeek(repository);
    await settleRepositoryQueries();

    expect(screen.getByRole('list', { name: 'Emotion frequency by associated activity' }))
      .toHaveTextContent('Study: Calm 1');
    expect(screen.getByRole('list', { name: 'Emotion frequency by time band' }))
      .toHaveTextContent('Afternoon: Calm 1');
    expect(screen.getByRole('region', { name: 'Observed patterns' })).toHaveTextContent(
      'Add at least three related check-ins to see an observed pattern.',
    );
  });

  it('shows an archived activity that appears only in the previous equivalent period', async () => {
    const repository = createMemoryRepository({
      activities: [study, oldRoutine],
      sessions: [session('old-previous', oldRoutine.id, 7, 9, 10)],
    });

    renderWeek(repository);
    await settleRepositoryQueries();

    const oldCard = screen.getByRole('article', { name: 'Old routine' });
    expect(oldCard).toHaveTextContent('Total 0m');
    expect(oldCard).toHaveTextContent('Previous equivalent period 1h');
    expect(oldCard).toHaveTextContent('Change 1h less');
  });

  it('evaluates a daily minimum on each elapsed day instead of using a weekly average', async () => {
    const repository = createMemoryRepository({
      activities: [study],
      sessions: [
        session('study-tuesday', study.id, 14, 6, 12),
        session('study-wednesday', study.id, 15, 9, 10),
      ],
      goals: [goal('study-daily', study.id, 'minimum', 60, 'daily')],
    });

    renderWeek(repository);
    await settleRepositoryQueries();

    const progress = screen.getByRole('listitem', { name: 'Study daily minimum progress' });
    expect(progress).toHaveTextContent('2 of 3 elapsed days met');
    expect(progress).toHaveTextContent('Today: 60 of 60 minutes so far');
  });

  it('detects one exceeded daily maximum and describes the partial day as within limit so far', async () => {
    const repository = createMemoryRepository({
      activities: [exercise],
      sessions: [session('exercise-monday', exercise.id, 13, 8, 10)],
      goals: [goal('exercise-daily', exercise.id, 'maximum', 60, 'daily')],
    });

    renderWeek(repository);
    await settleRepositoryQueries();

    const progress = screen.getByRole('listitem', { name: 'Exercise daily maximum progress' });
    expect(progress).toHaveTextContent('2 of 3 elapsed days met');
    expect(progress).toHaveTextContent('Today: within limit so far');
  });

  it('shows a clear empty state while keeping all seven days readable', async () => {
    renderWeek(createMemoryRepository());
    await settleRepositoryQueries();

    expect(screen.getByText('No activity or emotion records this week.')).toBeVisible();
    const dailySummaries = [...document.querySelectorAll('.week-day > p')];
    expect(dailySummaries).toHaveLength(7);
    expect(dailySummaries.every((summary) => summary.textContent?.includes('0m tracked'))).toBe(true);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Observed patterns' })).toHaveTextContent(
      'Add at least three related check-ins to see an observed pattern.',
    );
  });

  it('uses the preferred week start and does not navigate beyond the current week', async () => {
    const sundayPreferences: Preferences = { ...DEFAULT_PREFERENCES, weekStartsOn: 0 };
    renderWeek(createMemoryRepository({ preferences: sundayPreferences }));
    await settleRepositoryQueries();

    const previous = screen.getByRole('button', { name: 'Previous week' });
    const next = screen.getByRole('button', { name: 'Next week' });
    expect(screen.getByText('Sunday, July 12: 0m tracked')).toBeVisible();
    expect(next).toBeDisabled();

    fireEvent.click(previous);
    expect(screen.getByText('Sunday, July 5: 0m tracked')).toBeVisible();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expect(screen.getByText('Sunday, July 12: 0m tracked')).toBeVisible();
    expect(next).toBeDisabled();
  });
});

describe('WeekScreen live week rollover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advanceOneMinute(): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
  }

  async function notifyRepository(repository: FocusDialRepository): Promise<void> {
    await act(async () => {
      await repository.runWrite(() => repository.putActivity(study));
    });
    await settleRepositoryQueries();
  }

  it('refreshes active-session totals and auto-advances the current week after rollover', async () => {
    vi.setSystemTime(new Date(2026, 6, 19, 23, 58, 30));
    const startedAt = new Date(2026, 6, 19, 23, 58).getTime();
    const active: Session = {
      id: 'active-study',
      activityId: study.id,
      startedAt,
      endedAt: null,
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    const repository = createMemoryRepository({ activities: [study], sessions: [active] });

    renderLiveWeek(repository);
    await settleRepositoryQueries();
    expect(screen.getByLabelText('Total tracked')).toHaveTextContent('0m tracked');
    expect(screen.getByText('Mon, Jul 13 – Sun, Jul 19')).toBeVisible();

    await advanceOneMinute();
    expect(screen.getByLabelText('Total tracked')).toHaveTextContent('1m tracked');

    await advanceOneMinute();
    expect(screen.getByText('Mon, Jul 20 – Sun, Jul 26')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
  });

  it('keeps an absolute historical week selected when the current week rolls over', async () => {
    vi.setSystemTime(new Date(2026, 6, 19, 23, 59, 30));
    const repository = createMemoryRepository();
    renderLiveWeek(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByText('Mon, Jul 6 – Sun, Jul 12')).toBeVisible();

    await advanceOneMinute();
    await notifyRepository(repository);

    expect(screen.getByText('Mon, Jul 6 – Sun, Jul 12')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled();
  });

  it('walks Next through historical anchors and returns to the live current week', async () => {
    vi.setSystemTime(new Date(2026, 6, 19, 23, 59, 30));
    const repository = createMemoryRepository();
    renderLiveWeek(repository);
    await settleRepositoryQueries();

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await advanceOneMinute();
    await notifyRepository(repository);

    const next = screen.getByRole('button', { name: 'Next week' });
    fireEvent.click(next);
    expect(screen.getByText('Mon, Jul 13 – Sun, Jul 19')).toBeVisible();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expect(screen.getByText('Mon, Jul 20 – Sun, Jul 26')).toBeVisible();
    expect(next).toBeDisabled();
  });
});
