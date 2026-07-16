import type { Session } from '../../domain/models';
import {
  buildClockSegments,
  clockEmotionMarkers,
  describeDonutSlice,
  getHalfDayRange,
  timestampToAngleDegrees,
} from './clockGeometry';

const DAY_START = new Date(2026, 6, 13).getTime();
const HOUR = 3_600_000;

function session(
  id: string,
  activityId: string,
  startOffsetMs: number,
  endOffsetMs: number | null,
): Session {
  const startedAt = DAY_START + startOffsetMs;
  return {
    id,
    activityId,
    startedAt,
    endedAt: endOffsetMs === null ? null : DAY_START + endOffsetMs,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

describe('clockGeometry', () => {
  it('splits a local day into AM and PM 12-hour ranges', () => {
    expect(getHalfDayRange(DAY_START, 'am')).toEqual({
      start: DAY_START,
      end: DAY_START + 12 * HOUR,
    });
    expect(getHalfDayRange(DAY_START, 'pm')).toEqual({
      start: DAY_START + 12 * HOUR,
      end: DAY_START + 24 * HOUR,
    });
  });

  it('maps timestamps to clock angles with noon/midnight at the top', () => {
    const am = getHalfDayRange(DAY_START, 'am');
    expect(timestampToAngleDegrees(DAY_START, am)).toBe(0);
    expect(timestampToAngleDegrees(DAY_START + 3 * HOUR, am)).toBe(90);
    expect(timestampToAngleDegrees(DAY_START + 6 * HOUR, am)).toBe(180);
    expect(timestampToAngleDegrees(DAY_START + 9 * HOUR, am)).toBe(270);
  });

  it('builds session arcs and untracked gaps up to now within a half-day', () => {
    const am = getHalfDayRange(DAY_START, 'am');
    const now = DAY_START + 11 * HOUR;
    const segments = buildClockSegments(
      [
        session('study', 'activity-study', 8 * HOUR, 9 * HOUR),
        session('exercise', 'activity-exercise', 10 * HOUR, 11 * HOUR),
      ],
      am,
      now,
    );

    expect(segments).toEqual([
      {
        kind: 'untracked',
        start: DAY_START,
        end: DAY_START + 8 * HOUR,
        durationMs: 8 * HOUR,
      },
      expect.objectContaining({
        kind: 'session',
        start: DAY_START + 8 * HOUR,
        end: DAY_START + 9 * HOUR,
        storedSession: expect.objectContaining({ id: 'study' }),
      }),
      {
        kind: 'untracked',
        start: DAY_START + 9 * HOUR,
        end: DAY_START + 10 * HOUR,
        durationMs: HOUR,
      },
      expect.objectContaining({
        kind: 'session',
        start: DAY_START + 10 * HOUR,
        end: DAY_START + 11 * HOUR,
        storedSession: expect.objectContaining({ id: 'exercise' }),
      }),
    ]);
  });

  it('clips an active session to now and leaves later untracked empty', () => {
    const pm = getHalfDayRange(DAY_START, 'pm');
    const now = DAY_START + 14 * HOUR;
    const segments = buildClockSegments(
      [session('work', 'activity-work', 13 * HOUR, null)],
      pm,
      now,
    );

    expect(segments).toEqual([
      {
        kind: 'untracked',
        start: DAY_START + 12 * HOUR,
        end: DAY_START + 13 * HOUR,
        durationMs: HOUR,
      },
      expect.objectContaining({
        kind: 'session',
        start: DAY_START + 13 * HOUR,
        end: now,
        session: expect.objectContaining({ endedAt: null }),
      }),
    ]);
  });

  it('places emotion markers only inside the half-day range', () => {
    const am = getHalfDayRange(DAY_START, 'am');
    const markers = clockEmotionMarkers(
      [
        {
          id: 'e1',
          emotionId: 'emotion-calm',
          intensity: 3,
          comment: '',
          recordedAt: DAY_START + 9 * HOUR,
          activityId: null,
          sessionId: null,
          createdAt: DAY_START + 9 * HOUR,
          updatedAt: DAY_START + 9 * HOUR,
        },
        {
          id: 'e2',
          emotionId: 'emotion-focused',
          intensity: 4,
          comment: '',
          recordedAt: DAY_START + 15 * HOUR,
          activityId: null,
          sessionId: null,
          createdAt: DAY_START + 15 * HOUR,
          updatedAt: DAY_START + 15 * HOUR,
        },
      ],
      am,
    );

    expect(markers.map((marker) => marker.entry.id)).toEqual(['e1']);
  });

  it('describes a closed donut slice path', () => {
    const path = describeDonutSlice(50, 50, 20, 40, 0, 90);
    expect(path.startsWith('M ')).toBe(true);
    expect(path.includes(' A ')).toBe(true);
    expect(path.endsWith(' Z')).toBe(true);
  });
});
