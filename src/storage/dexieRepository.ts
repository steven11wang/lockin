import { FocusDialDatabase } from './database';
import type {
  Activity,
  DateRange,
  Emotion,
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Id,
  Preferences,
  Session,
} from '../domain/models';
import { createRepositoryHealthChannel } from './repositoryHealth';
import { createRepositoryInvalidationChannel } from './repositoryInvalidation';

const DEFAULT_DATABASE_NAME = 'focus-dial';

function isSessionInRange(session: Session, range: DateRange): boolean {
  return session.startedAt < range.end && (session.endedAt === null || session.endedAt > range.start);
}

function isEntryInRange(entry: EmotionEntry, range: DateRange): boolean {
  return entry.recordedAt >= range.start && entry.recordedAt < range.end;
}

export function createDexieRepository(name = DEFAULT_DATABASE_NAME): FocusDialRepository {
  const database = new FocusDialDatabase(name);
  const listeners = new Set<() => void>();
  const health = createRepositoryHealthChannel();
  let disposed = false;
  const notifySubscribers = () => listeners.forEach((listener) => listener());
  const invalidation = createRepositoryInvalidationChannel(name, notifySubscribers);
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      throw health.record(error) ?? error;
    }
  };

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
      invalidation.dispose();
      listeners.clear();
      health.dispose();
      database.close();
    },

    async runWrite<T>(operation: () => Promise<T>): Promise<T> {
      const blocked = health.gate();
      if (blocked !== null) throw blocked;
      try {
        const result = await database.transaction('rw', database.tables, operation);
        notifySubscribers();
        invalidation.notifyCommittedWrite();
        return result;
      } catch (error) {
        throw health.record(error) ?? error;
      }
    },

    async listActivities(includeArchived = false) {
      const activities = await read(() => database.activities.toArray());
      return activities
        .filter((activity) => includeArchived || activity.archivedAt === null)
        .sort((left, right) => left.sortOrder - right.sortOrder);
    },

    async putActivity(activity) {
      await database.activities.put(activity);
    },

    async listSessions(range) {
      const sessions = await read(() => database.sessions.toArray());
      return sessions
        .filter((session) => range === undefined || isSessionInRange(session, range))
        .sort((left, right) => left.startedAt - right.startedAt);
    },

    async getSession(id) {
      return read(() => database.sessions.get(id));
    },

    async getActiveSession() {
      const sessions = await read(() => database.sessions.toArray());
      return sessions.find((session) => session.endedAt === null);
    },

    async putSession(session) {
      await database.sessions.put(session);
    },

    async deleteSession(id) {
      await database.sessions.delete(id);
    },

    async listEmotions(includeArchived = false) {
      const emotions = await read(() => database.emotions.toArray());
      return emotions
        .filter((emotion) => includeArchived || emotion.archivedAt === null)
        .sort((left, right) => left.sortOrder - right.sortOrder);
    },

    async putEmotion(emotion) {
      await database.emotions.put(emotion);
    },

    async listEmotionEntries(range) {
      const entries = await read(() => database.emotionEntries.toArray());
      return entries
        .filter((entry) => range === undefined || isEntryInRange(entry, range))
        .sort((left, right) => left.recordedAt - right.recordedAt);
    },

    async putEmotionEntry(entry) {
      await database.emotionEntries.put(entry);
    },

    async deleteEmotionEntry(id) {
      await database.emotionEntries.delete(id);
    },

    async listGoals() {
      return read(() => database.goals.toArray());
    },

    async putGoal(goal) {
      await database.goals.put(goal);
    },

    async deleteGoal(id) {
      await database.goals.delete(id);
    },

    async getPreferences() {
      const preferences = await read(() => database.preferences.get(1));
      if (preferences === undefined) throw new Error('Focus Dial preferences are missing.');
      return preferences;
    },

    async putPreferences(preferences) {
      await database.preferences.put(preferences);
    },

    async clearAll() {
      await Promise.all(database.tables.map((table) => table.clear()));
    },
  };
}
