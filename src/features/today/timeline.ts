import type { DateRange, EmotionEntry, Id, Session } from '../../domain/models';

export interface TimelineGap {
  start: number;
  end: number;
  durationMs: number;
}

export interface DaySummary {
  trackedMs: number;
  untrackedMs: number;
  byActivity: Record<Id, number>;
}

export type SessionValidation =
  | { ok: true }
  | { ok: false; reason: 'non-positive' | 'future-start' | 'overlap'; conflicts: Session[] };

export type ConflictChoice = 'shorten-candidate' | 'trim-neighbors';

export interface ConflictResolution {
  candidate: Session;
  neighborUpdates: Session[];
}

interface VisibleSession {
  session: Session;
  start: number;
  end: number;
}

export function getLocalDayRange(date: Date): DateRange {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  return {
    start: new Date(year, month, day).getTime(),
    end: new Date(year, month, day + 1).getTime(),
  };
}

export function clipSessionToRange(session: Session, range: DateRange): Session | null {
  const effectiveEnd = session.endedAt ?? Number.POSITIVE_INFINITY;
  if (session.startedAt >= range.end || effectiveEnd <= range.start) return null;

  return {
    ...session,
    startedAt: Math.max(session.startedAt, range.start),
    endedAt: session.endedAt === null ? null : Math.min(session.endedAt, range.end),
  };
}

function getVisibleSessions(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
): VisibleSession[] {
  return sessions.flatMap((session) => {
    const clipped = clipSessionToRange(session, range);
    if (clipped === null) return [];
    const end = Math.min(clipped.endedAt ?? now, range.end);
    if (end <= clipped.startedAt) return [];
    return [{ session: clipped, start: clipped.startedAt, end }];
  }).sort((left, right) => left.start - right.start);
}

function findGapsInEventSpan(
  visible: readonly VisibleSession[],
  range: DateRange,
  emotionEntries: readonly Pick<EmotionEntry, 'recordedAt'>[],
): TimelineGap[] {
  const eventTimestamps = [
    ...visible.flatMap((item) => [item.start, item.end]),
    ...emotionEntries.flatMap((entry) => (
      entry.recordedAt >= range.start && entry.recordedAt < range.end
        ? [entry.recordedAt]
        : []
    )),
  ];
  if (eventTimestamps.length < 2) return [];

  const spanStart = Math.min(...eventTimestamps);
  const spanEnd = Math.max(...eventTimestamps);
  if (spanEnd <= spanStart) return [];
  const gaps: TimelineGap[] = [];
  let coveredUntil = spanStart;

  for (const current of visible) {
    if (current.end <= spanStart || current.start >= spanEnd) continue;
    if (current.start > coveredUntil) {
      const end = Math.min(current.start, spanEnd);
      gaps.push({
        start: coveredUntil,
        end,
        durationMs: end - coveredUntil,
      });
    }
    coveredUntil = Math.max(coveredUntil, current.end);
    if (coveredUntil >= spanEnd) break;
  }

  if (coveredUntil < spanEnd) {
    gaps.push({
      start: coveredUntil,
      end: spanEnd,
      durationMs: spanEnd - coveredUntil,
    });
  }

  return gaps;
}

export function findTimelineGaps(
  sessions: readonly Session[],
  range: DateRange,
  now = Date.now(),
  emotionEntries: readonly Pick<EmotionEntry, 'recordedAt'>[] = [],
): TimelineGap[] {
  return findGapsInEventSpan(
    getVisibleSessions(sessions, range, now),
    range,
    emotionEntries,
  );
}

export function summarizeDay(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
  emotionEntries: readonly Pick<EmotionEntry, 'recordedAt'>[] = [],
): DaySummary {
  const visible = getVisibleSessions(sessions, range, now);
  const byActivity: Record<Id, number> = {};
  let trackedMs = 0;

  for (const item of visible) {
    const duration = item.end - item.start;
    trackedMs += duration;
    byActivity[item.session.activityId] = (byActivity[item.session.activityId] ?? 0) + duration;
  }

  return {
    trackedMs,
    untrackedMs: findGapsInEventSpan(visible, range, emotionEntries)
      .reduce((total, gap) => total + gap.durationMs, 0),
    byActivity,
  };
}

function sessionsOverlap(left: Session, right: Session): boolean {
  const leftEnd = left.endedAt ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.endedAt ?? Number.POSITIVE_INFINITY;
  return left.startedAt < rightEnd && right.startedAt < leftEnd;
}

export function validateSessionCandidate(
  candidate: Session,
  neighbors: readonly Session[],
): SessionValidation {
  if (candidate.endedAt !== null && candidate.endedAt <= candidate.startedAt) {
    return { ok: false, reason: 'non-positive', conflicts: [] };
  }
  if (candidate.endedAt === null && candidate.startedAt > Date.now()) {
    return { ok: false, reason: 'future-start', conflicts: [] };
  }

  const conflicts = neighbors.filter((neighbor) => (
    neighbor.id !== candidate.id && sessionsOverlap(candidate, neighbor)
  ));

  return conflicts.length === 0
    ? { ok: true }
    : { ok: false, reason: 'overlap', conflicts };
}

export function resolveConflict(
  candidate: Session,
  conflicts: readonly Session[],
  choice: ConflictChoice,
): ConflictResolution {
  if (choice === 'shorten-candidate') {
    if (candidate.endedAt === null) {
      throw new Error('An active entry must stay open and cannot be shortened.');
    }
    let startedAt = candidate.startedAt;
    let endedAt = candidate.endedAt;

    for (const conflict of conflicts) {
      if (conflict.startedAt <= candidate.startedAt) {
        startedAt = Math.max(startedAt, conflict.endedAt ?? Number.POSITIVE_INFINITY);
      } else if (endedAt === null || conflict.startedAt < endedAt) {
        endedAt = conflict.startedAt;
      }
    }

    if (!Number.isFinite(startedAt) || (endedAt !== null && endedAt <= startedAt)) {
      throw new Error('This entry cannot be shortened to avoid the selected conflicts.');
    }

    return {
      candidate: { ...candidate, startedAt, endedAt },
      neighborUpdates: [],
    };
  }

  if (candidate.endedAt === null && conflicts.some((neighbor) => (
    neighbor.startedAt >= candidate.startedAt
  ))) {
    throw new Error('A future neighboring entry cannot be trimmed while this entry stays active.');
  }

  const neighborUpdates = conflicts.map((neighbor) => {
    const update = neighbor.startedAt < candidate.startedAt
      ? { ...neighbor, endedAt: candidate.startedAt }
      : { ...neighbor, startedAt: candidate.endedAt ?? Number.POSITIVE_INFINITY };
    if (!Number.isFinite(update.startedAt) || update.endedAt !== null && update.endedAt <= update.startedAt) {
      throw new Error('A neighboring entry cannot be trimmed without removing it.');
    }
    return update;
  });

  return { candidate, neighborUpdates };
}
