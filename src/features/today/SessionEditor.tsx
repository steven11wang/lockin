import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useModalDialog } from '../../components/useModalDialog';
import type { Activity, Id } from '../../domain/models';

export interface SessionEditorValue {
  activityId: Id;
  startedAt: number;
  endedAt: number | null;
}

export interface SessionEditorProps {
  activities: readonly Activity[];
  initialActivityId: Id;
  initialStart: number;
  initialEnd: number | null;
  active: boolean;
  mode: 'add' | 'edit';
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: SessionEditorValue) => void;
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SessionEditor({
  activities,
  initialActivityId,
  initialStart,
  initialEnd,
  active,
  mode,
  error,
  saving,
  onCancel,
  onSave,
}: SessionEditorProps): JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [activityId, setActivityId] = useState(initialActivityId);
  const [start, setStart] = useState(() => formatDateTimeLocal(initialStart));
  const [end, setEnd] = useState(() => (
    initialEnd === null ? '' : formatDateTimeLocal(initialEnd)
  ));
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    setInputError(null);
  }, [error]);

  const { onDialogCancel, onDialogKeyDown } = useModalDialog({
    dialogRef,
    layerRef,
    getInitialFocus: (dialog) => dialog.querySelector<HTMLSelectElement>('select'),
    onCancel,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startedAt = new Date(start).getTime();
    const endedAt = active ? null : new Date(end).getTime();
    if (!Number.isFinite(startedAt) || (!active && !Number.isFinite(endedAt))) {
      setInputError('Enter a valid start and end time.');
      return;
    }
    setInputError(null);
    onSave({ activityId, startedAt, endedAt });
  };

  return (
    <div className="session-editor__backdrop" ref={layerRef}>
      <dialog
        className="session-editor"
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        onCancel={onDialogCancel}
        onKeyDown={onDialogKeyDown}
      >
        <h2 id={titleId}>{mode === 'add' ? 'Add entry' : 'Edit entry'}</h2>
        <form onSubmit={submit}>
          <label>
            <span>Activity</span>
            <select value={activityId} onChange={(event) => setActivityId(event.target.value)}>
              {activities.map((activity) => (
                <option value={activity.id} key={activity.id}>{activity.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Start</span>
            <input
              type="datetime-local"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>

          {active ? (
            <p className="session-editor__active">This entry is active now.</p>
          ) : (
            <label>
              <span>End</span>
              <input
                type="datetime-local"
                required
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          )}

          {(inputError ?? error) !== null && (
            <p className="session-editor__error" role="alert">{inputError ?? error}</p>
          )}

          <div className="session-editor__actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save entry'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
