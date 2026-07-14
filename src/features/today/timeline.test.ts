import type { Session } from '../../domain/models';
import {
  clipSessionToRange,
  findTimelineGaps,
  getLocalDayRange,
  resolveConflict,
  summarizeDay,
  validateSessionCandidate,
} from './timeline';

const HOUR = 3_600_000;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-study',
    activityId: 'activity-study',
    startedAt: HOUR,
    endedAt: 2 * HOUR,
    createdAt: HOUR,
    updatedAt: HOUR,
    ...overrides,
  };
}

describe('Today timeline calculations', () => {
  it('uses local calendar constructors for the next day boundary', () => {
    const date = new Date(2026, 2, 8, 12);

    expect(getLocalDayRange(date)).toEqual({
      start: new Date(2026, 2, 8).getTime(),
      end: new Date(2026, 2, 9).getTime(),
    });
  });

  it('splits reporting at local midnight without mutating storage', () => {
    const range = {
      start: new Date(2026, 6, 13).getTime(),
      end: new Date(2026, 6, 14).getTime(),
    };
    const session = makeSession({
      startedAt: range.start - HOUR,
      endedAt: range.start + HOUR / 2,
    });

    expect(clipSessionToRange(session, range)).toMatchObject({
      startedAt: range.start,
      endedAt: range.start + HOUR / 2,
    });
    expect(session.startedAt).toBe(range.start - HOUR);
  });

  it('clips an active session start while preserving its active status', () => {
    const range = { start: 10 * HOUR, end: 34 * HOUR };
    const active = makeSession({ startedAt: 9 * HOUR, endedAt: null });

    expect(clipSessionToRange(active, range)).toMatchObject({
      startedAt: range.start,
      endedAt: null,
    });
    expect(active).toMatchObject({ startedAt: 9 * HOUR, endedAt: null });
  });

  it('reports only positive internal gaps, not time before or after recorded events', () => {
    const range = { start: 0, end: 10 * HOUR };
    const sessions = [
      makeSession({ id: 'later', startedAt: 5 * HOUR, endedAt: 7 * HOUR }),
      makeSession({ id: 'earlier', startedAt: HOUR, endedAt: 3 * HOUR }),
    ];

    expect(findTimelineGaps(sessions, range, 9 * HOUR)).toEqual([
      { start: 3 * HOUR, end: 5 * HOUR, durationMs: 2 * HOUR },
    ]);
  });

  it('uses the current time as the visible end of an active session', () => {
    const range = { start: 0, end: 10 * HOUR };
    const sessions = [
      makeSession({ id: 'complete', startedAt: HOUR, endedAt: 2 * HOUR }),
      makeSession({ id: 'active', startedAt: 4 * HOUR, endedAt: null }),
    ];

    expect(findTimelineGaps(sessions, range, 6 * HOUR)).toEqual([
      { start: 2 * HOUR, end: 4 * HOUR, durationMs: 2 * HOUR },
    ]);
  });

  it('bounds gaps by emotion events before and after sessions and subtracts tracked intervals', () => {
    const range = { start: 0, end: 10 * HOUR };
    const sessions = [
      makeSession({ id: 'study', startedAt: HOUR, endedAt: 3 * HOUR }),
      makeSession({ id: 'exercise', startedAt: 5 * HOUR, endedAt: 7 * HOUR }),
    ];
    const entries = [
      { recordedAt: HOUR / 2 },
      { recordedAt: 8 * HOUR },
    ];

    expect(findTimelineGaps(sessions, range, 9 * HOUR, entries)).toEqual([
      { start: HOUR / 2, end: HOUR, durationMs: HOUR / 2 },
      { start: 3 * HOUR, end: 5 * HOUR, durationMs: 2 * HOUR },
      { start: 7 * HOUR, end: 8 * HOUR, durationMs: HOUR },
    ]);
  });

  it('uses two emotion-only events as the visible span without extending to day boundaries', () => {
    const range = { start: 0, end: 10 * HOUR };
    const entries = [{ recordedAt: 2 * HOUR }, { recordedAt: 6 * HOUR }];

    expect(findTimelineGaps([], range, 9 * HOUR, entries)).toEqual([
      { start: 2 * HOUR, end: 6 * HOUR, durationMs: 4 * HOUR },
    ]);
    expect(summarizeDay([], range, 9 * HOUR, entries)).toEqual({
      trackedMs: 0,
      untrackedMs: 4 * HOUR,
      byActivity: {},
    });
  });

  it('summarizes tracked, per-activity, and internal untracked time from clipped records', () => {
    const range = { start: 2 * HOUR, end: 12 * HOUR };
    const sessions = [
      makeSession({ id: 'study-one', startedAt: HOUR, endedAt: 4 * HOUR }),
      makeSession({ id: 'exercise', activityId: 'activity-exercise', startedAt: 5 * HOUR, endedAt: 7 * HOUR }),
      makeSession({ id: 'study-two', startedAt: 9 * HOUR, endedAt: null }),
    ];

    expect(summarizeDay(sessions, range, 10 * HOUR)).toEqual({
      trackedMs: 5 * HOUR,
      untrackedMs: 3 * HOUR,
      byActivity: {
        'activity-study': 3 * HOUR,
        'activity-exercise': 2 * HOUR,
      },
    });
  });
});

describe('Today session validation and conflict resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(20 * HOUR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['zero', 2 * HOUR, 2 * HOUR],
    ['negative', 3 * HOUR, 2 * HOUR],
  ])('rejects a %s duration', (_name, startedAt, endedAt) => {
    const candidate = makeSession({ startedAt, endedAt });

    expect(validateSessionCandidate(candidate, [])).toEqual({
      ok: false,
      reason: 'non-positive',
      conflicts: [],
    });
  });

  it('rejects moving an active session start into the future', () => {
    const candidate = makeSession({ startedAt: 21 * HOUR, endedAt: null });

    expect(validateSessionCandidate(candidate, [])).toEqual({
      ok: false,
      reason: 'future-start',
      conflicts: [],
    });
  });

  it('rejects overlap while allowing sessions that touch at an endpoint', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: 4 * HOUR });
    const touching = makeSession({ id: 'touching', startedAt: HOUR, endedAt: 2 * HOUR });
    const overlapping = makeSession({ id: 'overlap', startedAt: 3 * HOUR, endedAt: 5 * HOUR });

    expect(validateSessionCandidate(candidate, [touching])).toEqual({ ok: true });
    expect(validateSessionCandidate(candidate, [touching, overlapping])).toEqual({
      ok: false,
      reason: 'overlap',
      conflicts: [overlapping],
    });
  });

  it('shortens the candidate against both a left and right conflict without changing neighbors', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: 8 * HOUR });
    const left = makeSession({ id: 'left', startedAt: HOUR, endedAt: 3 * HOUR });
    const right = makeSession({ id: 'right', startedAt: 7 * HOUR, endedAt: 9 * HOUR });

    expect(resolveConflict(candidate, [right, left], 'shorten-candidate')).toEqual({
      candidate: { ...candidate, startedAt: 3 * HOUR, endedAt: 7 * HOUR },
      neighborUpdates: [],
    });
  });

  it('trims the left neighbor end at the candidate start', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: 4 * HOUR });
    const left = makeSession({ id: 'left', startedAt: HOUR, endedAt: 3 * HOUR });

    expect(resolveConflict(candidate, [left], 'trim-neighbors')).toEqual({
      candidate,
      neighborUpdates: [{ ...left, endedAt: candidate.startedAt }],
    });
  });

  it('trims the right neighbor start at the candidate end', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: 4 * HOUR });
    const right = makeSession({ id: 'right', startedAt: 3 * HOUR, endedAt: 5 * HOUR });

    expect(resolveConflict(candidate, [right], 'trim-neighbors')).toEqual({
      candidate,
      neighborUpdates: [{ ...right, startedAt: candidate.endedAt }],
    });
  });

  it('rejects shortening an active candidate and leaves it open', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: null });
    const future = makeSession({ id: 'future', startedAt: 4 * HOUR, endedAt: 5 * HOUR });
    const original = structuredClone(candidate);

    expect(() => resolveConflict(candidate, [future], 'shorten-candidate'))
      .toThrow('An active entry must stay open');
    expect(candidate).toEqual(original);
    expect(candidate.endedAt).toBeNull();
  });

  it('trims only a previous neighbor when the active candidate moves into it', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: null });
    const previous = makeSession({ id: 'previous', startedAt: HOUR, endedAt: 3 * HOUR });

    expect(resolveConflict(candidate, [previous], 'trim-neighbors')).toEqual({
      candidate,
      neighborUpdates: [{ ...previous, endedAt: candidate.startedAt }],
    });
    expect(candidate.endedAt).toBeNull();
  });

  it('rejects trimming a future neighbor around an active candidate without mutating either record', () => {
    const candidate = makeSession({ startedAt: 2 * HOUR, endedAt: null });
    const future = makeSession({ id: 'future', startedAt: 4 * HOUR, endedAt: 5 * HOUR });
    const originals = structuredClone([candidate, future]);

    expect(() => resolveConflict(candidate, [future], 'trim-neighbors'))
      .toThrow('A future neighboring entry cannot be trimmed while this entry stays active');
    expect([candidate, future]).toEqual(originals);
  });
});
