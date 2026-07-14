import type { RepositoryHealth } from '../domain/models';

const FULL_MESSAGE = 'Browser storage is full. Focus Dial stopped accepting changes. Open Settings → Your data to download a backup, free browser or device storage, then reload Focus Dial.';
const UNAVAILABLE_MESSAGE = 'Browser storage is unavailable. Focus Dial stopped accepting changes. Open Settings → Your data to download a backup if reads still work, restore browser storage access, then reload Focus Dial.';

export class RepositoryStorageError extends Error {
  constructor(
    readonly kind: 'full' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'RepositoryStorageError';
  }
}

function errorDetails(error: unknown): { name: string; message: string } {
  if (error instanceof Error || error instanceof DOMException) {
    return { name: error.name, message: error.message };
  }
  return { name: '', message: String(error) };
}

function classifyStorageFailure(error: unknown): 'full' | 'unavailable' | null {
  if (error instanceof RepositoryStorageError) return error.kind;
  const { name, message } = errorDetails(error);
  if (
    /quota/i.test(name)
    || /quota|storage (?:is )?full|disk (?:is )?full|not enough (?:storage )?space/i.test(message)
  ) return 'full';
  if (
    /^(InvalidStateError|UnknownError|NotReadableError|DatabaseClosedError|OpenFailedError)$/i.test(name)
    || /indexeddb|storage (?:is )?unavailable|database (?:is )?(?:closed|unavailable)|failed to open.*database/i.test(message)
  ) return 'unavailable';
  return null;
}

export interface RepositoryHealthChannel {
  get(): RepositoryHealth;
  subscribe(listener: () => void): () => void;
  record(error: unknown): RepositoryStorageError | null;
  gate(): RepositoryStorageError | null;
  dispose(): void;
}

export function createRepositoryHealthChannel(): RepositoryHealthChannel {
  let health: RepositoryHealth = { status: 'healthy' };
  const listeners = new Set<() => void>();

  const errorForHealth = (): RepositoryStorageError | null => (
    health.status === 'healthy'
      ? null
      : new RepositoryStorageError(health.status, health.message)
  );

  return {
    get: () => health,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    record(error) {
      const kind = classifyStorageFailure(error);
      if (kind === null) return null;
      if (health.status === 'healthy') {
        health = {
          status: kind,
          message: kind === 'full' ? FULL_MESSAGE : UNAVAILABLE_MESSAGE,
        };
        listeners.forEach((listener) => listener());
      }
      return errorForHealth();
    },
    gate: errorForHealth,
    dispose() {
      listeners.clear();
    },
  };
}
