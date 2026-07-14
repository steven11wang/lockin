import { DEFAULT_ACTIVITIES, DEFAULT_EMOTIONS, DEFAULT_PREFERENCES } from '../../domain/defaults';
import { isValidRecordName } from '../../domain/validation';
import type {
  Activity,
  Emotion,
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Preferences,
  Session,
} from '../../domain/models';

export type ImportMode = 'additive' | 'replace-all';

export interface FocusDialBackupV1 {
  kind: 'focus-dial-backup';
  version: 1;
  exportedAt: number;
  activities: Activity[];
  sessions: Session[];
  emotions: Emotion[];
  emotionEntries: EmotionEntry[];
  goals: Goal[];
  preferences: Preferences;
}

export interface ImportPreview {
  counts: Record<'activities' | 'sessions' | 'emotions' | 'emotionEntries' | 'goals', number>;
  start: number | null;
  end: number | null;
  duplicateIds: number;
}

export type ParseBackupResult =
  | { ok: true; backup: FocusDialBackupV1 }
  | { ok: false; errors: string[] };

const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isTimestamp(value: unknown): value is number {
  return isInteger(value) && value >= 0 && value <= MAX_DATE_TIMESTAMP;
}

function addError(errors: string[], condition: boolean, message: string): boolean {
  if (!condition) errors.push(message);
  return condition;
}

function validateActivity(value: unknown, path: string, errors: string[]): value is Activity {
  if (!isObject(value)) {
    errors.push(`${path} must be an activity object.`);
    return false;
  }
  let valid = true;
  valid = addError(errors, isId(value.id), `${path}.id must be a non-empty string.`) && valid;
  const nameIsString = addError(
    errors,
    typeof value.name === 'string',
    `${path}.name must be a string.`,
  );
  valid = nameIsString && valid;
  if (nameIsString) {
    valid = addError(
      errors,
      isValidRecordName(value.name),
      `${path}.name must be 1–40 characters after trimming.`,
    ) && valid;
  }
  valid = addError(errors, typeof value.color === 'string', `${path}.color must be a string.`) && valid;
  valid = addError(
    errors,
    value.icon === undefined || typeof value.icon === 'string',
    `${path}.icon must be a string when provided.`,
  ) && valid;
  valid = addError(errors, isInteger(value.sortOrder), `${path}.sortOrder must be an integer.`) && valid;
  valid = addError(
    errors,
    value.quickSlot === null || value.quickSlot === 1 || value.quickSlot === 2
      || value.quickSlot === 3 || value.quickSlot === 4,
    `${path}.quickSlot must be 1, 2, 3, 4, or null.`,
  ) && valid;
  valid = addError(
    errors,
    value.archivedAt === null || isTimestamp(value.archivedAt),
    `${path}.archivedAt must be a timestamp or null.`,
  ) && valid;
  return valid;
}

function validateSession(value: unknown, path: string, errors: string[]): value is Session {
  if (!isObject(value)) {
    errors.push(`${path} must be a session object.`);
    return false;
  }
  let valid = true;
  valid = addError(errors, isId(value.id), `${path}.id must be a non-empty string.`) && valid;
  valid = addError(errors, isId(value.activityId), `${path}.activityId must be a non-empty string.`) && valid;
  const validStart = addError(errors, isTimestamp(value.startedAt), `${path}.startedAt must be a timestamp.`);
  const validEnd = addError(
    errors,
    value.endedAt === null || isTimestamp(value.endedAt),
    `${path}.endedAt must be a timestamp or null.`,
  );
  const validCreated = addError(errors, isTimestamp(value.createdAt), `${path}.createdAt must be a timestamp.`);
  const validUpdated = addError(errors, isTimestamp(value.updatedAt), `${path}.updatedAt must be a timestamp.`);
  valid = validStart && validEnd && validCreated && validUpdated && valid;
  if (
    validStart
    && validEnd
    && isTimestamp(value.startedAt)
    && isTimestamp(value.endedAt)
  ) {
    valid = addError(
      errors,
      value.endedAt > value.startedAt,
      `${path} must end after it starts.`,
    ) && valid;
  }
  if (validCreated && validUpdated && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt)) {
    valid = addError(
      errors,
      value.updatedAt >= value.createdAt,
      `${path}.updatedAt must not be before createdAt.`,
    ) && valid;
  }
  return valid;
}

function validateEmotion(value: unknown, path: string, errors: string[]): value is Emotion {
  if (!isObject(value)) {
    errors.push(`${path} must be an emotion object.`);
    return false;
  }
  let valid = true;
  valid = addError(errors, isId(value.id), `${path}.id must be a non-empty string.`) && valid;
  const nameIsString = addError(
    errors,
    typeof value.name === 'string',
    `${path}.name must be a string.`,
  );
  valid = nameIsString && valid;
  if (nameIsString) {
    valid = addError(
      errors,
      isValidRecordName(value.name),
      `${path}.name must be 1–40 characters after trimming.`,
    ) && valid;
  }
  valid = addError(errors, typeof value.color === 'string', `${path}.color must be a string.`) && valid;
  valid = addError(errors, isInteger(value.sortOrder), `${path}.sortOrder must be an integer.`) && valid;
  valid = addError(
    errors,
    value.archivedAt === null || isTimestamp(value.archivedAt),
    `${path}.archivedAt must be a timestamp or null.`,
  ) && valid;
  return valid;
}

function validateEmotionEntry(value: unknown, path: string, errors: string[]): value is EmotionEntry {
  if (!isObject(value)) {
    errors.push(`${path} must be an emotion entry object.`);
    return false;
  }
  let valid = true;
  valid = addError(errors, isId(value.id), `${path}.id must be a non-empty string.`) && valid;
  valid = addError(errors, isId(value.emotionId), `${path}.emotionId must be a non-empty string.`) && valid;
  valid = addError(
    errors,
    value.intensity === 1 || value.intensity === 2 || value.intensity === 3
      || value.intensity === 4 || value.intensity === 5,
    `${path}.intensity must be an integer from 1 to 5.`,
  ) && valid;
  valid = addError(errors, typeof value.comment === 'string', `${path}.comment must be a string.`) && valid;
  valid = addError(errors, isTimestamp(value.recordedAt), `${path}.recordedAt must be a timestamp.`) && valid;
  valid = addError(
    errors,
    value.activityId === null || isId(value.activityId),
    `${path}.activityId must be a non-empty string or null.`,
  ) && valid;
  valid = addError(
    errors,
    value.sessionId === null || isId(value.sessionId),
    `${path}.sessionId must be a non-empty string or null.`,
  ) && valid;
  const validCreated = addError(errors, isTimestamp(value.createdAt), `${path}.createdAt must be a timestamp.`);
  const validUpdated = addError(errors, isTimestamp(value.updatedAt), `${path}.updatedAt must be a timestamp.`);
  valid = validCreated && validUpdated && valid;
  if (validCreated && validUpdated && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt)) {
    valid = addError(
      errors,
      value.updatedAt >= value.createdAt,
      `${path}.updatedAt must not be before createdAt.`,
    ) && valid;
  }
  return valid;
}

function validateGoal(value: unknown, path: string, errors: string[]): value is Goal {
  if (!isObject(value)) {
    errors.push(`${path} must be a goal object.`);
    return false;
  }
  let valid = true;
  valid = addError(errors, isId(value.id), `${path}.id must be a non-empty string.`) && valid;
  valid = addError(errors, isId(value.activityId), `${path}.activityId must be a non-empty string.`) && valid;
  valid = addError(
    errors,
    value.period === 'daily' || value.period === 'weekly',
    `${path}.period must be daily or weekly.`,
  ) && valid;
  valid = addError(
    errors,
    value.direction === 'minimum' || value.direction === 'maximum',
    `${path}.direction must be minimum or maximum.`,
  ) && valid;
  valid = addError(
    errors,
    isInteger(value.targetMinutes) && value.targetMinutes > 0,
    `${path}.targetMinutes must be a positive integer.`,
  ) && valid;
  valid = addError(errors, typeof value.enabled === 'boolean', `${path}.enabled must be a boolean.`) && valid;
  return valid;
}

function validatePreferences(value: unknown, errors: string[]): value is Preferences {
  if (!isObject(value)) {
    errors.push('preferences must be an object.');
    return false;
  }
  let valid = true;
  valid = addError(errors, value.schemaVersion === 1, 'preferences.schemaVersion must be 1.') && valid;
  valid = addError(
    errors,
    isInteger(value.weekStartsOn) && value.weekStartsOn >= 0 && value.weekStartsOn <= 6,
    'preferences.weekStartsOn must be an integer from 0 to 6.',
  ) && valid;
  valid = addError(
    errors,
    value.hourCycle === 12 || value.hourCycle === 24,
    'preferences.hourCycle must be 12 or 24.',
  ) && valid;
  valid = addError(
    errors,
    typeof value.reducedMotion === 'boolean',
    'preferences.reducedMotion must be a boolean.',
  ) && valid;
  valid = addError(
    errors,
    value.lastPausedActivityId === null || isId(value.lastPausedActivityId),
    'preferences.lastPausedActivityId must be a non-empty string or null.',
  ) && valid;
  return valid;
}

function validateCollection<T>(
  value: unknown,
  name: string,
  validator: (entry: unknown, path: string, errors: string[]) => entry is T,
  errors: string[],
): T[] {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array.`);
    return [];
  }
  const validEntries: T[] = [];
  value.forEach((entry, index) => {
    if (validator(entry, `${name}[${index}]`, errors)) validEntries.push(entry);
  });
  return validEntries;
}

function validateRawUniqueIds(
  value: unknown,
  name: string,
  errors: string[],
): void {
  if (!Array.isArray(value)) return;
  const ids = new Set<string>();
  value.forEach((entry, index) => {
    if (!isObject(entry) || !isId(entry.id)) return;
    if (ids.has(entry.id)) errors.push(`${name}[${index}].id duplicates ${entry.id}.`);
    ids.add(entry.id);
  });
}

interface SessionInterval {
  id: string;
  startedAt: number;
  endedAt: number | null;
}

function sessionGlobalInvariantErrors(
  sessions: readonly SessionInterval[],
  validationNow = Date.now(),
): string[] {
  const errors: string[] = [];
  const activeCount = sessions.filter(({ endedAt }) => endedAt === null).length;
  if (activeCount > 1) errors.push('Sessions may contain at most one active session.');
  sessions.forEach((session) => {
    if (session.endedAt === null && session.startedAt > validationNow) {
      errors.push(`Session ${session.id} cannot start in the future while active.`);
    }
  });
  const ordered = [...sessions].sort((left, right) => left.startedAt - right.startedAt);
  ordered.forEach((session, index) => {
    const previous = ordered[index - 1];
    if (previous !== undefined && (previous.endedAt === null || session.startedAt < previous.endedAt)) {
      errors.push(`Session ${session.id} overlaps session ${previous.id}.`);
    }
  });
  return errors;
}

function sessionInvariantErrors(sessions: readonly Session[]): string[] {
  const errors = sessions.flatMap((session) => (
    session.endedAt !== null && session.endedAt <= session.startedAt
      ? [`Session ${session.id} must end after it starts.`]
      : []
  ));
  return [...errors, ...sessionGlobalInvariantErrors(sessions)];
}

function linkedEmotionEntryErrors(
  entries: readonly EmotionEntry[],
  sessions: readonly Session[],
  validationNow: number,
): string[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const errors: string[] = [];

  entries.forEach((entry) => {
    if (entry.sessionId === null) return;
    const linked = sessionsById.get(entry.sessionId);
    if (linked === undefined) return;
    if (entry.activityId === null) {
      errors.push(
        `Emotion entry ${entry.id} must include activity ${linked.activityId} when linked to session ${entry.sessionId}.`,
      );
    } else if (entry.activityId !== linked.activityId) {
      errors.push(
        `Emotion entry ${entry.id} activity ${entry.activityId} does not match linked session activity ${linked.activityId}.`,
      );
    }
    const beforeEnd = linked.endedAt === null
      ? entry.recordedAt <= validationNow
      : entry.recordedAt < linked.endedAt;
    if (entry.recordedAt < linked.startedAt || !beforeEnd) {
      errors.push(
        `Emotion entry ${entry.id} must be recorded within linked session ${entry.sessionId}.`,
      );
    }
  });

  return errors;
}

function activityQuickSlotErrors(activities: readonly Activity[]): string[] {
  const owners = new Map<NonNullable<Activity['quickSlot']>, string>();
  const activeOwners = new Set<NonNullable<Activity['quickSlot']>>();
  const errors: string[] = [];
  activities.forEach((activity) => {
    if (activity.quickSlot === null) return;
    const owner = owners.get(activity.quickSlot);
    if (owner !== undefined) {
      errors.push(
        `Quick slot ${activity.quickSlot} is assigned to both ${owner} and ${activity.id}.`,
      );
    } else {
      owners.set(activity.quickSlot, activity.id);
    }
    if (activity.archivedAt === null) {
      activeOwners.add(activity.quickSlot);
    } else {
      errors.push(
        `Archived activity ${activity.id} cannot own quick slot ${activity.quickSlot}.`,
      );
    }
  });
  ([1, 2, 3, 4] as const).forEach((slot) => {
    if (!activeOwners.has(slot)) {
      errors.push(`Quick slot ${slot} must have exactly one active owner.`);
    }
  });
  return errors;
}

function validateBackupValue(value: unknown): ParseBackupResult {
  if (!isObject(value)) return { ok: false, errors: ['Backup must be a JSON object.'] };
  if (typeof value.version === 'number' && value.version > 1) {
    return { ok: false, errors: ['Backup version is newer than this app supports.'] };
  }

  const errors: string[] = [];
  const validationNow = Date.now();
  addError(errors, value.kind === 'focus-dial-backup', 'Backup kind must be focus-dial-backup.');
  addError(errors, value.version === 1, 'Backup version must be 1.');
  addError(errors, isTimestamp(value.exportedAt), 'exportedAt must be a timestamp.');

  const activities = validateCollection(value.activities, 'activities', validateActivity, errors);
  const sessions = validateCollection(value.sessions, 'sessions', validateSession, errors);
  const emotions = validateCollection(value.emotions, 'emotions', validateEmotion, errors);
  const emotionEntries = validateCollection(
    value.emotionEntries,
    'emotionEntries',
    validateEmotionEntry,
    errors,
  );
  const goals = validateCollection(value.goals, 'goals', validateGoal, errors);
  const preferences = value.preferences;
  validatePreferences(preferences, errors);

  validateRawUniqueIds(value.activities, 'activities', errors);
  validateRawUniqueIds(value.sessions, 'sessions', errors);
  validateRawUniqueIds(value.emotions, 'emotions', errors);
  validateRawUniqueIds(value.emotionEntries, 'emotionEntries', errors);
  validateRawUniqueIds(value.goals, 'goals', errors);
  errors.push(...activityQuickSlotErrors(activities));

  const rawActivities = Array.isArray(value.activities) ? value.activities : [];
  const rawSessions = Array.isArray(value.sessions) ? value.sessions : [];
  const rawEmotions = Array.isArray(value.emotions) ? value.emotions : [];
  const rawEmotionEntries = Array.isArray(value.emotionEntries) ? value.emotionEntries : [];
  const rawGoals = Array.isArray(value.goals) ? value.goals : [];
  const referencedIds = (records: readonly unknown[]) => new Set(records.flatMap((record) => (
    isObject(record) && isId(record.id) ? [record.id] : []
  )));
  const activityIds = referencedIds(rawActivities);
  const sessionIds = referencedIds(rawSessions);
  const emotionIds = referencedIds(rawEmotions);

  rawSessions.forEach((session, index) => {
    if (isObject(session) && isId(session.activityId) && !activityIds.has(session.activityId)) {
      errors.push(`sessions[${index}].activityId references missing activity ${session.activityId}.`);
    }
  });
  rawEmotionEntries.forEach((entry, index) => {
    if (!isObject(entry)) return;
    if (isId(entry.emotionId) && !emotionIds.has(entry.emotionId)) {
      errors.push(`emotionEntries[${index}].emotionId references missing emotion ${entry.emotionId}.`);
    }
    if (isId(entry.activityId) && !activityIds.has(entry.activityId)) {
      errors.push(`emotionEntries[${index}].activityId references missing activity ${entry.activityId}.`);
    }
    if (isId(entry.sessionId) && !sessionIds.has(entry.sessionId)) {
      errors.push(`emotionEntries[${index}].sessionId references missing session ${entry.sessionId}.`);
    }
  });

  errors.push(...linkedEmotionEntryErrors(emotionEntries, sessions, validationNow));
  rawGoals.forEach((goal, index) => {
    if (isObject(goal) && isId(goal.activityId) && !activityIds.has(goal.activityId)) {
      errors.push(`goals[${index}].activityId references missing activity ${goal.activityId}.`);
    }
  });
  if (
    isObject(preferences)
    && isId(preferences.lastPausedActivityId)
    && !activityIds.has(preferences.lastPausedActivityId)
  ) {
    errors.push(
      `preferences.lastPausedActivityId references missing activity ${preferences.lastPausedActivityId}.`,
    );
  }

  const inspectableSessions = rawSessions.flatMap((session): SessionInterval[] => (
    isObject(session)
      && isId(session.id)
      && isTimestamp(session.startedAt)
      && (session.endedAt === null || isTimestamp(session.endedAt))
      ? [{ id: session.id, startedAt: session.startedAt, endedAt: session.endedAt }]
      : []
  ));
  errors.push(...sessionGlobalInvariantErrors(inspectableSessions, validationNow));

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, backup: value as unknown as FocusDialBackupV1 };
}

function assertValidBackup(backup: unknown): FocusDialBackupV1 {
  const result = validateBackupValue(backup);
  if (result.ok) return result.backup;
  throw new Error(result.errors.join('\n'));
}

export async function createBackup(repo: FocusDialRepository): Promise<FocusDialBackupV1> {
  const [activities, sessions, emotions, emotionEntries, goals, preferences] = await Promise.all([
    repo.listActivities(true),
    repo.listSessions(),
    repo.listEmotions(true),
    repo.listEmotionEntries(),
    repo.listGoals(),
    repo.getPreferences(),
  ]);
  return {
    kind: 'focus-dial-backup',
    version: 1,
    exportedAt: Date.now(),
    activities,
    sessions,
    emotions,
    emotionEntries,
    goals,
    preferences,
  };
}

export function parseBackup(text: string): ParseBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, errors: ['Backup is not valid JSON.'] };
  }
  return validateBackupValue(parsed);
}

function csvField(value: string | number | null): string {
  if (value === null) return '';
  const text = typeof value === 'string'
    && /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(value)
    ? `'${value}`
    : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: ReadonlyArray<string | number | null>): string {
  return values.map(csvField).join(',');
}

export function sessionsToCsv(sessions: readonly Session[]): string {
  return [
    'id,activityId,startedAt,endedAt,createdAt,updatedAt',
    ...sessions.map((session) => csvRow([
      session.id,
      session.activityId,
      session.startedAt,
      session.endedAt,
      session.createdAt,
      session.updatedAt,
    ])),
  ].join('\r\n');
}

export function emotionEntriesToCsv(entries: readonly EmotionEntry[]): string {
  return [
    'id,emotionId,intensity,comment,recordedAt,activityId,sessionId,createdAt,updatedAt',
    ...entries.map((entry) => csvRow([
      entry.id,
      entry.emotionId,
      entry.intensity,
      entry.comment,
      entry.recordedAt,
      entry.activityId,
      entry.sessionId,
      entry.createdAt,
      entry.updatedAt,
    ])),
  ].join('\r\n');
}

export function downloadTextFile(contents: string, filename: string, type: string): void {
  const anchor = document.createElement('a');
  const blob = new Blob([contents], { type });
  const canUseObjectUrl = typeof URL.createObjectURL === 'function';
  const url = canUseObjectUrl
    ? URL.createObjectURL(blob)
    : `data:${type},${encodeURIComponent(contents)}`;
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    if (canUseObjectUrl) URL.revokeObjectURL(url);
  }
}

function timestampedFilename(prefix: string, extension: string): string {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  return `${prefix}-${stamp}.${extension}`;
}

export async function previewImport(
  backup: FocusDialBackupV1,
  repo: FocusDialRepository,
): Promise<ImportPreview> {
  const validBackup = assertValidBackup(backup);
  const [activities, sessions, emotions, emotionEntries, goals] = await Promise.all([
    repo.listActivities(true),
    repo.listSessions(),
    repo.listEmotions(true),
    repo.listEmotionEntries(),
    repo.listGoals(),
  ]);
  const existingIds = [activities, sessions, emotions, emotionEntries, goals]
    .map((records) => new Set(records.map(({ id }) => id)));
  const incoming = [
    validBackup.activities,
    validBackup.sessions,
    validBackup.emotions,
    validBackup.emotionEntries,
    validBackup.goals,
  ];
  const duplicateIds = incoming.reduce(
    (total, records, index) => total + records.filter(({ id }) => existingIds[index]!.has(id)).length,
    0,
  );
  const dates = [
    ...validBackup.sessions.flatMap((session) => (
      session.endedAt === null ? [session.startedAt] : [session.startedAt, session.endedAt]
    )),
    ...validBackup.emotionEntries.map(({ recordedAt }) => recordedAt),
  ];
  return {
    counts: {
      activities: validBackup.activities.length,
      sessions: validBackup.sessions.length,
      emotions: validBackup.emotions.length,
      emotionEntries: validBackup.emotionEntries.length,
      goals: validBackup.goals.length,
    },
    start: dates.length === 0 ? null : Math.min(...dates),
    end: dates.length === 0 ? null : Math.max(...dates),
    duplicateIds,
  };
}

async function putAll(repo: FocusDialRepository, backup: FocusDialBackupV1): Promise<void> {
  for (const activity of backup.activities) await repo.putActivity(activity);
  for (const session of backup.sessions) await repo.putSession(session);
  for (const emotion of backup.emotions) await repo.putEmotion(emotion);
  for (const entry of backup.emotionEntries) await repo.putEmotionEntry(entry);
  for (const goal of backup.goals) await repo.putGoal(goal);
}

export async function importBackup(
  backup: FocusDialBackupV1,
  mode: ImportMode,
  repo: FocusDialRepository,
): Promise<void> {
  const validBackup = assertValidBackup(backup);
  if (mode !== 'additive' && mode !== 'replace-all') throw new Error('Import mode is invalid.');

  if (mode === 'replace-all') {
    const safetyBackup = await createBackup(repo);
    downloadTextFile(
      JSON.stringify(safetyBackup, null, 2),
      timestampedFilename('focus-dial-safety-backup', 'json'),
      'application/json;charset=utf-8',
    );
    await repo.runWrite(async () => {
      await repo.clearAll();
      await putAll(repo, validBackup);
      await repo.putPreferences(validBackup.preferences);
    });
    return;
  }

  await repo.runWrite(async () => {
    const [activities, sessions, emotions, emotionEntries, goals] = await Promise.all([
      repo.listActivities(true),
      repo.listSessions(),
      repo.listEmotions(true),
      repo.listEmotionEntries(),
      repo.listGoals(),
    ]);
    const activityIds = new Set(activities.map(({ id }) => id));
    const sessionIds = new Set(sessions.map(({ id }) => id));
    const emotionIds = new Set(emotions.map(({ id }) => id));
    const emotionEntryIds = new Set(emotionEntries.map(({ id }) => id));
    const goalIds = new Set(goals.map(({ id }) => id));
    const newActivities = validBackup.activities.filter(({ id }) => !activityIds.has(id));
    const newSessions = validBackup.sessions.filter(({ id }) => !sessionIds.has(id));
    const newEmotionEntries = validBackup.emotionEntries.filter(({ id }) => (
      !emotionEntryIds.has(id)
    ));
    const validationNow = Date.now();
    const mergedErrors = [
      ...activityQuickSlotErrors([...activities, ...newActivities]),
      ...sessionInvariantErrors([...sessions, ...newSessions]),
      ...linkedEmotionEntryErrors(
        newEmotionEntries,
        [...sessions, ...newSessions],
        validationNow,
      ),
    ];
    if (mergedErrors.length > 0) {
      throw new Error(`Backup cannot be added: ${mergedErrors.join(' ')}`);
    }
    for (const activity of newActivities) await repo.putActivity(activity);
    for (const session of newSessions) await repo.putSession(session);
    for (const emotion of validBackup.emotions) {
      if (!emotionIds.has(emotion.id)) await repo.putEmotion(emotion);
    }
    for (const entry of newEmotionEntries) await repo.putEmotionEntry(entry);
    for (const goal of validBackup.goals) {
      if (!goalIds.has(goal.id)) await repo.putGoal(goal);
    }
  });
}

export async function resetToApprovedDefaults(repo: FocusDialRepository): Promise<void> {
  await repo.runWrite(async () => {
    await repo.clearAll();
    for (const activity of DEFAULT_ACTIVITIES) await repo.putActivity({ ...activity });
    for (const emotion of DEFAULT_EMOTIONS) await repo.putEmotion({ ...emotion });
    await repo.putPreferences({ ...DEFAULT_PREFERENCES });
  });
}
