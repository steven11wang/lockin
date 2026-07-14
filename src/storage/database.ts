import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_ACTIVITIES, DEFAULT_EMOTIONS, DEFAULT_PREFERENCES } from '../domain/defaults';
import type { Activity, Emotion, EmotionEntry, Goal, Preferences, Session } from '../domain/models';

export class FocusDialDatabase extends Dexie {
  activities!: EntityTable<Activity, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  emotions!: EntityTable<Emotion, 'id'>;
  emotionEntries!: EntityTable<EmotionEntry, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  preferences!: EntityTable<Preferences, 'schemaVersion'>;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      activities: 'id, sortOrder, quickSlot, archivedAt',
      sessions: 'id, startedAt, endedAt, activityId',
      emotions: 'id, sortOrder, archivedAt',
      emotionEntries: 'id, recordedAt, emotionId, activityId',
      goals: 'id, activityId',
      preferences: 'schemaVersion',
    });

    this.on('populate', async (transaction) => {
      const activities = transaction.table<Activity, string>('activities');
      if ((await activities.count()) !== 0) return;

      await activities.bulkAdd([...DEFAULT_ACTIVITIES]);
      await transaction.table<Emotion, string>('emotions').bulkAdd([...DEFAULT_EMOTIONS]);
      await transaction.table<Preferences, number>('preferences').add({ ...DEFAULT_PREFERENCES });
    });
  }
}
