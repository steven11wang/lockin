export type Id = string;
export type QuickSlot = 1 | 2 | 3 | 4;

export interface Activity {
  id: Id;
  name: string;
  color: string;
  icon?: string;
  sortOrder: number;
  quickSlot: QuickSlot | null;
  archivedAt: number | null;
}

export interface Session {
  id: Id;
  activityId: Id;
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TimerUndoToken {
  createdSessionId: Id;
  previousSession: Session | null;
}

export interface SwitchResult {
  active: Session;
  undo: TimerUndoToken | null;
}

export interface Emotion {
  id: Id;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: number | null;
}

export interface EmotionEntry {
  id: Id;
  emotionId: Id;
  intensity: 1 | 2 | 3 | 4 | 5;
  comment: string;
  recordedAt: number;
  activityId: Id | null;
  sessionId: Id | null;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: Id;
  activityId: Id;
  period: 'daily' | 'weekly';
  direction: 'minimum' | 'maximum';
  targetMinutes: number;
  enabled: boolean;
}

export interface Preferences {
  schemaVersion: 1;
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hourCycle: 12 | 24;
  reducedMotion: boolean;
  lastPausedActivityId: Id | null;
}

export interface DateRange {
  start: number;
  end: number;
}

export type RepositoryHealth =
  | { status: 'healthy' }
  | { status: 'full' | 'unavailable'; message: string };

export interface FocusDialRepository {
  subscribe(listener: () => void): () => void;
  subscribeHealth(listener: () => void): () => void;
  getHealth(): RepositoryHealth;
  recordStorageFailure(error: unknown): Error | null;
  dispose(): void;
  runWrite<T>(operation: () => Promise<T>): Promise<T>;
  listActivities(includeArchived?: boolean): Promise<Activity[]>;
  putActivity(activity: Activity): Promise<void>;
  listSessions(range?: DateRange): Promise<Session[]>;
  getSession(id: Id): Promise<Session | undefined>;
  getActiveSession(): Promise<Session | undefined>;
  putSession(session: Session): Promise<void>;
  deleteSession(id: Id): Promise<void>;
  listEmotions(includeArchived?: boolean): Promise<Emotion[]>;
  putEmotion(emotion: Emotion): Promise<void>;
  listEmotionEntries(range?: DateRange): Promise<EmotionEntry[]>;
  putEmotionEntry(entry: EmotionEntry): Promise<void>;
  deleteEmotionEntry(id: Id): Promise<void>;
  listGoals(): Promise<Goal[]>;
  putGoal(goal: Goal): Promise<void>;
  deleteGoal(id: Id): Promise<void>;
  getPreferences(): Promise<Preferences>;
  putPreferences(preferences: Preferences): Promise<void>;
  clearAll(): Promise<void>;
}
