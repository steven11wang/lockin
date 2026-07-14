import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { useRepositoryQuery } from '../../app/RepositoryContext';
import { DEFAULT_PREFERENCES } from '../../domain/defaults';
import type {
  Activity,
  DateRange,
  Emotion,
  EmotionEntry,
  Goal,
  Id,
  Preferences,
  Session,
} from '../../domain/models';
import { summarizeEmotions } from '../emotions/emotionInsights';
import { calculateGoalProgress, describeGoal } from '../goals/goalProgress';
import {
  activityTimeBands,
  aggregateActivities,
  comparePeriods,
  getEquivalentComparisonRanges,
  getWeekRange,
  type PeriodDelta,
  type TimeBand,
} from './aggregate';
import './week.css';

const MINUTE = 60_000;
const TIME_BANDS: readonly TimeBand[] = ['morning', 'afternoon', 'evening', 'night'];

export interface WeekScreenProps {
  now?: Date;
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDay(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(timestamp);
}

function formatShortDay(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

function formatTime(timestamp: number, hourCycle: Preferences['hourCycle']): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: hourCycle === 24 ? 'h23' : 'h12',
  }).format(timestamp);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function shiftByLocalDays(timestamp: number, dayOffset: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset).getTime();
}

function activityName(activityById: ReadonlyMap<Id, Activity>, activityId: Id): string {
  return activityById.get(activityId)?.name ?? 'Unknown activity';
}

function describeDay(
  timestamp: number,
  byActivity: Record<Id, number>,
  activities: readonly Activity[],
): string {
  const total = Object.values(byActivity).reduce((sum, duration) => sum + duration, 0);
  const details = activities.flatMap((activity) => {
    const duration = byActivity[activity.id] ?? 0;
    return duration > 0 ? [`${activity.name} ${formatDuration(duration)}`] : [];
  });
  const suffix = details.length === 0 ? '' : `; ${details.join(', ')}`;
  return `${formatDay(timestamp)}: ${formatDuration(total)} tracked${suffix}`;
}

function describeChange(deltaMs: number): string {
  return deltaMs === 0
    ? 'no change'
    : `${formatDuration(Math.abs(deltaMs))} ${deltaMs > 0 ? 'more' : 'less'}`;
}

function describeDelta(delta: PeriodDelta): string {
  return `${formatDuration(delta.currentMs)} this period; ${formatDuration(delta.previousMs)} previous equivalent period; ${describeChange(delta.deltaMs)}`;
}

function countIntensity(values: readonly EmotionEntry['intensity'][]): string {
  const counts = new Map<EmotionEntry['intensity'], number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([intensity, count]) => `${intensity}: ${count}`)
    .join(', ');
}

function describeEmotionFrequencies(
  counts: Readonly<Record<Id, number>>,
  emotions: readonly Emotion[],
): string {
  const parts = emotions.flatMap((emotion) => {
    const count = counts[emotion.id] ?? 0;
    return count > 0 ? [`${emotion.name} ${count}`] : [];
  });
  return parts.length > 0 ? parts.join(', ') : 'No check-ins';
}

interface DailyActivityTotals {
  range: DateRange;
  byActivity: Record<Id, number>;
}

interface DailyGoalSummary {
  metDays: number;
  elapsedDays: number;
  sentence: string;
  partialDaySentence: string | null;
}

function summarizeDailyGoal(
  goal: Goal,
  days: readonly DailyActivityTotals[],
  now: number,
): DailyGoalSummary {
  const elapsedDays = days.filter((day) => day.range.start <= now);
  const evaluations = elapsedDays.map((day) => {
    const minutes = Math.floor((day.byActivity[goal.activityId] ?? 0) / MINUTE);
    return { day, minutes, progress: calculateGoalProgress(goal, minutes) };
  });
  const metDays = evaluations.filter(({ progress }) => progress.status === 'met').length;
  const partialDay = evaluations.find(({ day }) => now < day.range.end);
  let partialDaySentence: string | null = null;

  if (partialDay !== undefined) {
    if (goal.direction === 'minimum') {
      partialDaySentence = `Today: ${partialDay.minutes} of ${goal.targetMinutes} minutes so far`;
    } else if (partialDay.progress.status === 'over') {
      partialDaySentence = `Today: ${partialDay.progress.deltaMinutes} minutes over the limit so far`;
    } else {
      partialDaySentence = 'Today: within limit so far';
    }
  }

  return {
    metDays,
    elapsedDays: elapsedDays.length,
    sentence: `${metDays} of ${elapsedDays.length} elapsed days met`,
    partialDaySentence,
  };
}

export function WeekScreen({ now }: WeekScreenProps): JSX.Element {
  const activities = useRepositoryQuery(
    (repository) => repository.listActivities(true),
    [],
    [] as Activity[],
  );
  const sessions = useRepositoryQuery(
    (repository) => repository.listSessions(),
    [],
    [] as Session[],
  );
  const emotions = useRepositoryQuery(
    (repository) => repository.listEmotions(true),
    [],
    [] as Emotion[],
  );
  const emotionEntries = useRepositoryQuery(
    (repository) => repository.listEmotionEntries(),
    [],
    [] as EmotionEntry[],
  );
  const goals = useRepositoryQuery(
    (repository) => repository.listGoals(),
    [],
    [] as Goal[],
  );
  const preferences = useRepositoryQuery(
    (repository) => repository.getPreferences(),
    [],
    DEFAULT_PREFERENCES,
  );
  const injectedNow = now?.getTime();
  const [liveNow, setLiveNow] = useState(Date.now);
  const [selectedWeekStart, setSelectedWeekStart] = useState<number | null>(null);
  const nowTimestamp = injectedNow ?? liveNow;

  useEffect(() => {
    if (injectedNow !== undefined) return undefined;
    const interval = window.setInterval(() => setLiveNow(Date.now()), MINUTE);
    return () => window.clearInterval(interval);
  }, [injectedNow]);

  const currentWeek = useMemo(
    () => getWeekRange(new Date(nowTimestamp), preferences.weekStartsOn),
    [nowTimestamp, preferences.weekStartsOn],
  );
  const range = useMemo(
    () => selectedWeekStart === null
      ? currentWeek
      : { start: selectedWeekStart, end: shiftByLocalDays(selectedWeekStart, 7) },
    [currentWeek, selectedWeekStart],
  );
  const aggregate = aggregateActivities(sessions, range, nowTimestamp);
  const bands = activityTimeBands(sessions, range, nowTimestamp);
  const comparisonRanges = getEquivalentComparisonRanges(range, nowTimestamp);
  const comparison = comparePeriods(
    aggregateActivities(sessions, comparisonRanges.current, nowTimestamp),
    aggregateActivities(sessions, comparisonRanges.previous, nowTimestamp),
  );
  const emotionSummary = summarizeEmotions(emotionEntries, emotions, activities, range);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const emotionById = new Map(emotions.map((emotion) => [emotion.id, emotion]));
  const displayedActivities = activities.filter((activity) => (
    (comparison.byActivity[activity.id]?.currentMs ?? 0) > 0
    || (comparison.byActivity[activity.id]?.previousMs ?? 0) > 0
  ));
  const enabledGoals = goals.filter((goal) => goal.enabled);
  const maximumDayMs = Math.max(
    ...aggregate.byDay.map(({ byActivity }) => (
      Object.values(byActivity).reduce((sum, duration) => sum + duration, 0)
    )),
    1,
  );
  const isEmpty = aggregate.totalMs === 0 && emotionSummary.chronological.length === 0;
  const mostTracked = displayedActivities.filter((activity) => (
    (aggregate.byActivity[activity.id] ?? 0) > 0
  )).sort((left, right) => (
    (aggregate.byActivity[right.id] ?? 0) - (aggregate.byActivity[left.id] ?? 0)
    || left.sortOrder - right.sortOrder
  ))[0];

  return (
    <section className="week-screen" aria-labelledby="week-heading">
      <header className="week-header">
        <div>
          <p className="week-header__range">
            {formatShortDay(range.start)} – {formatShortDay(range.end - 1)}
          </p>
          <h1 id="week-heading">
            {selectedWeekStart === null ? 'This week' : `Week of ${formatShortDay(range.start)}`}
          </h1>
        </div>
        <div className="week-nav" aria-label="Choose week">
          <button
            type="button"
            onClick={() => setSelectedWeekStart(shiftByLocalDays(range.start, -7))}
          >
            Previous week
          </button>
          <button
            type="button"
            disabled={selectedWeekStart === null}
            onClick={() => {
              const nextWeekStart = shiftByLocalDays(range.start, 7);
              setSelectedWeekStart(nextWeekStart >= currentWeek.start ? null : nextWeekStart);
            }}
          >
            Next week
          </button>
        </div>
      </header>

      {isEmpty && <p className="week-empty">No activity or emotion records this week.</p>}

      <section className="week-panel" aria-labelledby="daily-activity-heading">
        <div className="week-panel__heading">
          <div>
            <p className="week-kicker">Activity</p>
            <h2 id="daily-activity-heading">Daily activity</h2>
          </div>
          <output aria-label="Total tracked">{formatDuration(aggregate.totalMs)} tracked</output>
        </div>

        <ol className="week-days">
          {aggregate.byDay.map(({ range: dayRange, byActivity }) => {
            const total = Object.values(byActivity).reduce((sum, duration) => sum + duration, 0);
            const summary = describeDay(dayRange.start, byActivity, activities);
            return (
              <li className="week-day" key={dayRange.start}>
                <div className="week-day__chart">
                  <div
                    className="week-day__bar"
                    aria-hidden="true"
                    style={{ '--day-share': total / maximumDayMs } as CSSProperties}
                  >
                    {activities.flatMap((activity) => {
                      const duration = byActivity[activity.id] ?? 0;
                      if (duration === 0) return [];
                      return [
                        <span
                          aria-hidden="true"
                          className="week-day__segment"
                          key={activity.id}
                          style={{
                            '--activity-color': activity.color,
                            '--segment-share': duration / total,
                          } as CSSProperties}
                        />,
                      ];
                    })}
                  </div>
                </div>
                <p>{summary}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="week-panel" aria-labelledby="comparison-heading">
        <div className="week-panel__heading">
          <div>
            <p className="week-kicker">Current vs previous</p>
            <h2 id="comparison-heading">Equivalent-period comparison</h2>
          </div>
        </div>
        <output className="week-comparison" aria-label="Total comparison">
          {describeDelta(comparison.total)}
        </output>
      </section>

      <section className="week-panel" aria-labelledby="activity-detail-heading">
        <div className="week-panel__heading">
          <div>
            <p className="week-kicker">By activity</p>
            <h2 id="activity-detail-heading">Totals and time of day</h2>
          </div>
          {mostTracked !== undefined && <p>Most tracked: {mostTracked.name}</p>}
        </div>
        {displayedActivities.length === 0 ? (
          <p className="week-muted">No activity time was recorded in this week.</p>
        ) : (
          <div className="week-activities">
            {displayedActivities.map((activity) => {
              const total = aggregate.byActivity[activity.id] ?? 0;
              const dailyAverage = total / Math.max(aggregate.byDay.length, 1);
              const activityComparison = comparison.byActivity[activity.id];
              const activityBands = bands[activity.id] ?? {
                morning: 0,
                afternoon: 0,
                evening: 0,
                night: 0,
              };
              return (
                <article
                  className="week-activity-card"
                  aria-labelledby={`week-activity-${activity.id}`}
                  key={activity.id}
                >
                  <h3 id={`week-activity-${activity.id}`}>{activity.name}</h3>
                  <dl className="week-stats">
                    <div><dt>Total</dt>{' '}<dd>{formatDuration(total)}</dd></div>
                    <div><dt>Daily average</dt>{' '}<dd>{formatDuration(dailyAverage)}</dd></div>
                    <div>
                      <dt>Previous equivalent period</dt>
                      {' '}
                      <dd>{formatDuration(activityComparison?.previousMs ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Change</dt>
                      {' '}
                      <dd>{describeChange(activityComparison?.deltaMs ?? total)}</dd>
                    </div>
                  </dl>
                  <ul className="week-bands" aria-label={`${activity.name} time-of-day distribution`}>
                    {TIME_BANDS.map((band) => (
                      <li key={band}>
                        <span>{capitalize(band)}</span>
                        {' '}
                        <strong>{formatDuration(activityBands[band])}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="week-panel" aria-labelledby="goals-heading" aria-label="Goals and limits">
        <div className="week-panel__heading">
          <div>
            <p className="week-kicker">Progress</p>
            <h2 id="goals-heading">Goals and limits</h2>
          </div>
        </div>
        {enabledGoals.length === 0 ? (
          <p className="week-muted">No goals or limits are enabled.</p>
        ) : (
          <ul className="week-goals">
            {enabledGoals.map((goal) => {
              const totalMinutes = (aggregate.byActivity[goal.activityId] ?? 0) / MINUTE;
              const minutes = Math.floor(totalMinutes);
              const weeklyProgress = goal.period === 'weekly'
                ? calculateGoalProgress(goal, minutes)
                : null;
              const dailySummary = goal.period === 'daily'
                ? summarizeDailyGoal(goal, aggregate.byDay, nowTimestamp)
                : null;
              const name = activityName(activityById, goal.activityId);
              return (
                <li
                  aria-label={`${name} ${goal.period} ${goal.direction} progress`}
                  key={goal.id}
                >
                  <div>
                    <strong>
                      {name} {goal.period} {goal.direction}
                    </strong>
                    <span>
                      {dailySummary === null
                        ? describeGoal(weeklyProgress!)
                        : dailySummary.sentence}
                    </span>
                    {dailySummary?.partialDaySentence !== null
                      && dailySummary?.partialDaySentence !== undefined
                      && <span>{dailySummary.partialDaySentence}</span>}
                  </div>
                  <progress
                    aria-label={`${name} goal progress`}
                    max={dailySummary?.elapsedDays ?? goal.targetMinutes}
                    value={dailySummary?.metDays ?? Math.min(minutes, goal.targetMinutes)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="week-panel" aria-labelledby="emotion-heading">
        <div className="week-panel__heading">
          <div>
            <p className="week-kicker">Check-ins</p>
            <h2 id="emotion-heading">Emotion overview</h2>
          </div>
        </div>
        {emotionSummary.chronological.length === 0 ? (
          <p className="week-muted">No emotion check-ins were recorded in this week.</p>
        ) : (
          <>
            <ul className="week-emotion-totals" aria-label="Emotion totals and intensities">
              {emotions.flatMap((emotion) => {
                const count = emotionSummary.countsByEmotion[emotion.id] ?? 0;
                if (count === 0) return [];
                return [
                  <li aria-label={`${emotion.name} emotion summary`} key={emotion.id}>
                    <strong>{emotion.name}</strong>
                    <span>{count} {count === 1 ? 'check-in' : 'check-ins'}</span>
                    <span>
                      Intensity {countIntensity(emotionSummary.intensitiesByEmotion[emotion.id] ?? [])}
                    </span>
                  </li>,
                ];
              })}
            </ul>
            <ul className="week-emotion-days" aria-label="Emotion counts by day">
              {emotionSummary.countsByDay.flatMap(({ range: dayRange, countsByEmotion }) => {
                const counts = emotions.flatMap((emotion) => {
                  const count = countsByEmotion[emotion.id] ?? 0;
                  return count > 0 ? [`${emotion.name} ${count}`] : [];
                });
                return counts.length === 0 ? [] : [
                  <li key={dayRange.start}>
                    {new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(dayRange.start)}: {counts.join(', ')}
                  </li>,
                ];
              })}
            </ul>
            <div className="week-emotion-frequencies">
              <section aria-labelledby="emotion-activity-frequency-heading">
                <h3 id="emotion-activity-frequency-heading">By associated activity</h3>
                <ul aria-label="Emotion frequency by associated activity">
                  {activities.flatMap((activity) => {
                    const counts = emotionSummary.countsByActivity[activity.id];
                    if (counts === undefined) return [];
                    return [
                      <li key={activity.id}>
                        <strong>{activity.name}:</strong>{' '}
                        {describeEmotionFrequencies(counts, emotions)}
                      </li>,
                    ];
                  })}
                </ul>
              </section>
              <section aria-labelledby="emotion-time-frequency-heading">
                <h3 id="emotion-time-frequency-heading">By time of day</h3>
                <ul aria-label="Emotion frequency by time band">
                  {TIME_BANDS.map((band) => (
                    <li key={band}>
                      <strong>{capitalize(band)}:</strong>{' '}
                      {describeEmotionFrequencies(
                        emotionSummary.countsByTimeBand[band],
                        emotions,
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <ol className="week-mood-strip" aria-label="Chronological mood strip">
              {emotionSummary.chronological.map((entry) => {
                const emotion = emotionById.get(entry.emotionId);
                return (
                  <li key={entry.id} style={{ '--emotion-color': emotion?.color ?? '#777777' } as CSSProperties}>
                    <time dateTime={new Date(entry.recordedAt).toISOString()}>
                      {formatShortDay(entry.recordedAt)} at {formatTime(entry.recordedAt, preferences.hourCycle)}
                    </time>
                    <strong>{emotion?.name ?? 'Unknown emotion'}</strong>
                    <span>Intensity {entry.intensity}</span>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      <section className="week-panel" aria-labelledby="patterns-heading" aria-label="Observed patterns">
        <div className="week-panel__heading">
          <div>
            <p className="week-kicker">Descriptive only</p>
            <h2 id="patterns-heading">Observed patterns</h2>
          </div>
        </div>
        {emotionSummary.patterns.length === 0 ? (
          <p className="week-muted">Add at least three related check-ins to see an observed pattern.</p>
        ) : (
          <ul className="week-patterns">
            {emotionSummary.patterns.map((pattern) => (
              <li key={`${pattern.kind}-${pattern.subject}`}>{pattern.sentence}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
