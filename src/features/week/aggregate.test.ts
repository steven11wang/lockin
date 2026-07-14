import type {
  Activity,
  DateRange,
  Preferences,
  Session,
} from '../../domain/models';
import {
  activityTimeBands,
  aggregateActivities,
  comparePeriods,
  getEquivalentComparisonRanges,
  getWeekRange,
  type ActivityAggregate,
} from './aggregate';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const environment = (globalThis as typeof globalThis & {
  process: { env: Record<string, string | undefined> };
}).process.env;
const originalTimeZone = environment.TZ;

function makeSession(
  startedAt: number,
  endedAt: number | null,
  activityId = 'activity-study',
): Session {
  return {
    id: `session-${activityId}-${startedAt}`,
    activityId,
    startedAt,
    endedAt,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

function makeAggregate(totalMs: number, byActivity: Record<string, number>): ActivityAggregate {
  return { totalMs, byActivity, byDay: [] };
}

beforeAll(() => {
  environment.TZ = 'America/New_York';
});

afterAll(() => {
  if (originalTimeZone === undefined) delete environment.TZ;
  else environment.TZ = originalTimeZone;
});

describe('calendar-safe week ranges', () => {
  it('uses local week boundaries across a month and year boundary', () => {
    const weekStartsOn: Preferences['weekStartsOn'] = 1;

    expect(getWeekRange(new Date(2026, 0, 1, 18, 45), weekStartsOn)).toEqual({
      start: new Date(2025, 11, 29).getTime(),
      end: new Date(2026, 0, 5).getTime(),
    });
  });

  it('builds an equivalent previous partial week by local wall-clock components across DST', () => {
    const currentWeek: DateRange = {
      start: new Date(2026, 2, 8).getTime(),
      end: new Date(2026, 2, 15).getTime(),
    };
    const now = new Date(2026, 2, 10, 12, 34, 56, 789).getTime();

    const ranges = getEquivalentComparisonRanges(currentWeek, now);

    expect(ranges).toEqual({
      current: { start: currentWeek.start, end: now },
      previous: {
        start: new Date(2026, 2, 1).getTime(),
        end: new Date(2026, 2, 3, 12, 34, 56, 789).getTime(),
      },
    });
    expect(ranges.previous.end - ranges.previous.start)
      .toBe(ranges.current.end - ranges.current.start + HOUR);
  });
});

describe('activity aggregation', () => {
  it('splits a cross-midnight session into local days across month and year boundaries', () => {
    const range: DateRange = {
      start: new Date(2025, 11, 31).getTime(),
      end: new Date(2026, 0, 2).getTime(),
    };
    const session = makeSession(
      new Date(2025, 11, 31, 23, 30).getTime(),
      new Date(2026, 0, 1, 0, 30).getTime(),
    );

    expect(aggregateActivities([session], range, range.end)).toEqual({
      totalMs: HOUR,
      byActivity: { 'activity-study': HOUR },
      byDay: [
        {
          range: {
            start: new Date(2025, 11, 31).getTime(),
            end: new Date(2026, 0, 1).getTime(),
          },
          byActivity: { 'activity-study': 30 * MINUTE },
        },
        {
          range: {
            start: new Date(2026, 0, 1).getTime(),
            end: new Date(2026, 0, 2).getTime(),
          },
          byActivity: { 'activity-study': 30 * MINUTE },
        },
      ],
    });
  });

  it('clips an active session at the injected current time', () => {
    const range: DateRange = {
      start: new Date(2026, 6, 13).getTime(),
      end: new Date(2026, 6, 14).getTime(),
    };
    const active = makeSession(new Date(2026, 6, 13, 9).getTime(), null);
    const now = new Date(2026, 6, 13, 10, 15).getTime();

    expect(aggregateActivities([active], range, now)).toMatchObject({
      totalMs: 75 * MINUTE,
      byActivity: { 'activity-study': 75 * MINUTE },
    });
  });

  it('uses the actual length of a daylight-saving day', () => {
    const range: DateRange = {
      start: new Date(2026, 2, 8).getTime(),
      end: new Date(2026, 2, 9).getTime(),
    };
    const session = makeSession(range.start, range.end);

    const aggregate = aggregateActivities([session], range, range.end);

    expect(range.end - range.start).toBe(23 * HOUR);
    expect(aggregate.totalMs).toBe(23 * HOUR);
    expect(aggregate.byDay).toEqual([
      { range, byActivity: { 'activity-study': 23 * HOUR } },
    ]);
  });

  it('retains historic totals for an archived activity', () => {
    const archivedActivity: Activity = {
      id: 'activity-archived',
      name: 'Old routine',
      color: '#555555',
      sortOrder: 99,
      quickSlot: null,
      archivedAt: new Date(2026, 6, 1).getTime(),
    };
    const range: DateRange = {
      start: new Date(2026, 5, 1).getTime(),
      end: new Date(2026, 5, 2).getTime(),
    };
    const historic = makeSession(
      new Date(2026, 5, 1, 8).getTime(),
      new Date(2026, 5, 1, 8, 45).getTime(),
      archivedActivity.id,
    );

    expect(aggregateActivities([historic], range, range.end).byActivity).toEqual({
      [archivedActivity.id]: 45 * MINUTE,
    });
  });

  it('splits durations at the exact local time-band boundaries', () => {
    const range: DateRange = {
      start: new Date(2026, 6, 13).getTime(),
      end: new Date(2026, 6, 14).getTime(),
    };
    const sessions = [
      makeSession(
        new Date(2026, 6, 13, 4, 30).getTime(),
        new Date(2026, 6, 13, 5, 30).getTime(),
      ),
      makeSession(
        new Date(2026, 6, 13, 11, 30).getTime(),
        new Date(2026, 6, 13, 12, 30).getTime(),
      ),
      makeSession(
        new Date(2026, 6, 13, 16, 30).getTime(),
        new Date(2026, 6, 13, 17, 30).getTime(),
      ),
      makeSession(
        new Date(2026, 6, 13, 21, 30).getTime(),
        new Date(2026, 6, 13, 22, 30).getTime(),
      ),
    ];

    expect(activityTimeBands(sessions, range, range.end)).toEqual({
      'activity-study': {
        morning: HOUR,
        afternoon: HOUR,
        evening: HOUR,
        night: HOUR,
      },
    });
  });
});

describe('period comparison', () => {
  it('compares totals and the union of activity ids with null ratios for zero baselines', () => {
    const current = makeAggregate(2 * HOUR, { 'activity-study': 2 * HOUR });
    const previous = makeAggregate(HOUR, { 'activity-exercise': HOUR });

    expect(comparePeriods(current, previous)).toEqual({
      total: {
        currentMs: 2 * HOUR,
        previousMs: HOUR,
        deltaMs: HOUR,
        ratio: 2,
      },
      byActivity: {
        'activity-study': {
          currentMs: 2 * HOUR,
          previousMs: 0,
          deltaMs: 2 * HOUR,
          ratio: null,
        },
        'activity-exercise': {
          currentMs: 0,
          previousMs: HOUR,
          deltaMs: -HOUR,
          ratio: 0,
        },
      },
    });
  });
});
