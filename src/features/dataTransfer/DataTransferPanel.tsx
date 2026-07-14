import { useRef, useState, type ChangeEvent, type JSX } from 'react';
import { useRepository, useRepositoryQuery } from '../../app/RepositoryContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DEFAULT_PREFERENCES } from '../../domain/defaults';
import type { Preferences } from '../../domain/models';
import {
  createBackup,
  downloadTextFile,
  emotionEntriesToCsv,
  importBackup,
  parseBackup,
  previewImport,
  resetToApprovedDefaults,
  sessionsToCsv,
  type FocusDialBackupV1,
  type ImportMode,
  type ImportPreview,
} from './backup';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function filename(prefix: string, extension: string): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  return `${prefix}-${timestamp}.${extension}`;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formattedDate(timestamp: number, hourCycle: Preferences['hourCycle']): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: hourCycle === 24 ? 'h23' : 'h12',
  }).format(timestamp);
}

export function DataTransferPanel(): JSX.Element {
  const repository = useRepository();
  const preferences = useRepositoryQuery(
    (repo) => repo.getPreferences(),
    [],
    DEFAULT_PREFERENCES,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const selectionId = useRef(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBackup, setSelectedBackup] = useState<FocusDialBackupV1 | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const performExport = async (
    build: () => Promise<{ contents: string; name: string; type: string }>,
    fallback: string,
  ): Promise<void> => {
    setBusy(true);
    setErrors([]);
    setStatus(null);
    try {
      const download = await build();
      downloadTextFile(download.contents, download.name, download.type);
    } catch (error) {
      setErrors([errorMessage(error, fallback)]);
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = () => performExport(async () => ({
    contents: JSON.stringify(await createBackup(repository), null, 2),
    name: filename('focus-dial-backup', 'json'),
    type: 'application/json;charset=utf-8',
  }), 'The JSON backup could not be created.');

  const exportSessions = () => performExport(async () => ({
    contents: sessionsToCsv(await repository.listSessions()),
    name: filename('focus-dial-sessions', 'csv'),
    type: 'text/csv;charset=utf-8',
  }), 'The session CSV could not be created.');

  const exportEmotions = () => performExport(async () => ({
    contents: emotionEntriesToCsv(await repository.listEmotionEntries()),
    name: filename('focus-dial-emotions', 'csv'),
    type: 'text/csv;charset=utf-8',
  }), 'The emotion CSV could not be created.');

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0] ?? null;
    const currentSelection = selectionId.current + 1;
    selectionId.current = currentSelection;
    setSelectedFile(file);
    setSelectedBackup(null);
    setPreview(null);
    setErrors([]);
    setStatus(null);
    if (file === null) return;

    setBusy(true);
    try {
      const result = parseBackup(await file.text());
      if (selectionId.current !== currentSelection) return;
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      const nextPreview = await previewImport(result.backup, repository);
      if (selectionId.current !== currentSelection) return;
      setSelectedBackup(result.backup);
      setPreview(nextPreview);
    } catch (error) {
      if (selectionId.current === currentSelection) {
        setErrors([errorMessage(error, 'The selected backup could not be read.')]);
      }
    } finally {
      if (selectionId.current === currentSelection) setBusy(false);
    }
  };

  const dismissSelectedFile = () => {
    selectionId.current += 1;
    setSelectedFile(null);
    setSelectedBackup(null);
    setPreview(null);
    setErrors([]);
    setStatus(null);
    if (fileInput.current !== null) fileInput.current.value = '';
  };

  const performImport = async (mode: ImportMode): Promise<void> => {
    if (selectedBackup === null || selectedFile === null || preview === null) return;
    setBusy(true);
    setErrors([]);
    setStatus(null);
    try {
      try {
        await importBackup(selectedBackup, mode, repository);
      } catch (error) {
        setErrors([errorMessage(error, 'The backup could not be imported.')]);
        return;
      }
      setStatus(mode === 'additive'
        ? `Added new records from ${selectedFile.name}.`
        : `Replaced local data from ${selectedFile.name}.`);
      try {
        setPreview(await previewImport(selectedBackup, repository));
      } catch (error) {
        const detail = errorMessage(error, 'The preview refresh failed.');
        setErrors([`Import succeeded, but the preview could not be refreshed. ${detail}`]);
      }
    } finally {
      setBusy(false);
    }
  };

  const openDelete = () => {
    setDeleteConfirmation('');
    setDeleteOpen(true);
    setErrors([]);
    setStatus(null);
  };

  const closeDelete = () => {
    if (busy) return;
    setDeleteOpen(false);
    setDeleteConfirmation('');
  };

  const deleteLocalData = async (): Promise<void> => {
    if (deleteConfirmation !== 'DELETE') return;
    setBusy(true);
    setErrors([]);
    try {
      await resetToApprovedDefaults(repository);
      setDeleteOpen(false);
      setDeleteConfirmation('');
      setStatus('Local data was deleted and starter labels were restored.');
      dismissSelectedFile();
      setStatus('Local data was deleted and starter labels were restored.');
    } catch (error) {
      setDeleteOpen(false);
      setErrors([errorMessage(error, 'Local data could not be deleted.')]);
    } finally {
      setBusy(false);
    }
  };

  const importReady = selectedBackup !== null && preview !== null && !busy;

  return (
    <section className="settings-section data-transfer-panel" aria-labelledby="data-transfer-heading">
      <div>
        <p className="settings-kicker">Data ownership</p>
        <h2 id="data-transfer-heading">Your data</h2>
        <p>Back up, move, analyze, or delete the information stored in this browser.</p>
      </div>

      <ErrorBanner errors={errors} onDismiss={() => setErrors([])} />
      {status !== null && <p className="data-transfer-panel__status" role="status">{status}</p>}

      <div className="data-transfer-panel__group" aria-labelledby="export-heading">
        <h3 id="export-heading">Export</h3>
        <div className="data-transfer-panel__actions">
          <button type="button" disabled={busy} onClick={() => void exportBackup()}>
            Download JSON backup
          </button>
          <button type="button" disabled={busy} onClick={() => void exportSessions()}>
            Download session CSV
          </button>
          <button type="button" disabled={busy} onClick={() => void exportEmotions()}>
            Download emotion CSV
          </button>
        </div>
      </div>

      <div className="data-transfer-panel__group" aria-labelledby="import-heading">
        <h3 id="import-heading">Import</h3>
        <label className="data-transfer-panel__file">
          Choose a Focus Dial backup
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => void chooseFile(event)}
          />
        </label>
        {selectedFile !== null && (
          <div className="data-transfer-panel__selection">
            <p>Selected: {selectedFile.name}</p>
            <button type="button" disabled={busy} onClick={dismissSelectedFile}>
              Dismiss selected file
            </button>
          </div>
        )}
        {preview !== null && (
          <div className="data-transfer-panel__preview" role="region" aria-label="Import preview">
            <h4>Import preview</h4>
            <ul>
              <li>{countLabel(preview.counts.activities, 'activity', 'activities')}</li>
              <li>{countLabel(preview.counts.sessions, 'session')}</li>
              <li>{countLabel(preview.counts.emotions, 'emotion')}</li>
              <li>{countLabel(preview.counts.emotionEntries, 'emotion entry', 'emotion entries')}</li>
              <li>{countLabel(preview.counts.goals, 'goal')}</li>
            </ul>
            <p>{countLabel(preview.duplicateIds, 'existing ID')} will be skipped</p>
            {preview.start === null || preview.end === null ? (
              <p>No dated sessions or emotion entries.</p>
            ) : (
              <p>
                Date range:{' '}
                <time dateTime={new Date(preview.start).toISOString()}>
                  {formattedDate(preview.start, preferences.hourCycle)}
                </time>
                {' – '}
                <time dateTime={new Date(preview.end).toISOString()}>
                  {formattedDate(preview.end, preferences.hourCycle)}
                </time>
              </p>
            )}
          </div>
        )}
        <div className="data-transfer-panel__actions">
          <button type="button" disabled={!importReady} onClick={() => void performImport('additive')}>
            Add new records
          </button>
          <button
            className="settings-button--danger"
            type="button"
            disabled={!importReady}
            onClick={() => void performImport('replace-all')}
          >
            Replace all data
          </button>
        </div>
      </div>

      <div className="data-transfer-panel__group data-transfer-panel__danger" aria-labelledby="delete-data-heading">
        <h3 id="delete-data-heading">Delete local data</h3>
        <p>This removes your records from this browser and restores only the starter labels.</p>
        <button className="settings-button--danger" type="button" disabled={busy} onClick={openDelete}>
          Delete local data
        </button>
      </div>

      {deleteOpen && (
        <ConfirmDialog
          title="Delete all local data?"
          onCancel={closeDelete}
          actions={(
            <>
              <button type="button" disabled={busy} onClick={closeDelete}>Cancel</button>
              <button
                className="settings-button--danger"
                type="button"
                disabled={deleteConfirmation !== 'DELETE' || busy}
                onClick={() => void deleteLocalData()}
              >
                Delete all local data
              </button>
            </>
          )}
        >
          <p>This cannot be undone unless you have a backup.</p>
          <label className="data-transfer-panel__delete-confirmation">
            Type DELETE to confirm
            <input
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
    </section>
  );
}
