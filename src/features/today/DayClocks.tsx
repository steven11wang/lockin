import type { CSSProperties, JSX, KeyboardEvent } from 'react';
import type {
  Activity,
  Emotion,
  EmotionEntry,
  Id,
  Preferences,
  Session,
} from '../../domain/models';
import {
  buildClockSegments,
  clockEmotionMarkers,
  describeDonutSlice,
  getHalfDayRange,
  polarToCartesian,
  timestampToAngleDegrees,
  type ClockHalf,
  type ClockSegment,
} from './clockGeometry';

const VIEW = 100;
const CENTER = 50;
const OUTER = 42;
const INNER = 24;
const MARKER_RADIUS = 33;

export interface DayClocksProps {
  dayStart: number;
  now: number;
  sessions: readonly Session[];
  emotionEntries: readonly EmotionEntry[];
  activities: readonly Activity[];
  emotions: readonly Emotion[];
  hourCycle: Preferences['hourCycle'];
  onSelectSession: (session: Session) => void;
  onSelectGap: (start: number, end: number) => void;
  onSelectEmotion: (entry: EmotionEntry) => void;
  selectedEmotionId: Id | null;
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatTime(timestamp: number, hourCycle: Preferences['hourCycle']): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: hourCycle === 24 ? 'h23' : 'h12',
  }).format(timestamp);
}

function hourLabels(half: ClockHalf): ReadonlyArray<{ hour: number; label: string }> {
  if (half === 'am') {
    return [
      { hour: 0, label: '12' },
      { hour: 3, label: '3' },
      { hour: 6, label: '6' },
      { hour: 9, label: '9' },
    ];
  }
  return [
    { hour: 12, label: '12' },
    { hour: 15, label: '3' },
    { hour: 18, label: '6' },
    { hour: 21, label: '9' },
  ];
}

interface ClockFaceProps {
  half: ClockHalf;
  dayStart: number;
  now: number;
  sessions: readonly Session[];
  emotionEntries: readonly EmotionEntry[];
  activityById: Map<Id, Activity>;
  emotionById: Map<Id, Emotion>;
  hourCycle: Preferences['hourCycle'];
  onSelectSession: (session: Session) => void;
  onSelectGap: (start: number, end: number) => void;
  onSelectEmotion: (entry: EmotionEntry) => void;
  selectedEmotionId: Id | null;
}

function segmentLabel(
  segment: ClockSegment,
  activityById: Map<Id, Activity>,
  hourCycle: Preferences['hourCycle'],
): string {
  const range = `${formatTime(segment.start, hourCycle)} to ${formatTime(segment.end, hourCycle)}`;
  if (segment.kind === 'session') {
    const name = activityById.get(segment.storedSession.activityId)?.name ?? 'Activity';
    return `${name}, ${range}, ${formatDuration(segment.durationMs)}`;
  }
  return `Untracked, ${range}, ${formatDuration(segment.durationMs)}. Add entry`;
}

function ClockFace({
  half,
  dayStart,
  now,
  sessions,
  emotionEntries,
  activityById,
  emotionById,
  hourCycle,
  onSelectSession,
  onSelectGap,
  onSelectEmotion,
  selectedEmotionId,
}: ClockFaceProps): JSX.Element {
  const range = getHalfDayRange(dayStart, half);
  const segments = buildClockSegments(sessions, range, now);
  const markers = clockEmotionMarkers(emotionEntries, range);
  const title = half === 'am' ? 'Morning' : 'Afternoon & evening';
  const subtitle = half === 'am' ? '12 AM – 12 PM' : '12 PM – 12 AM';

  const activateSegment = (segment: ClockSegment) => {
    if (segment.kind === 'session') {
      onSelectSession(segment.storedSession);
      return;
    }
    onSelectGap(segment.start, segment.end);
  };

  const onSegmentKeyDown = (event: KeyboardEvent<SVGPathElement>, segment: ClockSegment) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateSegment(segment);
    }
  };

  const captionId = `day-clock-caption-${half}`;

  return (
    <figure className="day-clock" aria-labelledby={captionId}>
      <figcaption className="day-clock__caption" id={captionId}>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </figcaption>
      <svg
        className="day-clock__svg"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="group"
        aria-label={`${title} clock, ${subtitle}`}
      >
        <circle
          className="day-clock__face"
          cx={CENTER}
          cy={CENTER}
          r={OUTER}
        />
        <circle
          className="day-clock__inner"
          cx={CENTER}
          cy={CENTER}
          r={INNER}
        />

        {hourLabels(half).map(({ hour, label }) => {
          const angle = (hour % 12) * 30;
          const point = polarToCartesian(CENTER, CENTER, OUTER + 5.5, angle);
          return (
            <text
              key={`${half}-${hour}`}
              className="day-clock__hour"
              x={point.x}
              y={point.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {label}
            </text>
          );
        })}

        {segments.map((segment) => {
          const startAngle = timestampToAngleDegrees(segment.start, range);
          const endAngle = timestampToAngleDegrees(segment.end, range);
          const path = describeDonutSlice(CENTER, CENTER, INNER, OUTER, startAngle, endAngle);
          const color = segment.kind === 'session'
            ? activityById.get(segment.storedSession.activityId)?.color ?? '#6b716b'
            : undefined;
          const className = segment.kind === 'session'
            ? 'day-clock__segment day-clock__segment--session'
            : 'day-clock__segment day-clock__segment--untracked';
          const label = segmentLabel(segment, activityById, hourCycle);

          return (
            <path
              key={`${segment.kind}-${segment.start}-${segment.end}`}
              className={className}
              d={path}
              tabIndex={0}
              role="button"
              aria-label={label}
              style={color === undefined ? undefined : { '--segment-color': color } as CSSProperties}
              onClick={() => activateSegment(segment)}
              onKeyDown={(event) => onSegmentKeyDown(event, segment)}
            />
          );
        })}

        {markers.map(({ entry, recordedAt }) => {
          const emotion = emotionById.get(entry.emotionId);
          const angle = timestampToAngleDegrees(recordedAt, range);
          const point = polarToCartesian(CENTER, CENTER, MARKER_RADIUS, angle);
          const emotionName = emotion?.name ?? 'Emotion';
          const label = `${emotionName}, intensity ${entry.intensity}, ${formatTime(recordedAt, hourCycle)}`;
          return (
            <g key={entry.id} className="day-clock__emotion">
              <circle
                className="day-clock__emotion-hit"
                cx={point.x}
                cy={point.y}
                r={4.5}
                tabIndex={0}
                role="button"
                aria-label={label}
                aria-pressed={selectedEmotionId === entry.id}
                style={{ '--emotion-color': emotion?.color ?? '#b9c0b5' } as CSSProperties}
                onClick={() => onSelectEmotion(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectEmotion(entry);
                  }
                }}
              />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function DayClocks({
  dayStart,
  now,
  sessions,
  emotionEntries,
  activities,
  emotions,
  hourCycle,
  onSelectSession,
  onSelectGap,
  onSelectEmotion,
  selectedEmotionId,
}: DayClocksProps): JSX.Element {
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const emotionById = new Map(emotions.map((emotion) => [emotion.id, emotion]));

  return (
    <section className="day-clocks" aria-labelledby="day-clocks-heading">
      <div className="day-clocks__header">
        <h2 id="day-clocks-heading">Day clocks</h2>
        <p className="day-clocks__hint">
          Tap a colored block to edit, or an empty section to add a forgotten start.
        </p>
      </div>
      <div className="day-clocks__grid">
        {(['am', 'pm'] as const).map((half) => (
          <ClockFace
            key={half}
            half={half}
            dayStart={dayStart}
            now={now}
            sessions={sessions}
            emotionEntries={emotionEntries}
            activityById={activityById}
            emotionById={emotionById}
            hourCycle={hourCycle}
            onSelectSession={onSelectSession}
            onSelectGap={onSelectGap}
            onSelectEmotion={onSelectEmotion}
            selectedEmotionId={selectedEmotionId}
          />
        ))}
      </div>
    </section>
  );
}
