import type { DateRange, EmotionEntry, Session } from '../../domain/models';
import { clipSessionToRange } from './timeline';

export type ClockHalf = 'am' | 'pm';

export interface ClockSessionSegment {
  kind: 'session';
  start: number;
  end: number;
  durationMs: number;
  session: Session;
  storedSession: Session;
}

export interface ClockUntrackedSegment {
  kind: 'untracked';
  start: number;
  end: number;
  durationMs: number;
}

export type ClockSegment = ClockSessionSegment | ClockUntrackedSegment;

export interface ClockEmotionMarker {
  entry: EmotionEntry;
  recordedAt: number;
}

const HALF_DAY_MS = 12 * 60 * 60 * 1_000;

export function getHalfDayRange(dayStart: number, half: ClockHalf): DateRange {
  if (half === 'am') {
    return { start: dayStart, end: dayStart + HALF_DAY_MS };
  }
  return { start: dayStart + HALF_DAY_MS, end: dayStart + 2 * HALF_DAY_MS };
}

export function timestampToAngleDegrees(timestamp: number, range: DateRange): number {
  const span = range.end - range.start;
  if (span <= 0) return 0;
  const progress = (timestamp - range.start) / span;
  return ((progress % 1) + 1) % 1 * 360;
}

export function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleDegrees: number,
): { x: number; y: number } {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(radians),
    y: centerY + radius * Math.sin(radians),
  };
}

export function describeArc(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += 360;
  // Full-circle arcs need a tiny split so SVG renders a complete ring.
  if (sweep >= 359.999) {
    const mid = startAngle + 180;
    return `${describeArc(centerX, centerY, radius, startAngle, mid)} ${describeArc(centerX, centerY, radius, mid, startAngle + 360)}`;
  }

  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
  ].join(' ');
}

export function describeDonutSlice(
  centerX: number,
  centerY: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += 360;
  if (sweep >= 359.999) {
    return [
      'M', centerX, centerY - outerRadius,
      'A', outerRadius, outerRadius, 0, 1, 1, centerX + 0.001, centerY - outerRadius,
      'L', centerX + 0.001, centerY - innerRadius,
      'A', innerRadius, innerRadius, 0, 1, 0, centerX, centerY - innerRadius,
      'Z',
    ].join(' ');
  }

  const outerStart = polarToCartesian(centerX, centerY, outerRadius, startAngle);
  const outerEnd = polarToCartesian(centerX, centerY, outerRadius, endAngle);
  const innerStart = polarToCartesian(centerX, centerY, innerRadius, endAngle);
  const innerEnd = polarToCartesian(centerX, centerY, innerRadius, startAngle);
  const largeArcFlag = sweep > 180 ? 1 : 0;

  return [
    'M', outerStart.x, outerStart.y,
    'A', outerRadius, outerRadius, 0, largeArcFlag, 1, outerEnd.x, outerEnd.y,
    'L', innerStart.x, innerStart.y,
    'A', innerRadius, innerRadius, 0, largeArcFlag, 0, innerEnd.x, innerEnd.y,
    'Z',
  ].join(' ');
}

interface VisibleSession {
  stored: Session;
  clipped: Session;
  start: number;
  end: number;
}

function getVisibleSessions(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
): VisibleSession[] {
  return sessions.flatMap((session) => {
    const clipped = clipSessionToRange(session, range);
    if (clipped === null) return [];
    const end = Math.min(clipped.endedAt ?? now, range.end, now);
    if (end <= clipped.startedAt) return [];
    return [{
      stored: session,
      clipped,
      start: clipped.startedAt,
      end,
    }];
  }).sort((left, right) => left.start - right.start);
}

/**
 * Builds session and untracked segments covering [range.start, min(now, range.end)].
 * Untracked segments are the empty/dark gaps between tracked work in that window.
 */
export function buildClockSegments(
  sessions: readonly Session[],
  range: DateRange,
  now: number,
): ClockSegment[] {
  const windowEnd = Math.min(now, range.end);
  if (windowEnd <= range.start) return [];

  const visible = getVisibleSessions(sessions, range, now);
  const segments: ClockSegment[] = [];
  let cursor = range.start;

  for (const item of visible) {
    if (item.start > cursor) {
      const end = Math.min(item.start, windowEnd);
      if (end > cursor) {
        segments.push({
          kind: 'untracked',
          start: cursor,
          end,
          durationMs: end - cursor,
        });
      }
    }

    const sessionEnd = Math.min(item.end, windowEnd);
    if (sessionEnd > item.start && item.start < windowEnd) {
      const start = Math.max(item.start, range.start);
      if (sessionEnd > start) {
        segments.push({
          kind: 'session',
          start,
          end: sessionEnd,
          durationMs: sessionEnd - start,
          session: item.clipped,
          storedSession: item.stored,
        });
      }
    }

    cursor = Math.max(cursor, Math.min(item.end, windowEnd));
    if (cursor >= windowEnd) break;
  }

  if (cursor < windowEnd) {
    segments.push({
      kind: 'untracked',
      start: cursor,
      end: windowEnd,
      durationMs: windowEnd - cursor,
    });
  }

  return segments;
}

export function clockEmotionMarkers(
  entries: readonly EmotionEntry[],
  range: DateRange,
): ClockEmotionMarker[] {
  return entries
    .filter((entry) => entry.recordedAt >= range.start && entry.recordedAt < range.end)
    .map((entry) => ({ entry, recordedAt: entry.recordedAt }))
    .sort((left, right) => left.recordedAt - right.recordedAt);
}
