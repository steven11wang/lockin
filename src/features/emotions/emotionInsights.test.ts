import type {
  Activity,
  DateRange,
  Emotion,
  EmotionEntry,
} from '../../domain/models';
import {
  buildActivityPatterns,
  buildTimeBandPatterns,
  summarizeEmotions,
} from './emotionInsights';

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
const retiredEmotion: Emotion = {
  id: 'emotion-retired',
  name: 'Reflective',
  color: '#777777',
  sortOrder: 99,
  archivedAt: new Date(2026, 6, 10).getTime(),
};
const exercise: Activity = {
  id: 'activity-exercise',
  name: 'Exercise',
  color: '#2E9D68',
  sortOrder: 1,
  quickSlot: 1,
  archivedAt: null,
};
const archivedActivity: Activity = {
  id: 'activity-archived',
  name: 'Old routine',
  color: '#555555',
  sortOrder: 99,
  quickSlot: null,
  archivedAt: new Date(2026, 6, 10).getTime(),
};

function at(day: number, hour = 9, minute = 0): number {
  return new Date(2026, 6, day, hour, minute).getTime();
}

function entry(
  id: string,
  emotionId: string,
  recordedAt: number,
  options: {
    intensity?: EmotionEntry['intensity'];
    activityId?: string | null;
  } = {},
): EmotionEntry {
  return {
    id,
    emotionId,
    intensity: options.intensity ?? 3,
    comment: '',
    recordedAt,
    activityId: 'activityId' in options ? options.activityId! : exercise.id,
    sessionId: null,
    createdAt: recordedAt,
    updatedAt: recordedAt,
  };
}

describe('emotion summaries', () => {
  it('counts by emotion and local day, keeps within-emotion intensity distributions, and orders the mood strip', () => {
    const range: DateRange = { start: at(13, 0), end: at(15, 0) };
    const entries = [
      entry('later-calm', calm.id, at(14, 18), { intensity: 5 }),
      entry('outside', calm.id, at(15, 1), { intensity: 1 }),
      entry('early-happy', happy.id, at(13, 8), { intensity: 4 }),
      entry('early-calm', calm.id, at(13, 9), { intensity: 2 }),
    ];

    const summary = summarizeEmotions(entries, [calm, happy], [exercise], range);

    expect(summary.countsByEmotion).toEqual({
      [calm.id]: 2,
      [happy.id]: 1,
    });
    expect(summary.intensitiesByEmotion).toEqual({
      [happy.id]: [4],
      [calm.id]: [2, 5],
    });
    expect(summary.countsByDay).toEqual([
      {
        range: { start: at(13, 0), end: at(14, 0) },
        countsByEmotion: { [happy.id]: 1, [calm.id]: 1 },
      },
      {
        range: { start: at(14, 0), end: at(15, 0) },
        countsByEmotion: { [calm.id]: 1 },
      },
    ]);
    expect(summary.chronological.map(({ id }) => id)).toEqual([
      'early-happy',
      'early-calm',
      'later-calm',
    ]);
  });

  it('derives activity and broad local-time frequencies without a pattern threshold', () => {
    const range: DateRange = { start: at(13, 0), end: at(14, 0) };
    const entries = [
      entry('morning-calm', calm.id, at(13, 5, 0)),
      entry('afternoon-happy', happy.id, at(13, 12, 0)),
      entry('evening-calm', calm.id, at(13, 17, 0), { activityId: null }),
      entry('night-happy', happy.id, at(13, 22, 0), { activityId: null }),
    ];

    const summary = summarizeEmotions(entries, [calm, happy], [exercise], range);

    expect(summary.countsByActivity).toEqual({
      [exercise.id]: { [calm.id]: 1, [happy.id]: 1 },
    });
    expect(summary.countsByTimeBand).toEqual({
      morning: { [calm.id]: 1 },
      afternoon: { [happy.id]: 1 },
      evening: { [calm.id]: 1 },
      night: { [happy.id]: 1 },
    });
    expect(summary.patterns).toEqual([]);
  });
});

describe('qualified emotion patterns', () => {
  it('requires three check-ins before describing an activity pattern', () => {
    const twoExerciseEntries = [
      entry('one', calm.id, at(13, 8)),
      entry('two', happy.id, at(13, 9)),
    ];
    const threeExerciseEntries = [
      ...twoExerciseEntries,
      entry('three', calm.id, at(13, 10)),
    ];

    expect(buildActivityPatterns(twoExerciseEntries, [calm, happy], [exercise])).toEqual([]);
    expect(
      buildActivityPatterns(threeExerciseEntries, [calm, happy], [exercise])[0]?.sampleSize,
    ).toBe(3);
  });

  it('ignores null activity links and retains archived activity and emotion labels', () => {
    const entries = [
      entry('unlinked', calm.id, at(13, 7), { activityId: null }),
      entry('old-1', retiredEmotion.id, at(13, 8), { activityId: archivedActivity.id }),
      entry('old-2', retiredEmotion.id, at(13, 9), { activityId: archivedActivity.id }),
      entry('old-3', retiredEmotion.id, at(13, 10), { activityId: archivedActivity.id }),
    ];

    expect(
      buildActivityPatterns(entries, [calm, retiredEmotion], [exercise, archivedActivity]),
    ).toEqual([
      expect.objectContaining({
        kind: 'activity',
        subject: 'Old routine',
        emotionNames: ['Reflective'],
        sampleSize: 3,
      }),
    ]);
  });

  it('uses the exact morning, afternoon, evening, and night boundaries', () => {
    const bandEntries = [
      ...([[4, 59], [22, 0], [23, 59]] as const).map(([hour, minute], index) => (
        entry(`night-${index}`, calm.id, at(13, hour, minute))
      )),
      ...([[5, 0], [11, 0], [11, 59]] as const).map(([hour, minute], index) => (
        entry(`morning-${index}`, calm.id, at(13, hour, minute))
      )),
      ...([[12, 0], [16, 0], [16, 59]] as const).map(([hour, minute], index) => (
        entry(`afternoon-${index}`, happy.id, at(13, hour, minute))
      )),
      ...([[17, 0], [21, 0], [21, 59]] as const).map(([hour, minute], index) => (
        entry(`evening-${index}`, happy.id, at(13, hour, minute))
      )),
    ];

    expect(
      buildTimeBandPatterns(bandEntries, [calm, happy]).map(({ subject, sampleSize }) => ({
        subject,
        sampleSize,
      })),
    ).toEqual([
      { subject: 'Afternoon', sampleSize: 3 },
      { subject: 'Evening', sampleSize: 3 },
      { subject: 'Morning', sampleSize: 3 },
      { subject: 'Night', sampleSize: 3 },
    ]);
  });

  it('returns at most five patterns by sample size then subject with non-causal wording', () => {
    const activities = Array.from({ length: 6 }, (_, index): Activity => ({
      ...exercise,
      id: `activity-${index}`,
      name: `Activity ${index}`,
      quickSlot: null,
      sortOrder: index,
    }));
    const entries = activities.flatMap((activity, activityIndex) => (
      Array.from({ length: activityIndex + 3 }, (_, entryIndex) => entry(
        `${activity.id}-${entryIndex}`,
        entryIndex % 2 === 0 ? calm.id : happy.id,
        at(13, 8, activityIndex * 5 + entryIndex),
        { activityId: activity.id },
      ))
    ));
    const range: DateRange = { start: at(13, 0), end: at(14, 0) };

    const patterns = summarizeEmotions(entries, [calm, happy], activities, range).patterns;

    expect(patterns).toHaveLength(5);
    expect(patterns.map(({ subject, sampleSize }) => [subject, sampleSize])).toEqual([
      ['Morning', 33],
      ['Activity 5', 8],
      ['Activity 4', 7],
      ['Activity 3', 6],
      ['Activity 2', 5],
    ]);
    for (const pattern of patterns) {
      expect(pattern.sentence).toMatch(/observed pattern/i);
      expect(pattern.sentence).toContain(String(pattern.sampleSize));
      expect(pattern.sentence).not.toMatch(/caused|diagnosis|treatment/i);
    }
  });
});
