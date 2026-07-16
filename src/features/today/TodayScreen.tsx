import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useRepository, useRepositoryQuery } from '../../app/RepositoryContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DEFAULT_PREFERENCES } from '../../domain/defaults';
import type {
  Activity,
  Emotion,
  EmotionEntry,
  Goal,
  Id,
  Preferences,
  Session,
} from '../../domain/models';
import { EmotionSheet } from '../emotions/EmotionSheet';
import { calculateGoalProgress, describeGoalProgress } from '../goals/goalProgress';
import { aggregateActivities, getWeekRange } from '../week/aggregate';
import { DayClocks } from './DayClocks';
import { SessionEditor, type SessionEditorValue } from './SessionEditor';
import {
  clipSessionToRange,
  findTimelineGaps,
  getLocalDayRange,
  resolveConflict,
  summarizeDay,
  validateSessionCandidate,
  type ConflictChoice,
} from './timeline';
import './today.css';

const UNDO_WINDOW_MS = 10_000;
const DEFAULT_ENTRY_MS = 30 * 60 * 1_000;

export interface TodayScreenProps {
  date?: Date;
}

interface EditorState {
  session: Session | null;
  start: number;
  end: number | null;
}

interface PendingConflict {
  candidate: Session;
  conflicts: Session[];
}

interface SessionUndoState {
  kind: 'delete' | 'edit';
  target: 'session';
  sessions: Session[];
}

interface EmotionUndoState {
  kind: 'delete' | 'edit';
  target: 'emotion';
  entry: EmotionEntry;
}

type UndoState = SessionUndoState | EmotionUndoState;

type TimelineItem =
  | {
      kind: 'session';
      timestamp: number;
      stored: Session;
      clipped: Session;
    }
  | {
      kind: 'emotion';
      timestamp: number;
      entry: EmotionEntry;
    };

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

function messageForValidation(reason: 'non-positive' | 'future-start' | 'overlap'): string {
  if (reason === 'non-positive') return 'End must be after start.';
  if (reason === 'future-start') return 'Active start cannot be in the future.';
  return 'This entry overlaps another entry.';
}

function uniqueSessions(sessions: readonly Session[]): Session[] {
  return [...new Map(sessions.map((session) => [session.id, session])).values()];
}

export function TodayScreen({ date = new Date() }: TodayScreenProps): JSX.Element {
  const repository = useRepository();
  const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const range = useMemo(() => getLocalDayRange(date), [dayKey]);
  const activities = useRepositoryQuery(
    (repo) => repo.listActivities(true),
    [],
    [] as Activity[],
  );
  const sessions = useRepositoryQuery(
    (repo) => repo.listSessions(),
    [],
    [] as Session[],
  );
  const emotions = useRepositoryQuery(
    (repo) => repo.listEmotions(true),
    [],
    [] as Emotion[],
  );
  const emotionEntries = useRepositoryQuery(
    (repo) => repo.listEmotionEntries(range),
    [range.start, range.end],
    [] as EmotionEntry[],
  );
  const preferences = useRepositoryQuery(
    (repo) => repo.getPreferences(),
    [],
    DEFAULT_PREFERENCES,
  );
  const goals = useRepositoryQuery(
    (repo) => repo.listGoals(),
    [],
    [] as Goal[],
  );
  const [now, setNow] = useState(Date.now);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [selectedEmotionId, setSelectedEmotionId] = useState<Id | null>(null);
  const [editingEmotion, setEditingEmotion] = useState<EmotionEntry | null>(null);
  const [restoreEmotionFocusId, setRestoreEmotionFocusId] = useState<Id | null>(null);
  const [commentSearch, setCommentSearch] = useState('');
  const emotionMarkerRefs = useRef(new Map<Id, HTMLButtonElement>());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (undo === null) return undefined;
    const timeout = window.setTimeout(() => {
      setUndo((current) => current === undo ? null : current);
    }, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timeout);
  }, [undo]);

  useEffect(() => {
    if (restoreEmotionFocusId === null || editingEmotion !== null) return;
    const marker = emotionMarkerRefs.current.get(restoreEmotionFocusId);
    if (marker === undefined) return;
    marker.focus();
    setRestoreEmotionFocusId(null);
  }, [restoreEmotionFocusId, editingEmotion, emotionEntries]);

  const visibleSessions = sessions.flatMap((session) => {
    const clipped = clipSessionToRange(session, range);
    return clipped === null ? [] : [{ stored: session, clipped }];
  }).sort((left, right) => left.clipped.startedAt - right.clipped.startedAt);
  const gaps = findTimelineGaps(sessions, range, now, emotionEntries);
  const summary = summarizeDay(sessions, range, now, emotionEntries);
  const enabledGoals = goals.filter((goal) => goal.enabled);
  const weekRange = getWeekRange(date, preferences.weekStartsOn);
  const weeklyAggregate = aggregateActivities(sessions, weekRange, now);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const emotionById = new Map(emotions.map((emotion) => [emotion.id, emotion]));
  const normalizedSearch = commentSearch.trim().toLocaleLowerCase();
  const visibleEmotionEntries = emotionEntries.filter((entry) => (
    normalizedSearch === '' || entry.comment.toLocaleLowerCase().includes(normalizedSearch)
  ));
  const timelineItems: TimelineItem[] = [
    ...visibleSessions.map(({ stored, clipped }): TimelineItem => ({
      kind: 'session',
      timestamp: clipped.startedAt,
      stored,
      clipped,
    })),
    ...visibleEmotionEntries.map((entry): TimelineItem => ({
      kind: 'emotion',
      timestamp: entry.recordedAt,
      entry,
    })),
  ].sort((left, right) => (
    left.timestamp - right.timestamp || left.kind.localeCompare(right.kind)
  ));
  const emotionSummary = new Map<Id, { count: number; minimum: number; maximum: number }>();
  for (const entry of emotionEntries) {
    const current = emotionSummary.get(entry.emotionId);
    if (current === undefined) {
      emotionSummary.set(entry.emotionId, {
        count: 1,
        minimum: entry.intensity,
        maximum: entry.intensity,
      });
    } else {
      current.count += 1;
      current.minimum = Math.min(current.minimum, entry.intensity);
      current.maximum = Math.max(current.maximum, entry.intensity);
    }
  }

  const openEditor = (next: EditorState) => {
    setEditorError(null);
    setPendingConflict(null);
    setEditor(next);
  };

  const openNewEntry = (start?: number, end?: number) => {
    if (activities.length === 0) return;
    const defaultEnd = Math.min(now, range.end);
    openEditor({
      session: null,
      start: start ?? Math.max(range.start, defaultEnd - DEFAULT_ENTRY_MS),
      end: end ?? defaultEnd,
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
    setEditorError(null);
    setPendingConflict(null);
  };

  const commitResolution = async (candidate: Session, neighborUpdates: readonly Session[]) => {
    const original = sessions.find((session) => session.id === candidate.id);
    const neighborOriginals = neighborUpdates.flatMap((update) => {
      const found = sessions.find((session) => session.id === update.id);
      return found === undefined ? [] : [found];
    });
    const at = Date.now();

    setSaving(true);
    setEditorError(null);
    try {
      await repository.runWrite(async () => {
        await repository.putSession({ ...candidate, updatedAt: at });
        for (const neighbor of neighborUpdates) {
          await repository.putSession({ ...neighbor, updatedAt: at });
        }
      });
      if (original !== undefined) {
        setUndo({
          kind: 'edit',
          target: 'session',
          sessions: uniqueSessions([original, ...neighborOriginals]),
        });
      }
      setPendingConflict(null);
      setEditor(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'The entry could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const saveEntry = (value: SessionEditorValue) => {
    if (editor === null) return;
    const timestamp = Date.now();
    const candidate: Session = {
      id: editor.session?.id ?? `session-${timestamp}-${Math.random().toString(36).slice(2)}`,
      activityId: value.activityId,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      createdAt: editor.session?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const validation = validateSessionCandidate(candidate, sessions);
    if (!validation.ok) {
      if (validation.reason === 'overlap') {
        setPendingConflict({ candidate, conflicts: validation.conflicts });
        setEditorError(null);
      } else {
        setEditorError(messageForValidation(validation.reason));
      }
      return;
    }

    void commitResolution(candidate, []);
  };

  const chooseConflictResolution = (choice: ConflictChoice) => {
    if (pendingConflict === null) return;
    try {
      const resolution = resolveConflict(
        pendingConflict.candidate,
        pendingConflict.conflicts,
        choice,
      );
      const updatesById = new Map(
        resolution.neighborUpdates.map((session) => [session.id, session]),
      );
      const resolvedNeighbors = sessions.map((session) => updatesById.get(session.id) ?? session);
      const validation = validateSessionCandidate(resolution.candidate, resolvedNeighbors);
      if (!validation.ok) throw new Error(messageForValidation(validation.reason));
      void commitResolution(resolution.candidate, resolution.neighborUpdates);
    } catch (error) {
      setPendingConflict(null);
      setEditorError(error instanceof Error ? error.message : 'The overlap could not be resolved.');
    }
  };

  const deleteEntry = async (session: Session) => {
    try {
      await repository.runWrite(() => repository.deleteSession(session.id));
      setUndo({ kind: 'delete', target: 'session', sessions: [session] });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'The entry could not be deleted.');
    }
  };

  const undoLastChange = async () => {
    if (undo === null) return;
    const ownedUndo = undo;
    try {
      await repository.runWrite(async () => {
        if (ownedUndo.target === 'session') {
          for (const session of ownedUndo.sessions) await repository.putSession(session);
        } else {
          await repository.putEmotionEntry(ownedUndo.entry);
        }
      });
      setUndo((current) => current === ownedUndo ? null : current);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'The change could not be undone.');
    }
  };

  const deleteEmotionEntry = async (entry: EmotionEntry) => {
    try {
      await repository.runWrite(() => repository.deleteEmotionEntry(entry.id));
      setSelectedEmotionId(null);
      setUndo({ kind: 'delete', target: 'emotion', entry });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'The check-in could not be deleted.');
    }
  };

  const finishEmotionEdit = (original: EmotionEntry) => {
    setSelectedEmotionId(null);
    setRestoreEmotionFocusId(original.id);
    setUndo({ kind: 'edit', target: 'emotion', entry: original });
  };

  const selectedActivityId: Id = editor?.session?.activityId ?? activities[0]?.id ?? '';
  const candidateName = pendingConflict === null
    ? ''
    : activityById.get(pendingConflict.candidate.activityId)?.name ?? 'This entry';
  const conflictNames = pendingConflict === null
    ? []
    : uniqueSessions(pendingConflict.conflicts).map((session) => (
        activityById.get(session.activityId)?.name ?? 'Unknown activity'
      ));

  return (
    <section className="today-screen" aria-labelledby="today-heading">
      <header className="today-header">
        <div>
          <p className="today-header__date">
            {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}
          </p>
          <h1 id="today-heading">Today</h1>
        </div>
        <button type="button" disabled={activities.length === 0} onClick={() => openNewEntry()}>
          Add entry
        </button>
      </header>

      <section className="today-summary" aria-label="Today summary">
        <div>
          <span>Tracked</span>
          <output aria-label="Tracked">{formatDuration(summary.trackedMs)}</output>
        </div>
        <div>
          <span>Untracked</span>
          <output aria-label="Untracked">{formatDuration(summary.untrackedMs)}</output>
        </div>
        <ul className="today-summary__activities">
          {activities.flatMap((activity) => {
            const duration = summary.byActivity[activity.id];
            return duration === undefined || duration <= 0 ? [] : [
              <li key={activity.id}>
                <span className="today-swatch" style={{ background: activity.color }} aria-hidden="true" />
                <span>{activity.name}</span>
                <output aria-label={`${activity.name} total`}>{formatDuration(duration)}</output>
              </li>,
            ];
          })}
        </ul>
        {enabledGoals.length > 0 && (
          <ul className="today-summary__goals" aria-label="Goal progress">
            {enabledGoals.map((goal) => {
              const duration = goal.period === 'daily'
                ? summary.byActivity[goal.activityId] ?? 0
                : weeklyAggregate.byActivity[goal.activityId] ?? 0;
              const progress = calculateGoalProgress(goal, Math.floor(duration / 60_000));
              return (
                <li key={goal.id}>
                  <span>
                    {activityById.get(goal.activityId)?.name ?? 'Unknown activity'}{' '}
                    {goal.period} {goal.direction}
                  </span>
                  <output>{describeGoalProgress(goal, progress)}</output>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="today-emotions" aria-labelledby="emotion-summary-heading">
        <div className="today-emotions__header">
          <h2 id="emotion-summary-heading">Check-ins</h2>
          <label>
            <span>Search emotion comments</span>
            <input
              type="search"
              value={commentSearch}
              onChange={(event) => setCommentSearch(event.target.value)}
            />
          </label>
        </div>
        {emotionSummary.size === 0 ? (
          <p className="today-empty">No emotion check-ins yet.</p>
        ) : (
          <ul className="today-emotions__summary">
            {emotions.flatMap((emotion) => {
              const values = emotionSummary.get(emotion.id);
              return values === undefined ? [] : [
                <li key={emotion.id}>
                  <span className="today-swatch" style={{ background: emotion.color }} aria-hidden="true" />
                  <span>{emotion.name}</span>
                  <span>
                    <output aria-label={`${emotion.name} count`}>{values.count}</output>
                    {' check-ins'}
                  </span>
                  <span>
                    {'Intensity '}
                    <output aria-label={`${emotion.name} intensity range`}>
                      {values.minimum === values.maximum
                        ? values.minimum
                        : `${values.minimum}–${values.maximum}`}
                    </output>
                  </span>
                </li>,
              ];
            })}
          </ul>
        )}
      </section>

      <DayClocks
        dayStart={range.start}
        now={now}
        sessions={sessions}
        emotionEntries={visibleEmotionEntries}
        activities={activities}
        emotions={emotions}
        hourCycle={preferences.hourCycle}
        selectedEmotionId={selectedEmotionId}
        onSelectSession={(stored) => openEditor({
          session: stored,
          start: stored.startedAt,
          end: stored.endedAt,
        })}
        onSelectGap={(start, end) => openNewEntry(start, end)}
        onSelectEmotion={(entry) => setSelectedEmotionId((current) => (
          current === entry.id ? null : entry.id
        ))}
      />

      <section className="today-timeline" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">Timeline list</h2>
        <p className="today-timeline__hint">
          Text list for keyboard and screen-reader friendly editing.
        </p>
        {timelineItems.length === 0 && (
          <p className="today-empty">
            {emotionEntries.length > 0 && normalizedSearch !== ''
              ? 'No check-ins match this search.'
              : 'No entries yet.'}
          </p>
        )}
        <ol aria-label="Daily timeline">
          {timelineItems.map((item) => {
            if (item.kind === 'emotion') {
              const { entry } = item;
              const emotion = emotionById.get(entry.emotionId);
              const emotionName = emotion?.name ?? 'Unknown emotion';
              const linkedActivity = entry.activityId === null
                ? undefined
                : activityById.get(entry.activityId);
              const selected = selectedEmotionId === entry.id;
              const accessibleName = `${emotionName}, intensity ${entry.intensity}, ${formatTime(entry.recordedAt, preferences.hourCycle)}`;
              return (
                <li
                  className="emotion-marker"
                  key={`emotion-${entry.id}`}
                  style={{ '--emotion-color': emotion?.color ?? 'var(--color-text-muted)' } as React.CSSProperties}
                >
                  <button
                    className="emotion-marker__button"
                    type="button"
                    ref={(node) => {
                      if (node === null) emotionMarkerRefs.current.delete(entry.id);
                      else emotionMarkerRefs.current.set(entry.id, node);
                    }}
                    aria-label={accessibleName}
                    aria-expanded={selected}
                    onClick={() => setSelectedEmotionId((current) => (
                      current === entry.id ? null : entry.id
                    ))}
                  >
                    <span className="emotion-marker__dot" aria-hidden="true" />
                    <span>{emotionName}</span>
                    <span>Intensity {entry.intensity}</span>
                    <time dateTime={new Date(entry.recordedAt).toISOString()}>
                      {formatTime(entry.recordedAt, preferences.hourCycle)}
                    </time>
                  </button>
                  {selected && (
                    <div className="emotion-marker__details">
                      <p className="emotion-marker__comment">
                        {entry.comment === '' ? 'No comment.' : entry.comment}
                      </p>
                      <p className="emotion-marker__activity">
                        <span>Activity</span>
                        <strong>{linkedActivity?.name ?? 'No active activity'}</strong>
                      </p>
                      <div className="timeline-row__actions">
                        <button
                          type="button"
                          aria-label={`Edit ${emotionName} check-in`}
                          onClick={() => setEditingEmotion(entry)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${emotionName} check-in`}
                          onClick={() => void deleteEmotionEntry(entry)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            }

            const { stored, clipped } = item;
            const activity = activityById.get(stored.activityId);
            const activityName = activity?.name ?? 'Unknown activity';
            const visibleEnd = clipped.endedAt ?? Math.min(now, range.end);
            return (
              <li className="timeline-row" key={`session-${stored.id}`}>
                <span
                  className="timeline-row__bar"
                  style={{ background: activity?.color ?? 'var(--color-text-muted)' }}
                  aria-hidden="true"
                />
                <div className="timeline-row__details">
                  <h3>{activityName}</h3>
                  <p>
                    {formatTime(clipped.startedAt, preferences.hourCycle)} – {clipped.endedAt === null ? 'Now' : formatTime(visibleEnd, preferences.hourCycle)}
                    <span>{formatDuration(Math.max(0, visibleEnd - clipped.startedAt))}</span>
                  </p>
                </div>
                <div className="timeline-row__actions">
                  <button type="button" aria-label={`Edit ${activityName}`} onClick={() => openEditor({
                    session: stored,
                    start: stored.startedAt,
                    end: stored.endedAt,
                  })}>
                    Edit
                  </button>
                  <button type="button" aria-label={`Delete ${activityName}`} onClick={() => void deleteEntry(stored)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {gaps.length > 0 && (
        <section className="today-gaps" aria-labelledby="gaps-heading">
          <h2 id="gaps-heading">Untracked gaps</h2>
          <ul>
            {gaps.map((gap) => (
              <li key={`${gap.start}-${gap.end}`}>
                <span>{formatTime(gap.start, preferences.hourCycle)} – {formatTime(gap.end, preferences.hourCycle)}</span>
                <span>{formatDuration(gap.durationMs)}</span>
                <button
                  type="button"
                  aria-label={`Fill gap ${formatTime(gap.start, preferences.hourCycle)} to ${formatTime(gap.end, preferences.hourCycle)}`}
                  onClick={() => openNewEntry(gap.start, gap.end)}
                >
                  Fill gap
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {undo !== null && (
        <aside className="today-undo" aria-live="polite">
          <span>
            {undo.target === 'emotion' ? 'Check-in' : 'Entry'}
            {undo.kind === 'delete' ? ' deleted.' : ' updated.'}
          </span>
          <button type="button" onClick={() => void undoLastChange()}>
            Undo {undo.kind}
          </button>
        </aside>
      )}

      {editor !== null && activities.length > 0 && (
        <SessionEditor
          activities={activities}
          initialActivityId={selectedActivityId}
          initialStart={editor.start}
          initialEnd={editor.end}
          active={editor.session?.endedAt === null && editor.session !== null}
          mode={editor.session === null ? 'add' : 'edit'}
          error={editorError}
          saving={saving}
          onCancel={closeEditor}
          onSave={saveEntry}
        />
      )}

      {editingEmotion !== null && (
        <EmotionSheet
          open
          entry={editingEmotion}
          onClose={() => setEditingEmotion(null)}
          onSaved={() => finishEmotionEdit(editingEmotion)}
        />
      )}

      {pendingConflict !== null && (
        <ConfirmDialog
          title="Resolve overlap"
          onCancel={() => setPendingConflict(null)}
          actions={(
            <>
              <button type="button" onClick={() => setPendingConflict(null)}>Cancel</button>
              <button type="button" onClick={() => chooseConflictResolution('shorten-candidate')}>
                Shorten this entry
              </button>
              <button type="button" onClick={() => chooseConflictResolution('trim-neighbors')}>
                Trim neighboring entry
              </button>
            </>
          )}
        >
          <p>
            {candidateName} overlaps {conflictNames.join(', ')}. Choose which entry to change.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
