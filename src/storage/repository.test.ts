import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { createDexieRepository } from './dexieRepository';
import { createMemoryRepository } from './memoryRepository';
import type {
  Activity,
  EmotionEntry,
  FocusDialRepository,
  Goal,
  Session,
} from '../domain/models';

const databaseNames = new Set<string>();
let databaseSequence = 0;

afterEach(async () => {
  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));
  databaseNames.clear();
});

function createIndexedDbRepository(): FocusDialRepository {
  databaseSequence += 1;
  const name = `focus-dial-repository-test-${databaseSequence}`;
  databaseNames.add(name);
  return createDexieRepository(name);
}

const implementations: ReadonlyArray<{
  name: string;
  factory: () => FocusDialRepository;
}> = [
  { name: 'memory', factory: createMemoryRepository },
  { name: 'IndexedDB', factory: createIndexedDbRepository },
];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe.each(implementations)('$name repository', ({ factory }) => {
  it('seeds the approved defaults', async () => {
    const repo = factory();

    const activities = await repo.listActivities();
    expect(activities.map((activity) => activity.name)).toEqual([
      'Study',
      'Exercise',
      'Work',
      'Social',
      'Eat',
      'Doom Scrolling',
      'Doing Nothing',
    ]);
    expect(activities.filter((activity) => activity.quickSlot).map((activity) => activity.quickSlot)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(new Set(activities.map((activity) => activity.quickSlot).filter(Boolean)).size).toBe(4);

    expect((await repo.listEmotions()).map((emotion) => emotion.name)).toEqual([
      'Happy',
      'Calm',
      'Focused',
      'Energized',
      'Tired',
      'Anxious',
      'Frustrated',
      'Sad',
    ]);
    expect(await repo.getPreferences()).toMatchObject({ schemaVersion: 1, weekStartsOn: 1 });
    expect(await repo.getActiveSession()).toBeUndefined();
    expect(await repo.listSessions()).toEqual([]);
  });

  it('notifies a subscriber once after a completed write and not midway through it', async () => {
    const repo = factory();
    const notifications: string[] = [];
    const unsubscribe = repo.subscribe(() => notifications.push('notified'));
    const study = (await repo.listActivities())[0]!;

    await repo.runWrite(async () => {
      await repo.putActivity({ ...study, name: 'Deep Study' });
      expect(notifications).toEqual([]);
      expect((await repo.listActivities())[0]?.name).toBe('Deep Study');
      expect(notifications).toEqual([]);
    });

    expect(notifications).toEqual(['notified']);
    unsubscribe();
  });

  it('supports the record contract and filters archived and ranged records', async () => {
    const repo = factory();
    const archivedActivity: Activity = {
      id: 'activity-archived',
      name: 'Archived',
      color: '#000000',
      sortOrder: 8,
      quickSlot: null,
      archivedAt: 1,
    };
    const session: Session = {
      id: 'session-active',
      activityId: 'activity-study',
      startedAt: 100,
      endedAt: null,
      createdAt: 100,
      updatedAt: 100,
    };
    const completedSession: Session = {
      ...session,
      id: 'session-completed',
      startedAt: 20,
      endedAt: 40,
    };
    const entry: EmotionEntry = {
      id: 'entry-happy',
      emotionId: 'emotion-happy',
      intensity: 4,
      comment: 'Steady progress',
      recordedAt: 110,
      activityId: 'activity-study',
      sessionId: 'session-active',
      createdAt: 110,
      updatedAt: 110,
    };
    const goal: Goal = {
      id: 'goal-study',
      activityId: 'activity-study',
      period: 'daily',
      direction: 'minimum',
      targetMinutes: 60,
      enabled: true,
    };

    await repo.runWrite(async () => {
      await repo.putActivity(archivedActivity);
      await repo.putSession(session);
      await repo.putSession(completedSession);
      await repo.putEmotionEntry(entry);
      await repo.putGoal(goal);
    });

    expect((await repo.listActivities()).some(({ id }) => id === archivedActivity.id)).toBe(false);
    expect((await repo.listActivities(true)).some(({ id }) => id === archivedActivity.id)).toBe(true);
    expect(await repo.getSession(session.id)).toEqual(session);
    expect(await repo.getActiveSession()).toEqual(session);
    expect(await repo.listSessions({ start: 90, end: 120 })).toEqual([session]);
    expect(await repo.listEmotionEntries({ start: 100, end: 120 })).toEqual([entry]);
    expect(await repo.listGoals()).toEqual([goal]);

    await repo.runWrite(async () => {
      await repo.deleteSession(session.id);
      await repo.deleteEmotionEntry(entry.id);
      await repo.deleteGoal(goal.id);
    });

    expect(await repo.getSession(session.id)).toBeUndefined();
    expect(await repo.listEmotionEntries()).toEqual([]);
    expect(await repo.listGoals()).toEqual([]);
  });

  it('returns detached records that cannot mutate repository state by reference', async () => {
    const repo = factory();
    const activities = await repo.listActivities();
    activities[0]!.name = 'Mutated outside repository';

    expect((await repo.listActivities())[0]?.name).toBe('Study');
  });

  it('normalizes quota failures, publishes unhealthy state, and gates later writes', async () => {
    const repo = factory();
    const healthNotifications: string[] = [];
    const attemptedAfterFailure = vi.fn();
    repo.subscribeHealth(() => healthNotifications.push(repo.getHealth().status));

    await expect(repo.runWrite(async () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    })).rejects.toThrow('Browser storage is full');

    expect(repo.getHealth()).toMatchObject({ status: 'full' });
    expect(healthNotifications).toEqual(['full']);
    await expect(repo.runWrite(async () => {
      attemptedAfterFailure();
    })).rejects.toThrow('Browser storage is full');
    expect(attemptedAfterFailure).not.toHaveBeenCalled();
  });

  it('does not mark ordinary domain errors as storage failure or gate recovery writes', async () => {
    const repo = factory();
    const study = (await repo.listActivities())[0]!;

    await expect(repo.runWrite(async () => {
      throw new Error('Activity name must be 1–40 characters.');
    })).rejects.toThrow('Activity name must be 1–40 characters.');

    expect(repo.getHealth()).toEqual({ status: 'healthy' });
    await repo.runWrite(() => repo.putActivity({ ...study, name: 'Recovered Study' }));
    expect((await repo.listActivities())[0]?.name).toBe('Recovered Study');
  });
});

it('serializes overlapping memory repository writes', async () => {
  const repo = createMemoryRepository();
  const firstMayFinish = deferred();
  const order: string[] = [];

  const first = repo.runWrite(async () => {
    order.push('first started');
    await firstMayFinish.promise;
    order.push('first finished');
  });
  await Promise.resolve();
  const second = repo.runWrite(async () => {
    order.push('second started');
    order.push('second finished');
  });
  await Promise.resolve();

  expect(order).toEqual(['first started']);
  firstMayFinish.resolve();
  await Promise.all([first, second]);
  expect(order).toEqual([
    'first started',
    'first finished',
    'second started',
    'second finished',
  ]);
});

it('rolls back a rejected memory write and recovers for the next queued write', async () => {
  const repo = createMemoryRepository();
  const study = (await repo.listActivities())[0]!;
  const notifications: string[] = [];
  repo.subscribe(() => notifications.push('notified'));

  await expect(repo.runWrite(async () => {
    await repo.putActivity({ ...study, name: 'Must roll back' });
    await repo.putSession({
      id: 'rolled-back-session',
      activityId: study.id,
      startedAt: 1_000,
      endedAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    throw new Error('injected write rejection');
  })).rejects.toThrow('injected write rejection');

  expect((await repo.listActivities())[0]).toEqual(study);
  expect(await repo.listSessions()).toEqual([]);
  expect(notifications).toEqual([]);

  await repo.runWrite(() => repo.putActivity({ ...study, name: 'Recovered Study' }));

  expect((await repo.listActivities())[0]?.name).toBe('Recovered Study');
  expect(notifications).toEqual(['notified']);
});

it('invalidates another Dexie repository using the same database only after commit', async () => {
  databaseSequence += 1;
  const name = `focus-dial-shared-repository-test-${databaseSequence}`;
  databaseNames.add(name);
  const first = createDexieRepository(name);
  const second = createDexieRepository(name);
  const notifications: string[] = [];
  const writeStarted = deferred();
  const mayWrite = deferred();
  second.subscribe(() => notifications.push('notified'));
  const study = (await first.listActivities())[0]!;
  await second.listActivities();

  const write = first.runWrite(async () => {
    writeStarted.resolve();
    await mayWrite.promise;
    await first.putActivity({ ...study, name: 'Shared Deep Study' });
  });
  await writeStarted.promise;
  expect(notifications).toEqual([]);

  mayWrite.resolve();
  await write;
  await Promise.resolve();

  expect(notifications).toEqual(['notified']);
  expect((await second.listActivities())[0]?.name).toBe('Shared Deep Study');
});

it('stops a disposed Dexie repository from receiving invalidation', async () => {
  databaseSequence += 1;
  const name = `focus-dial-disposed-repository-test-${databaseSequence}`;
  databaseNames.add(name);
  const writer = createDexieRepository(name);
  const disposed = createDexieRepository(name);
  const notifications: string[] = [];
  disposed.subscribe(() => notifications.push('notified'));
  await disposed.listActivities();

  expect('dispose' in disposed).toBe(true);
  if (!('dispose' in disposed)) return;
  (disposed as FocusDialRepository & { dispose(): void }).dispose();
  const study = (await writer.listActivities())[0]!;
  await writer.runWrite(() => writer.putActivity({ ...study, name: 'After disposal' }));
  await Promise.resolve();

  expect(notifications).toEqual([]);
});

it('uses visibility restoration as a same-browser invalidation fallback', async () => {
  const repo = createIndexedDbRepository();
  const notifications: string[] = [];
  repo.subscribe(() => notifications.push('notified'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

  document.dispatchEvent(new Event('visibilitychange'));

  expect(notifications).toEqual(['notified']);
});
