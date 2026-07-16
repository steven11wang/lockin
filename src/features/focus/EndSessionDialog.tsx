import { useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useModalDialog } from '../../components/useModalDialog';

export interface EndSessionDialogProps {
  activityName: string;
  startedAt: number;
  defaultEnd: number;
  maxEnd: number;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (endedAt: number) => void;
}

function formatDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EndSessionDialog({
  activityName,
  startedAt,
  defaultEnd,
  maxEnd,
  saving,
  error,
  onCancel,
  onConfirm,
}: EndSessionDialogProps): JSX.Element {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [end, setEnd] = useState(() => formatDateTimeLocal(defaultEnd));
  const [inputError, setInputError] = useState<string | null>(null);

  const { onDialogCancel, onDialogKeyDown } = useModalDialog({
    dialogRef,
    layerRef,
    getInitialFocus: (dialog) => dialog.querySelector<HTMLInputElement>('input'),
    onCancel,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const endedAt = new Date(end).getTime();
    if (!Number.isFinite(endedAt)) {
      setInputError('Enter a valid end time.');
      return;
    }
    if (endedAt <= startedAt) {
      setInputError('End must be after the start time.');
      return;
    }
    if (endedAt > maxEnd) {
      setInputError('End cannot be in the future.');
      return;
    }
    setInputError(null);
    onConfirm(endedAt);
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
        <h2 id={titleId}>When did {activityName} end?</h2>
        <form onSubmit={submit}>
          <p className="session-editor__active">
            Started {new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            }).format(startedAt)}
          </p>
          <label>
            <span>End time</span>
            <input
              type="datetime-local"
              required
              value={end}
              max={formatDateTimeLocal(maxEnd)}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          {(inputError ?? error) !== null && (
            <p className="session-editor__error" role="alert">{inputError ?? error}</p>
          )}
          <div className="session-editor__actions">
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'End session'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
