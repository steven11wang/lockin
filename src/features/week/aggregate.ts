import type {
  DateRange,
  Id,
  Preferences,
  Session,
} from '../../domain/models';
import { clipSessionToRange } from '../today/timeline';

export type TimeBand = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ActivityAggregate {
  totalMs: number;
  byActivity: Record<Id, number>;
  byDay: Array<{ range: DateRange; byActivity: Record<Id, number> }>;
}

export type ActivityTimeBands = Record<Id, Record<TimeBand, number>>;

export interface PeriodDelta {
  currentMs: number;
  previousMs: number;
  deltaMs: number;
  ratio: number | null;
}

export interface PeriodComparison {
  total: PeriodDelta;
  byActivity: Record<Id, PeriodDelta>;
}

export interface ComparisonRanges {
  current: DateRange;
  previous: DateRange;
}

function localDateWithDayOffset(timestamp: number, dayOffset: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + dayOffset,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  ).getTime();
}

export function getWeekRange(
  anchor: Date,
  weekStartsOn: Preferences['weekStartsOn'],
): DateRange {
  const daysSinceWeekStart = (anchor.getDay() - weekStartsOn + 7) % 7;
  const startDate = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() - daysSinceWeekStart,
  );
  const endDate = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate() + 7,
  );

  return { start: startDate.getTime(), end: endDate.getTime() };
}

export function getEquivalentComparisonRanges(
  currentWeek: DateRange,
  now: number,
): ComparisonRanges {
  const current = {
    start: currentWeek.start,
    end: Math.min(now, currentWeek.end),
  };

  return {
    current,
    previous: {
      start: localDateWithDayOffset(current.start, -7),
      end: localDateWithDayOffset(current.end, -7),
    },
  };
}

function getDayRanges(range: DateRange): DateRange[] {
  if (range.end <= range.start) return [];

  const rangeStart = new Date(range.start);
  let cursor = new Date(
    rangeStart.getFullYear(),
    rangeStart.getMonth(),
    rangeStart.getDate(),
  );
  const days: DateRange[] = [];

  while (cursor.getTime() < range.end) {
    const next = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1,
    );
    days.push({
      start: Math.max(range.start, cursor.getTime()),
      end: Math.min(range.end, next.getTime()),
    });
    cursor = next;
  }

  return days;
}

function durationInRange(session: Session, range: DateRange, now: number): number {
  const clipped = clipSessionToRange(session, range);
  if (clipped === null) return 0;

  const end = Math.min(clipped.endedAt ?? now, range.end);
  return Math.max(0, end - clipped.startedAt);
}

function aggregateByActivity(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
): Record<Id, number> {
  const totals: Record<Id, number> = {};

  for (const session of sessions) {
    const duration = durationInRange(session, range, now);
    if (duration === 0) continue;
    totals[session.activityId] = (totals[session.activityId] ?? 0) + duration;
  }

  return totals;
}

export function aggregateActivities(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
): ActivityAggregate {
  const byActivity = aggregateByActivity(sessions, range, now);

  return {
    totalMs: Object.values(byActivity).reduce((total, duration) => total + duration, 0),
    byActivity,
    byDay: getDayRanges(range).map((dayRange) => ({
      range: dayRange,
      byActivity: aggregateByActivity(sessions, dayRange, now),
    })),
  };
}

interface BandRange {
  band: TimeBand;
  range: DateRange;
}

function getBandRanges(dayRange: DateRange): BandRange[] {
  const date = new Date(dayRange.start);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const atHour = (hour: number) => new Date(year, month, day, hour).getTime();
  const nextMidnight = new Date(year, month, day + 1).getTime();
  const fullDayBands: BandRange[] = [
    { band: 'night', range: { start: atHour(0), end: atHour(5) } },
    { band: 'morning', range: { start: atHour(5), end: atHour(12) } },
    { band: 'afternoon', range: { start: atHour(12), end: atHour(17) } },
    { band: 'evening', range: { start: atHour(17), end: atHour(22) } },
    { band: 'night', range: { start: atHour(22), end: nextMidnight } },
  ];

  return fullDayBands.flatMap(({ band, range }) => {
    const clipped = {
      start: Math.max(dayRange.start, range.start),
      end: Math.min(dayRange.end, range.end),
    };
    return clipped.end > clipped.start ? [{ band, range: clipped }] : [];
  });
}

function emptyBandTotals(): Record<TimeBand, number> {
  return { morning: 0, afternoon: 0, evening: 0, night: 0 };
}

export function activityTimeBands(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
): ActivityTimeBands {
  const totals: ActivityTimeBands = {};

  for (const dayRange of getDayRanges(range)) {
    for (const { band, range: bandRange } of getBandRanges(dayRange)) {
      for (const session of sessions) {
        const duration = durationInRange(session, bandRange, now);
        if (duration === 0) continue;
        const activityTotals = totals[session.activityId] ?? emptyBandTotals();
        activityTotals[band] += duration;
        totals[session.activityId] = activityTotals;
      }
    }
  }

  return totals;
}

function calculatePeriodDelta(currentMs: number, previousMs: number): PeriodDelta {
  return {
    currentMs,
    previousMs,
    deltaMs: currentMs - previousMs,
    ratio: previousMs === 0 ? null : currentMs / previousMs,
  };
}

export function comparePeriods(
  current: ActivityAggregate,
  previous: ActivityAggregate,
): PeriodComparison {
  const activityIds = new Set([
    ...Object.keys(current.byActivity),
    ...Object.keys(previous.byActivity),
  ]);
  const byActivity: Record<Id, PeriodDelta> = {};

  for (const activityId of activityIds) {
    byActivity[activityId] = calculatePeriodDelta(
      current.byActivity[activityId] ?? 0,
      previous.byActivity[activityId] ?? 0,
    );
  }

  return {
    total: calculatePeriodDelta(current.totalMs, previous.totalMs),
    byActivity,
  };
}
