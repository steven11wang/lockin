import type {
  Activity,
  DateRange,
  Emotion,
  EmotionEntry,
  Id,
} from '../../domain/models';
import type { TimeBand } from '../week/aggregate';

const MINIMUM_PATTERN_SAMPLE = 3;
const MAXIMUM_PATTERNS = 5;

export interface EmotionPattern {
  kind: 'activity' | 'time-band';
  subject: string;
  emotionNames: string[];
  sampleSize: number;
  sentence: string;
}

export interface DailyEmotionCounts {
  range: DateRange;
  countsByEmotion: Record<Id, number>;
}

export interface EmotionSummary {
  countsByEmotion: Record<Id, number>;
  countsByDay: DailyEmotionCounts[];
  countsByActivity: Record<Id, Record<Id, number>>;
  countsByTimeBand: Record<TimeBand, Record<Id, number>>;
  intensitiesByEmotion: Record<Id, Array<1 | 2 | 3 | 4 | 5>>;
  chronological: EmotionEntry[];
  patterns: EmotionPattern[];
}

function localDayRanges(range: DateRange): DateRange[] {
  if (range.end <= range.start) return [];

  const start = new Date(range.start);
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const ranges: DateRange[] = [];

  while (cursor.getTime() < range.end) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    ranges.push({
      start: Math.max(range.start, cursor.getTime()),
      end: Math.min(range.end, next.getTime()),
    });
    cursor = next;
  }

  return ranges;
}

function timeBandFor(timestamp: number): TimeBand {
  const hour = new Date(timestamp).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function sortPatterns(patterns: EmotionPattern[]): EmotionPattern[] {
  return patterns.sort((left, right) => (
    right.sampleSize - left.sampleSize
    || left.subject.localeCompare(right.subject)
    || left.kind.localeCompare(right.kind)
  ));
}

function makePattern(
  kind: EmotionPattern['kind'],
  subject: string,
  entries: readonly EmotionEntry[],
  emotionById: ReadonlyMap<Id, Emotion>,
): EmotionPattern {
  const frequencies = new Map<Id, number>();
  for (const entry of entries) {
    frequencies.set(entry.emotionId, (frequencies.get(entry.emotionId) ?? 0) + 1);
  }
  const highestFrequency = Math.max(...frequencies.values());
  const leadingEmotions = [...frequencies.entries()]
    .filter(([, count]) => count === highestFrequency)
    .map(([emotionId]) => emotionById.get(emotionId)?.name ?? 'Unknown emotion')
    .sort((left, right) => left.localeCompare(right));
  const subjectPhrase = kind === 'activity' ? `during ${subject}` : `in the ${subject.toLowerCase()}`;
  const joinedNames = leadingEmotions.length === 1
    ? leadingEmotions[0]
    : `${leadingEmotions.slice(0, -1).join(', ')} or ${leadingEmotions.at(-1)}`;
  const leadingCount = highestFrequency * leadingEmotions.length;

  return {
    kind,
    subject,
    emotionNames: leadingEmotions,
    sampleSize: entries.length,
    sentence: `Observed pattern: ${leadingCount} of ${entries.length} check-ins ${subjectPhrase} were ${joinedNames}.`,
  };
}

export function buildActivityPatterns(
  entries: readonly EmotionEntry[],
  emotions: readonly Emotion[],
  activities: readonly Activity[],
): EmotionPattern[] {
  const emotionById = new Map(emotions.map((emotion) => [emotion.id, emotion]));
  const entriesByActivity = new Map<Id, EmotionEntry[]>();

  for (const entry of entries) {
    if (entry.activityId === null) continue;
    const grouped = entriesByActivity.get(entry.activityId) ?? [];
    grouped.push(entry);
    entriesByActivity.set(entry.activityId, grouped);
  }

  return sortPatterns(activities.flatMap((activity) => {
    const grouped = entriesByActivity.get(activity.id) ?? [];
    if (grouped.length < MINIMUM_PATTERN_SAMPLE) return [];
    return [makePattern('activity', activity.name, grouped, emotionById)];
  }));
}

export function buildTimeBandPatterns(
  entries: readonly EmotionEntry[],
  emotions: readonly Emotion[],
): EmotionPattern[] {
  const emotionById = new Map(emotions.map((emotion) => [emotion.id, emotion]));
  const entriesByBand = new Map<TimeBand, EmotionEntry[]>();

  for (const entry of entries) {
    const band = timeBandFor(entry.recordedAt);
    const grouped = entriesByBand.get(band) ?? [];
    grouped.push(entry);
    entriesByBand.set(band, grouped);
  }

  return sortPatterns([...entriesByBand.entries()].flatMap(([band, grouped]) => (
    grouped.length < MINIMUM_PATTERN_SAMPLE
      ? []
      : [makePattern('time-band', capitalize(band), grouped, emotionById)]
  )));
}

export function summarizeEmotions(
  entries: EmotionEntry[],
  emotions: Emotion[],
  activities: Activity[],
  range: DateRange,
): EmotionSummary {
  const chronological = entries
    .filter((entry) => entry.recordedAt >= range.start && entry.recordedAt < range.end)
    .sort((left, right) => left.recordedAt - right.recordedAt || left.id.localeCompare(right.id));
  const countsByEmotion: Record<Id, number> = {};
  const countsByActivity: Record<Id, Record<Id, number>> = {};
  const countsByTimeBand: Record<TimeBand, Record<Id, number>> = {
    morning: {},
    afternoon: {},
    evening: {},
    night: {},
  };
  const intensitiesByEmotion: Record<Id, Array<1 | 2 | 3 | 4 | 5>> = {};

  for (const entry of chronological) {
    countsByEmotion[entry.emotionId] = (countsByEmotion[entry.emotionId] ?? 0) + 1;
    const timeBandCounts = countsByTimeBand[timeBandFor(entry.recordedAt)];
    timeBandCounts[entry.emotionId] = (timeBandCounts[entry.emotionId] ?? 0) + 1;
    if (entry.activityId !== null) {
      const activityCounts = countsByActivity[entry.activityId] ?? {};
      activityCounts[entry.emotionId] = (activityCounts[entry.emotionId] ?? 0) + 1;
      countsByActivity[entry.activityId] = activityCounts;
    }
    const intensities = intensitiesByEmotion[entry.emotionId] ?? [];
    intensities.push(entry.intensity);
    intensitiesByEmotion[entry.emotionId] = intensities;
  }

  const countsByDay = localDayRanges(range).map((dayRange) => {
    const daily: Record<Id, number> = {};
    for (const entry of chronological) {
      if (entry.recordedAt < dayRange.start || entry.recordedAt >= dayRange.end) continue;
      daily[entry.emotionId] = (daily[entry.emotionId] ?? 0) + 1;
    }
    return { range: dayRange, countsByEmotion: daily };
  });

  return {
    countsByEmotion,
    countsByDay,
    countsByActivity,
    countsByTimeBand,
    intensitiesByEmotion,
    chronological,
    patterns: sortPatterns([
      ...buildActivityPatterns(chronological, emotions, activities),
      ...buildTimeBandPatterns(chronological, emotions),
    ]).slice(0, MAXIMUM_PATTERNS),
  };
}
