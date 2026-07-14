import { useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { useRepository, useRepositoryQuery } from '../../app/RepositoryContext';
import { useModalDialog } from '../../components/useModalDialog';
import type { Emotion, EmotionEntry } from '../../domain/models';
import './emotions.css';

const INTENSITIES = [
  { value: 1, label: '1 — very mild' },
  { value: 2, label: '2 — mild' },
  { value: 3, label: '3 — moderate' },
  { value: 4, label: '4 — strong' },
  { value: 5, label: '5 — very strong' },
] as const;

export interface EmotionSheetProps {
  open: boolean;
  onClose: () => void;
  recordedAt?: number;
  entry?: EmotionEntry;
  onSaved?: (entry: EmotionEntry) => void;
}

interface EmotionSheetDialogProps extends Omit<EmotionSheetProps, 'open'> {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The check-in could not be saved.';
}

function EmotionSheetDialog({
  onClose,
  recordedAt,
  entry,
  onSaved,
}: EmotionSheetDialogProps): JSX.Element {
  const repository = useRepository();
  const emotions = useRepositoryQuery(
    (repo) => repo.listEmotions(entry !== undefined),
    [entry !== undefined],
    [] as Emotion[],
  );
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [emotionId, setEmotionId] = useState(entry?.emotionId ?? '');
  const [intensity, setIntensity] = useState<EmotionEntry['intensity']>(entry?.intensity ?? 3);
  const [comment, setComment] = useState(entry?.comment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cancel = () => {
    if (!saving) onClose();
  };

  const { onDialogCancel, onDialogKeyDown } = useModalDialog({
    dialogRef,
    layerRef,
    getInitialFocus: (dialog) => (
      dialog.querySelector<HTMLInputElement>('input[name="emotion"]')
      ?? dialog.querySelector<HTMLButtonElement>('button[type="button"]')
    ),
    onCancel: cancel,
  });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (emotionId === '') {
      setError('Choose an emotion before saving.');
      return;
    }

    const savedAt = recordedAt ?? Date.now();
    setSaving(true);
    setError(null);
    try {
      const next = await repository.runWrite(async () => {
        const linkedSession = entry === undefined
          ? (await repository.listSessions())
              .filter((session) => (
                session.startedAt <= savedAt
                && (session.endedAt === null || savedAt < session.endedAt)
              ))
              .at(-1)
          : undefined;
        const savedEntry: EmotionEntry = {
          id: entry?.id ?? `emotion-entry-${savedAt}-${Math.random().toString(36).slice(2)}`,
          emotionId,
          intensity,
          comment: comment.trim(),
          recordedAt: entry?.recordedAt ?? savedAt,
          activityId: entry?.activityId ?? linkedSession?.activityId ?? null,
          sessionId: entry?.sessionId ?? linkedSession?.id ?? null,
          createdAt: entry?.createdAt ?? savedAt,
          updatedAt: savedAt,
        };
        await repository.putEmotionEntry(savedEntry);
        return savedEntry;
      });
      onSaved?.(next);
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
      setSaving(false);
    }
  };

  return (
    <div className="emotion-sheet__backdrop" ref={layerRef}>
      <dialog
        className="emotion-sheet"
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        onCancel={onDialogCancel}
        onKeyDown={onDialogKeyDown}
      >
        <h2 id={titleId}>How do you feel?</h2>
        <form noValidate onSubmit={(event) => void save(event)}>
          <fieldset className="emotion-sheet__choices">
            <legend>Emotion</legend>
            <div className="emotion-sheet__choice-grid">
              {emotions.map((emotion) => (
                <label style={{ '--emotion-color': emotion.color } as React.CSSProperties} key={emotion.id}>
                  <input
                    type="radio"
                    name="emotion"
                    value={emotion.id}
                    required
                    checked={emotionId === emotion.id}
                    onChange={() => {
                      setEmotionId(emotion.id);
                      setError(null);
                    }}
                  />
                  <span>{emotion.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="emotion-sheet__choices">
            <legend>Intensity</legend>
            <div className="emotion-sheet__intensity-grid">
              {INTENSITIES.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="intensity"
                    value={option.value}
                    checked={intensity === option.value}
                    onChange={() => setIntensity(option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="emotion-sheet__comment">
            <span>Comment (optional)</span>
            <textarea
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>

          {error !== null && <p className="emotion-sheet__error" role="alert">{error}</p>}

          <div className="emotion-sheet__actions">
            <button type="button" disabled={saving} onClick={cancel}>Cancel check-in</button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save check-in'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export function EmotionSheet({ open, ...props }: EmotionSheetProps): JSX.Element | null {
  return open ? <EmotionSheetDialog {...props} /> : null;
}
