import { DEFAULT_ACTIVITIES, DEFAULT_EMOTIONS, DEFAULT_PREFERENCES } from '../domain/defaults';
import type {
  Activity,
  DateRange,
  Emotion,
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Preferences,
  Session,
} from '../domain/models';
import { createRepositoryHealthChannel } from './repositoryHealth';

export interface MemoryRepositorySeed {
  activities?: readonly Activity[];
  sessions?: readonly Session[];
  emotions?: readonly Emotion[];
  emotionEntries?: readonly EmotionEntry[];
  goals?: readonly Goal[];
  preferences?: Preferences;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createMap<T extends { id: string }>(values: readonly T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, clone(value)]));
}

function restoreMap<T>(target: Map<string, T>, source: Map<string, T>): void {
  target.clear();
  source.forEach((value, key) => target.set(key, clone(value)));
}

function isSessionInRange(session: Session, range: DateRange): boolean {
  return session.startedAt < range.end && (session.endedAt === null || session.endedAt > range.start);
}

function isEntryInRange(entry: EmotionEntry, range: DateRange): boolean {
  return entry.recordedAt >= range.start && entry.recordedAt < range.end;
}

export function createMemoryRepository(seed: MemoryRepositorySeed = {}): FocusDialRepository {
  const activities = createMap(seed.activities ?? DEFAULT_ACTIVITIES);
  const sessions = createMap(seed.sessions ?? []);
  const emotions = createMap(seed.emotions ?? DEFAULT_EMOTIONS);
  const emotionEntries = createMap(seed.emotionEntries ?? []);
  const goals = createMap(seed.goals ?? []);
  let preferences: Preferences | undefined = clone(seed.preferences ?? DEFAULT_PREFERENCES);
  const listeners = new Set<() => void>();
  const health = createRepositoryHealthChannel();
  let disposed = false;
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    subscribeHealth: health.subscribe,
    getHealth: health.get,
    recordStorageFailure: health.record,

    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      health.dispose();
    },

    runWrite<T>(operation: () => Promise<T>): Promise<T> {
      const blocked = health.gate();
      if (blocked !== null) return Promise.reject(blocked);
      const execute = async () => {
        const queuedBlock = health.gate();
        if (queuedBlock !== null) throw queuedBlock;
        const snapshot = {
          activities: clone(activities),
          sessions: clone(sessions),
          emotions: clone(emotions),
          emotionEntries: clone(emotionEntries),
          goals: clone(goals),
          preferences: preferences === undefined ? undefined : clone(preferences),
        };

        try {
          const result = await operation();
          listeners.forEach((listener) => listener());
          return result;
        } catch (error) {
          restoreMap(activities, snapshot.activities);
          restoreMap(sessions, snapshot.sessions);
          restoreMap(emotions, snapshot.emotions);
          restoreMap(emotionEntries, snapshot.emotionEntries);
          restoreMap(goals, snapshot.goals);
          preferences = snapshot.preferences;
          throw health.record(error) ?? error;
        }
      };
      const result = writeQueue.then(execute, execute);
      writeQueue = result.then(() => undefined, () => undefined);
      return result;
    },

    async listActivities(includeArchived = false) {
      return [...activities.values()]
        .filter((activity) => includeArchived || activity.archivedAt === null)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(clone);
    },

    async putActivity(activity) {
      activities.set(activity.id, clone(activity));
    },

    async listSessions(range) {
      return [...sessions.values()]
        .filter((session) => range === undefined || isSessionInRange(session, range))
        .sort((left, right) => left.startedAt - right.startedAt)
        .map(clone);
    },

    async getSession(id) {
      const session = sessions.get(id);
      return session === undefined ? undefined : clone(session);
    },

    async getActiveSession() {
      const session = [...sessions.values()].find((candidate) => candidate.endedAt === null);
      return session === undefined ? undefined : clone(session);
    },

    async putSession(session) {
      sessions.set(session.id, clone(session));
    },

    async deleteSession(id) {
      sessions.delete(id);
    },

    async listEmotions(includeArchived = false) {
      return [...emotions.values()]
        .filter((emotion) => includeArchived || emotion.archivedAt === null)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(clone);
    },

    async putEmotion(emotion) {
      emotions.set(emotion.id, clone(emotion));
    },

    async listEmotionEntries(range) {
      return [...emotionEntries.values()]
        .filter((entry) => range === undefined || isEntryInRange(entry, range))
        .sort((left, right) => left.recordedAt - right.recordedAt)
        .map(clone);
    },

    async putEmotionEntry(entry) {
      emotionEntries.set(entry.id, clone(entry));
    },

    async deleteEmotionEntry(id) {
      emotionEntries.delete(id);
    },

    async listGoals() {
      return [...goals.values()].map(clone);
    },

    async putGoal(goal) {
      goals.set(goal.id, clone(goal));
    },

    async deleteGoal(id) {
      goals.delete(id);
    },

    async getPreferences() {
      if (preferences === undefined) throw new Error('Focus Dial preferences are missing.');
      return clone(preferences);
    },

    async putPreferences(nextPreferences) {
      preferences = clone(nextPreferences);
    },

    async clearAll() {
      activities.clear();
      sessions.clear();
      emotions.clear();
      emotionEntries.clear();
      goals.clear();
      preferences = undefined;
    },
  };
}
