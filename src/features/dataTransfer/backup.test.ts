import { DEFAULT_ACTIVITIES, DEFAULT_EMOTIONS, DEFAULT_PREFERENCES } from '../../domain/defaults';
import type {
  Activity,
  Emotion,
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Preferences,
  Session,
} from '../../domain/models';
import { createMemoryRepository } from '../../storage/memoryRepository';
import {
  createBackup,
  emotionEntriesToCsv,
  importBackup,
  parseBackup,
  previewImport,
  resetToApprovedDefaults,
  sessionsToCsv,
  type FocusDialBackupV1,
} from './backup';

const archivedActivity: Activity = {
  id: 'activity-night,shift',
  name: 'Night "shift"',
  color: '#123456',
  icon: '🌙',
  sortOrder: 9,
  quickSlot: null,
  archivedAt: new Date('2026-07-13T13:00:00Z').getTime(),
};

const archivedEmotion: Emotion = {
  id: 'emotion-reflective',
  name: 'Reflective',
  color: '#654321',
  sortOrder: 9,
  archivedAt: new Date('2026-07-13T14:00:00Z').getTime(),
};

const crossMidnightSession: Session = {
  id: 'session-cross-midnight',
  activityId: archivedActivity.id,
  startedAt: new Date('2026-07-12T23:30:00Z').getTime(),
  endedAt: new Date('2026-07-13T01:15:00Z').getTime(),
  createdAt: new Date('2026-07-12T23:30:00Z').getTime(),
  updatedAt: new Date('2026-07-13T01:15:00Z').getTime(),
};

const commentedEntry: EmotionEntry = {
  id: 'entry-reflective',
  emotionId: archivedEmotion.id,
  intensity: 4,
  comment: 'Long, quiet night\nShe said "keep going".',
  recordedAt: new Date('2026-07-13T00:30:00Z').getTime(),
  activityId: archivedActivity.id,
  sessionId: crossMidnightSession.id,
  createdAt: new Date('2026-07-13T00:30:00Z').getTime(),
  updatedAt: new Date('2026-07-13T00:35:00Z').getTime(),
};

const archivedGoal: Goal = {
  id: 'goal-night-shift',
  activityId: archivedActivity.id,
  period: 'weekly',
  direction: 'maximum',
  targetMinutes: 300,
  enabled: false,
};

const customPreferences: Preferences = {
  ...DEFAULT_PREFERENCES,
  weekStartsOn: 0,
  hourCycle: 24,
  reducedMotion: true,
  lastPausedActivityId: archivedActivity.id,
};

function completeRepository(): FocusDialRepository {
  return createMemoryRepository({
    activities: [...DEFAULT_ACTIVITIES, archivedActivity],
    sessions: [crossMidnightSession],
    emotions: [...DEFAULT_EMOTIONS, archivedEmotion],
    emotionEntries: [commentedEntry],
    goals: [archivedGoal],
    preferences: customPreferences,
  });
}

async function dataSnapshot(repository: FocusDialRepository) {
  return {
    activities: await repository.listActivities(true),
    sessions: await repository.listSessions(),
    emotions: await repository.listEmotions(true),
    emotionEntries: await repository.listEmotionEntries(),
    goals: await repository.listGoals(),
    preferences: await repository.getPreferences(),
  };
}

async function dataBytes(repository: FocusDialRepository): Promise<string> {
  return JSON.stringify(await dataSnapshot(repository));
}

async function invalidNamesBackup(): Promise<FocusDialBackupV1> {
  const backup = await createBackup(createMemoryRepository());
  backup.activities[0] = { ...backup.activities[0]!, name: '   ' };
  backup.emotions[0] = { ...backup.emotions[0]!, name: ` ${'x'.repeat(41)} ` };
  return backup;
}

function installDownloadSpy(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
}

describe('Focus Dial backups', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('round-trips every record and preference through JSON without data loss', async () => {
    const backup = await createBackup(completeRepository());
    const parsed = parseBackup(JSON.stringify(backup));

    expect(parsed).toEqual({ ok: true, backup });
    expect(backup).toMatchObject({ kind: 'focus-dial-backup', version: 1 });
    expect(backup.activities).toContainEqual(archivedActivity);
    expect(backup.sessions).toContainEqual(crossMidnightSession);
    expect(backup.emotionEntries).toContainEqual(commentedEntry);
    expect(backup.goals).toContainEqual(archivedGoal);
    expect(backup.preferences).toEqual(customPreferences);
  });

  it('quotes commas, newlines, and double quotes in the separate CSV exports', () => {
    expect(sessionsToCsv([crossMidnightSession])).toBe([
      'id,activityId,startedAt,endedAt,createdAt,updatedAt',
      `session-cross-midnight,"activity-night,shift",${crossMidnightSession.startedAt},${crossMidnightSession.endedAt},${crossMidnightSession.createdAt},${crossMidnightSession.updatedAt}`,
    ].join('\r\n'));

    expect(emotionEntriesToCsv([commentedEntry])).toBe([
      'id,emotionId,intensity,comment,recordedAt,activityId,sessionId,createdAt,updatedAt',
      `entry-reflective,emotion-reflective,4,"Long, quiet night\nShe said ""keep going"".",${commentedEntry.recordedAt},"activity-night,shift",session-cross-midnight,${commentedEntry.createdAt},${commentedEntry.updatedAt}`,
    ].join('\r\n'));
  });

  it.each(['=', '+', '-', '@'])('neutralizes %s-prefixed text fields in both CSV exports', (prefix) => {
    const dangerous = `${prefix}formula`;
    const dangerousSession: Session = {
      ...crossMidnightSession,
      id: dangerous,
      activityId: dangerous,
    };
    const dangerousEntry: EmotionEntry = {
      ...commentedEntry,
      id: dangerous,
      emotionId: dangerous,
      comment: dangerous,
      activityId: dangerous,
      sessionId: dangerous,
    };

    expect(sessionsToCsv([dangerousSession]).split('\r\n')[1]).toBe(
      `'${dangerous},'${dangerous},${dangerousSession.startedAt},${dangerousSession.endedAt},${dangerousSession.createdAt},${dangerousSession.updatedAt}`,
    );
    expect(emotionEntriesToCsv([dangerousEntry]).split('\r\n')[1]).toBe(
      `'${dangerous},'${dangerous},4,'${dangerous},${dangerousEntry.recordedAt},'${dangerous},'${dangerous},${dangerousEntry.createdAt},${dangerousEntry.updatedAt}`,
    );
  });

  it('neutralizes a formula comment before preserving its commas, newline, and quotes', () => {
    const formulaEntry: EmotionEntry = {
      ...commentedEntry,
      comment: '=SUM(1,2)\n"quoted"',
    };

    expect(emotionEntriesToCsv([formulaEntry])).toContain(
      '4,"\'=SUM(1,2)\n""quoted""",',
    );
  });

  it.each([
    ['spaces and a tab', ' \t=SUM(A1:A2)', "' \t=SUM(A1:A2)"],
    ['a tab', '\t+formula', "'\t+formula"],
    ['a carriage return', '\r-formula', '"\'\r-formula"'],
    ['a C0 control character', '\u0000@formula', "'\u0000@formula"],
    ['a C1 control character', '\u0085=formula', "'\u0085=formula"],
  ])('neutralizes formulas hidden after %s', (_label, dangerous, expectedField) => {
    const dangerousEntry: EmotionEntry = {
      ...commentedEntry,
      comment: dangerous,
    };

    expect(emotionEntriesToCsv([dangerousEntry])).toContain(
      `,4,${expectedField},${dangerousEntry.recordedAt},`,
    );
  });

  it('previews incoming counts, date range, and IDs that already exist', async () => {
    const backup = await createBackup(completeRepository());
    const target = createMemoryRepository();

    await expect(previewImport(backup, target)).resolves.toEqual({
      counts: {
        activities: 8,
        sessions: 1,
        emotions: 9,
        emotionEntries: 1,
        goals: 1,
      },
      start: crossMidnightSession.startedAt,
      end: crossMidnightSession.endedAt,
      duplicateIds: DEFAULT_ACTIVITIES.length + DEFAULT_EMOTIONS.length,
    });
  });

  it('imports additively while retaining existing stable IDs and local preferences', async () => {
    const localSession: Session = {
      ...crossMidnightSession,
      updatedAt: crossMidnightSession.updatedAt + 1,
    };
    const targetPreferences = { ...DEFAULT_PREFERENCES, weekStartsOn: 4 as const };
    const target = createMemoryRepository({ sessions: [localSession], preferences: targetPreferences });
    const backup = await createBackup(completeRepository());

    await importBackup(backup, 'additive', target);

    expect(await target.getSession(localSession.id)).toEqual(localSession);
    expect(await target.listActivities(true)).toContainEqual(archivedActivity);
    expect(await target.listEmotionEntries()).toEqual([commentedEntry]);
    expect(await target.listGoals()).toEqual([archivedGoal]);
    expect(await target.getPreferences()).toEqual(targetPreferences);
  });

  it('rejects a new entry when its duplicate incoming session is skipped for a different retained local session', async () => {
    const localSession: Session = {
      id: 'session-shared',
      activityId: 'activity-study',
      startedAt: 1_000,
      endedAt: 2_000,
      createdAt: 1_000,
      updatedAt: 2_000,
    };
    const incomingSession: Session = {
      ...localSession,
      activityId: 'activity-exercise',
    };
    const newEntry: EmotionEntry = {
      id: 'entry-for-shared-session',
      emotionId: 'emotion-calm',
      intensity: 3,
      comment: '',
      recordedAt: 1_500,
      activityId: 'activity-exercise',
      sessionId: incomingSession.id,
      createdAt: 1_500,
      updatedAt: 1_500,
    };
    const incoming = await createBackup(createMemoryRepository({
      sessions: [incomingSession],
      emotionEntries: [newEntry],
    }));
    const target = createMemoryRepository({ sessions: [localSession] });
    const before = await dataBytes(target);
    const putEmotionEntry = vi.spyOn(target, 'putEmotionEntry');

    await expect(importBackup(incoming, 'additive', target)).rejects.toThrow(
      'Emotion entry entry-for-shared-session activity activity-exercise does not match linked session activity activity-study.',
    );

    expect(putEmotionEntry).not.toHaveBeenCalled();
    expect(await dataBytes(target)).toBe(before);
  });

  it('rejects an additive import that would create two active sessions without changing any data', async () => {
    const localActive: Session = {
      id: 'session-local-active',
      activityId: 'activity-study',
      startedAt: 1_000,
      endedAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const incomingActive: Session = {
      id: 'session-incoming-active',
      activityId: 'activity-study',
      startedAt: 2_000,
      endedAt: null,
      createdAt: 2_000,
      updatedAt: 2_000,
    };
    const target = createMemoryRepository({ sessions: [localActive] });
    const incoming = await createBackup(createMemoryRepository({ sessions: [incomingActive] }));
    const before = await dataBytes(target);

    await expect(importBackup(incoming, 'additive', target)).rejects.toThrow(
      'at most one active session',
    );

    expect(await dataBytes(target)).toBe(before);
  });

  it('rejects histories that overlap only after an additive merge without changing any data', async () => {
    const localSession: Session = {
      id: 'session-local-history',
      activityId: 'activity-study',
      startedAt: 1_000,
      endedAt: 3_000,
      createdAt: 1_000,
      updatedAt: 3_000,
    };
    const incomingSession: Session = {
      id: 'session-incoming-history',
      activityId: 'activity-study',
      startedAt: 2_000,
      endedAt: 4_000,
      createdAt: 2_000,
      updatedAt: 4_000,
    };
    const target = createMemoryRepository({ sessions: [localSession] });
    const incoming = await createBackup(createMemoryRepository({ sessions: [incomingSession] }));
    const before = await dataBytes(target);

    await expect(importBackup(incoming, 'additive', target)).rejects.toThrow(
      'overlaps session',
    );

    expect(await dataBytes(target)).toBe(before);
  });

  it('rejects a quick-slot collision created only by skipped IDs in an additive merge', async () => {
    const importedActivity: Activity = {
      id: 'activity-imported-slot-one',
      name: 'Imported slot one',
      color: '#334455',
      sortOrder: 2,
      quickSlot: 1,
      archivedAt: null,
    };
    const incoming = await createBackup(createMemoryRepository({
      activities: [
        { ...DEFAULT_ACTIVITIES[0]!, quickSlot: null },
        DEFAULT_ACTIVITIES[1]!,
        DEFAULT_ACTIVITIES[2]!,
        DEFAULT_ACTIVITIES[3]!,
        importedActivity,
      ],
    }));
    const target = createMemoryRepository();
    const before = await dataBytes(target);
    const putActivity = vi.spyOn(target, 'putActivity');

    await expect(importBackup(incoming, 'additive', target)).rejects.toThrow(
      'Quick slot 1 is assigned to both activity-study and activity-imported-slot-one.',
    );

    expect(putActivity).not.toHaveBeenCalled();
    expect(await dataBytes(target)).toBe(before);
  });

  it('rejects duplicate backup quick slots before replace-all can download or write', async () => {
    const backup = await createBackup(createMemoryRepository());
    backup.activities[1] = { ...backup.activities[1]!, quickSlot: 1 };
    const target = completeRepository();
    const before = await dataBytes(target);
    const write = vi.spyOn(target, 'runWrite');
    const download = installDownloadSpy();

    await expect(importBackup(backup, 'replace-all', target)).rejects.toThrow(
      'Quick slot 1 is assigned to both activity-study and activity-exercise.',
    );

    expect(write).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(await dataBytes(target)).toBe(before);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed).toEqual({
      ok: false,
      errors: [
        'Quick slot 1 is assigned to both activity-study and activity-exercise.',
        'Quick slot 2 must have exactly one active owner.',
      ],
    });
  });

  it('rejects a full backup unless every slot 1–4 has exactly one active owner', async () => {
    const backup = await createBackup(createMemoryRepository());
    backup.activities[0] = { ...backup.activities[0]!, quickSlot: null };

    const parsed = parseBackup(JSON.stringify(backup));

    expect(parsed).toEqual({
      ok: false,
      errors: ['Quick slot 1 must have exactly one active owner.'],
    });
  });

  it('rejects an additive import when the merged activities lack one of slots 1–4 before writing', async () => {
    const invalidLocalActivities = DEFAULT_ACTIVITIES.map((activity) => (
      activity.quickSlot === 4 ? { ...activity, quickSlot: null } : activity
    ));
    const target = createMemoryRepository({ activities: invalidLocalActivities });
    const incoming = await createBackup(createMemoryRepository());
    const before = await dataBytes(target);
    const putActivity = vi.spyOn(target, 'putActivity');

    await expect(importBackup(incoming, 'additive', target)).rejects.toThrow(
      'Quick slot 4 must have exactly one active owner.',
    );

    expect(putActivity).not.toHaveBeenCalled();
    expect(await dataBytes(target)).toBe(before);
  });

  it('creates a safety download and replaces all data exactly', async () => {
    const click = installDownloadSpy();
    const backup = await createBackup(completeRepository());
    const target = createMemoryRepository({
      sessions: [{ ...crossMidnightSession, id: 'local-only', activityId: 'activity-study' }],
    });

    await importBackup(backup, 'replace-all', target);

    expect(click).toHaveBeenCalledTimes(1);
    expect(await dataSnapshot(target)).toEqual({
      activities: backup.activities,
      sessions: backup.sessions,
      emotions: backup.emotions,
      emotionEntries: backup.emotionEntries,
      goals: backup.goals,
      preferences: backup.preferences,
    });
  });

  it('rolls back a failed replace-all transaction to the original data', async () => {
    installDownloadSpy();
    const target = createMemoryRepository();
    const before = await dataSnapshot(target);
    const originalPutGoal = target.putGoal.bind(target);
    target.putGoal = async (goal) => {
      if (goal.id === archivedGoal.id) throw new Error('storage full');
      await originalPutGoal(goal);
    };
    const backup = await createBackup(completeRepository());

    await expect(importBackup(backup, 'replace-all', target)).rejects.toThrow(
      'Browser storage is full',
    );

    expect(await dataSnapshot(target)).toEqual(before);
  });

  it('collects range, intensity, ID, and reference errors and never starts a write', async () => {
    const valid = await createBackup(completeRepository());
    const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
    const sessions = invalid.sessions as Array<Record<string, unknown>>;
    const entries = invalid.emotionEntries as Array<Record<string, unknown>>;
    sessions[0]!.endedAt = crossMidnightSession.startedAt - 1;
    sessions[0]!.activityId = 'missing-activity';
    entries[0]!.id = '';
    entries[0]!.intensity = 8;
    entries[0]!.emotionId = 'missing-emotion';

    const result = parseBackup(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('sessions[0]'),
      expect.stringContaining('emotionEntries[0].id'),
      expect.stringContaining('emotionEntries[0].intensity'),
      expect.stringContaining('missing-activity'),
      expect.stringContaining('missing-emotion'),
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(5);

    const target = createMemoryRepository();
    const before = await dataSnapshot(target);
    const write = vi.spyOn(target, 'runWrite');
    await expect(importBackup(
      invalid as unknown as FocusDialBackupV1,
      'additive',
      target,
    )).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(await dataSnapshot(target)).toEqual(before);
  });

  it('rejects timestamps outside the JavaScript Date range even when they are safe integers', async () => {
    const backup = await createBackup(completeRepository());
    backup.exportedAt = 8_640_000_000_000_001;
    backup.sessions[0] = {
      ...backup.sessions[0]!,
      createdAt: 8_640_000_000_000_001,
    };

    const result = parseBackup(JSON.stringify(backup));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      'exportedAt must be a timestamp.',
      'sessions[0].createdAt must be a timestamp.',
    ]));
  });

  it('rejects a future active start at validation time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const futureActive: Session = {
      id: 'future-active',
      activityId: 'activity-study',
      startedAt: 11_000,
      endedAt: null,
      createdAt: 11_000,
      updatedAt: 11_000,
    };
    const backup = await createBackup(createMemoryRepository({ sessions: [futureActive] }));

    const result = parseBackup(JSON.stringify(backup));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toContain('Session future-active cannot start in the future while active.');
  });

  it('accumulates linked emotion interval and activity mismatches before preview or write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const linkedSession: Session = {
      id: 'linked-session',
      activityId: 'activity-study',
      startedAt: 1_000,
      endedAt: 2_000,
      createdAt: 1_000,
      updatedAt: 2_000,
    };
    const outsideEntry: EmotionEntry = {
      id: 'outside-entry',
      emotionId: 'emotion-calm',
      intensity: 3,
      comment: '',
      recordedAt: 3_000,
      activityId: 'activity-exercise',
      sessionId: linkedSession.id,
      createdAt: 3_000,
      updatedAt: 3_000,
    };
    const backup = await createBackup(createMemoryRepository({
      sessions: [linkedSession],
      emotionEntries: [outsideEntry],
    }));
    const target = createMemoryRepository();
    const listActivities = vi.spyOn(target, 'listActivities');
    const write = vi.spyOn(target, 'runWrite');

    const result = parseBackup(JSON.stringify(backup));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      'Emotion entry outside-entry must be recorded within linked session linked-session.',
      'Emotion entry outside-entry activity activity-exercise does not match linked session activity activity-study.',
    ]));
    await expect(previewImport(backup, target)).rejects.toThrow(
      'Emotion entry outside-entry must be recorded within linked session linked-session.',
    );
    await expect(importBackup(backup, 'additive', target)).rejects.toThrow(
      'Emotion entry outside-entry activity activity-exercise does not match linked session activity activity-study.',
    );
    expect(listActivities).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a linked emotion entry recorded exactly at a completed session end', async () => {
    const backup = await createBackup(completeRepository());
    backup.emotionEntries[0] = {
      ...backup.emotionEntries[0]!,
      recordedAt: crossMidnightSession.endedAt!,
    };

    const result = parseBackup(JSON.stringify(backup));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toContain(
      'Emotion entry entry-reflective must be recorded within linked session session-cross-midnight.',
    );
  });

  it('requires a linked emotion entry to carry the linked session activity', async () => {
    const backup = await createBackup(completeRepository());
    backup.emotionEntries[0] = {
      ...backup.emotionEntries[0]!,
      activityId: null,
    };

    const result = parseBackup(JSON.stringify(backup));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toContain(
      'Emotion entry entry-reflective must include activity activity-night,shift when linked to session session-cross-midnight.',
    );
  });

  it('treats validation time as the end of a linked active session', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const active: Session = {
      id: 'linked-active',
      activityId: 'activity-study',
      startedAt: 1_000,
      endedAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const entry: EmotionEntry = {
      id: 'future-entry',
      emotionId: 'emotion-calm',
      intensity: 3,
      comment: '',
      recordedAt: 5_001,
      activityId: 'activity-study',
      sessionId: active.id,
      createdAt: 5_001,
      updatedAt: 5_001,
    };
    const backup = await createBackup(createMemoryRepository({
      sessions: [active],
      emotionEntries: [entry],
    }));

    const result = parseBackup(JSON.stringify(backup));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toContain(
      'Emotion entry future-entry must be recorded within linked session linked-active.',
    );
  });

  it('reports a duplicate ID even when the duplicate row has another malformed field', async () => {
    const valid = await createBackup(createMemoryRepository());
    const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
    const activities = invalid.activities as Array<Record<string, unknown>>;
    activities.push({ ...activities[0]!, color: 42 });

    const result = parseBackup(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('activities[7].color'),
      expect.stringContaining('activities[7].id duplicates activity-study'),
    ]));
  });

  it('includes inspectable malformed sessions in active-session and overlap diagnostics', async () => {
    const valid = await createBackup(createMemoryRepository());
    const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
    invalid.sessions = [
      {
        id: 'active-one',
        activityId: 'activity-study',
        startedAt: 1_000,
        endedAt: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      {
        id: 'active-two',
        activityId: 'activity-study',
        startedAt: 2_000,
        endedAt: null,
        createdAt: 2_000,
        updatedAt: 'later',
      },
    ];

    const result = parseBackup(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('sessions[1].updatedAt'),
      expect.stringContaining('at most one active session'),
      expect.stringContaining('Session active-two overlaps session active-one'),
    ]));
  });

  it('reports a missing paused-activity reference when another preference field is invalid', async () => {
    const valid = await createBackup(createMemoryRepository());
    const invalid = structuredClone(valid) as unknown as Record<string, unknown>;
    invalid.preferences = {
      ...invalid.preferences as Record<string, unknown>,
      hourCycle: 13,
      lastPausedActivityId: 'missing-paused-activity',
    };

    const result = parseBackup(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      'preferences.hourCycle must be 12 or 24.',
      'preferences.lastPausedActivityId references missing activity missing-paused-activity.',
    ]));
  });

  it('reports whitespace-only and over-40-character trimmed label names together', async () => {
    const invalid = await invalidNamesBackup();

    const result = parseBackup(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.errors).toEqual(expect.arrayContaining([
      'activities[0].name must be 1–40 characters after trimming.',
      'emotions[0].name must be 1–40 characters after trimming.',
    ]));
  });

  it.each(['additive', 'replace-all'] as const)(
    'rejects invalid label names before a %s import can download or write',
    async (mode) => {
      const invalid = await invalidNamesBackup();
      const target = createMemoryRepository();
      const before = await dataBytes(target);
      const write = vi.spyOn(target, 'runWrite');
      const download = installDownloadSpy();

      await expect(importBackup(invalid, mode, target)).rejects.toThrow(
        'activities[0].name must be 1–40 characters after trimming.',
      );

      expect(write).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
      expect(await dataBytes(target)).toBe(before);
    },
  );

  it('rejects a newer schema version with the required message', () => {
    const result = parseBackup(JSON.stringify({
      kind: 'focus-dial-backup',
      version: 2,
    }));

    expect(result).toEqual({
      ok: false,
      errors: ['Backup version is newer than this app supports.'],
    });
  });

  it('resets atomically to the approved starter records and preferences', async () => {
    const repository = completeRepository();
    const write = vi.spyOn(repository, 'runWrite');

    await resetToApprovedDefaults(repository);

    expect(write).toHaveBeenCalledTimes(1);
    expect(await dataSnapshot(repository)).toEqual({
      activities: [...DEFAULT_ACTIVITIES],
      sessions: [],
      emotions: [...DEFAULT_EMOTIONS],
      emotionEntries: [],
      goals: [],
      preferences: DEFAULT_PREFERENCES,
    });
  });
});
