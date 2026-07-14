interface InvalidationMessage {
  type: 'committed-write';
  id: string;
  source: string;
}

const sameRealmChannels = new Map<string, Set<(message: InvalidationMessage) => void>>();
let fallbackSequence = 0;

function createSourceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    try {
      return `repository-${globalThis.crypto.randomUUID()}`;
    } catch {
      // Continue to the next available entropy source.
    }
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    try {
      const entropy = new Uint32Array(4);
      globalThis.crypto.getRandomValues(entropy);
      return `repository-${[...entropy].map((value) => value.toString(36)).join('-')}`;
    } catch {
      // Continue to the time, random, and sequence fallback.
    }
  }
  fallbackSequence += 1;
  const highResolutionTime = typeof globalThis.performance?.now === 'function'
    ? Math.trunc(globalThis.performance.now() * 1_000).toString(36)
    : 'no-performance-clock';
  return [
    'repository',
    Date.now().toString(36),
    highResolutionTime,
    Math.random().toString(36).slice(2),
    fallbackSequence.toString(36),
  ].join('-');
}

function isInvalidationMessage(value: unknown): value is InvalidationMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<InvalidationMessage>;
  return candidate.type === 'committed-write'
    && typeof candidate.id === 'string'
    && typeof candidate.source === 'string';
}

export interface RepositoryInvalidationChannel {
  notifyCommittedWrite(): void;
  dispose(): void;
}

export function createRepositoryInvalidationChannel(
  databaseName: string,
  onInvalidate: () => void,
): RepositoryInvalidationChannel {
  const source = createSourceId();
  let messageSequence = 0;
  const seen = new Set<string>();
  let disposed = false;
  const receive = (message: InvalidationMessage) => {
    if (disposed || message.source === source || seen.has(message.id)) return;
    seen.add(message.id);
    if (seen.size > 100) {
      seen.clear();
      seen.add(message.id);
    }
    onInvalidate();
  };

  const realmListeners = sameRealmChannels.get(databaseName) ?? new Set();
  realmListeners.add(receive);
  sameRealmChannels.set(databaseName, realmListeners);

  const BroadcastChannelConstructor = typeof window === 'undefined'
    ? undefined
    : window.BroadcastChannel;
  const broadcast = BroadcastChannelConstructor === undefined
    ? null
    : new BroadcastChannelConstructor(`focus-dial:${databaseName}:commits`);
  const handleBroadcastMessage = (event: MessageEvent<unknown>) => {
    if (isInvalidationMessage(event.data)) receive(event.data);
  };
  if (broadcast !== null) {
    broadcast.addEventListener('message', handleBroadcastMessage);
  }

  const documentTarget = typeof document === 'undefined' ? null : document;
  const handleVisibilityChange = () => {
    if (!disposed && documentTarget?.visibilityState === 'visible') onInvalidate();
  };
  if (documentTarget !== null) {
    documentTarget.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return {
    notifyCommittedWrite() {
      if (disposed) return;
      messageSequence += 1;
      const message: InvalidationMessage = {
        type: 'committed-write',
        id: `${source}:${messageSequence}`,
        source,
      };
      seen.add(message.id);
      realmListeners.forEach((listener) => listener(message));
      broadcast?.postMessage(message);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      realmListeners.delete(receive);
      if (realmListeners.size === 0) sameRealmChannels.delete(databaseName);
      if (broadcast !== null) {
        broadcast.removeEventListener('message', handleBroadcastMessage);
        broadcast.close();
      }
      documentTarget?.removeEventListener('visibilitychange', handleVisibilityChange);
      seen.clear();
    },
  };
}
