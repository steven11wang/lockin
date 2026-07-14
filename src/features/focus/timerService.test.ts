import { createMemoryRepository } from '../../storage/memoryRepository';
import type { FocusDialRepository, Session } from '../../domain/models';
import { TimerService, type SwitchResult, type TimerUndoToken } from './timerService';

const STUDY_ID = 'activity-study';
const EXERCISE_ID = 'activity-exercise';
const WORK_ID = 'activity-work';

function createIdFactory(...ids: string[]): () => string {
  let index = 0;

  return () => {
    const id = ids[index];
    if (id === undefined) throw new Error('Test ID factory exhausted.');
    index += 1;
    return id;
  };
}

function requireUndo(result: SwitchResult): TimerUndoToken {
  if (result.undo === null) throw new Error('Expected an undo token.');
  return result.undo;
}

async function expectOnlyActive(repo: FocusDialRepository, expected: Session): Promise<void> {
  expect(await repo.getActiveSession()).toEqual(expected);
  expect(await repo.listSessions()).toEqual([expected]);
}

describe('TimerService', () => {
  it('starts the first session with the injected ID and absolute timestamp', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(repo, createIdFactory('session-study'));

    const result = await service.switchTo(STUDY_ID, 1_000);

    const expected: Session = {
      id: 'session-study',
      activityId: STUDY_ID,
      startedAt: 1_000,
      endedAt: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    expect(result).toEqual({
      active: expected,
      undo: { createdSessionId: 'session-study', previousSession: null },
    });
    await expectOnlyActive(repo, expected);
  });

  it('returns the existing session when the active activity is selected again', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(repo, createIdFactory('session-study'));
    const first = await service.switchTo(STUDY_ID, 1_000);

    const repeated = await service.switchTo(STUDY_ID, 9_000);

    expect(repeated).toEqual({ active: first.active, undo: null });
    await expectOnlyActive(repo, first.active);
  });

  it('atomically ends and starts sessions at the same switch timestamp', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(repo, createIdFactory('session-study', 'session-exercise'));
    await service.switchTo(STUDY_ID, 1_000);
    let notifications = 0;
    repo.subscribe(() => {
      notifications += 1;
    });

    const switched = await service.switchTo(EXERCISE_ID, 2_500);

    expect(notifications).toBe(1);
    expect(await repo.listSessions()).toEqual([
      {
        id: 'session-study',
        activityId: STUDY_ID,
        startedAt: 1_000,
        endedAt: 2_500,
        createdAt: 1_000,
        updatedAt: 2_500,
      },
      {
        id: 'session-exercise',
        activityId: EXERCISE_ID,
        startedAt: 2_500,
        endedAt: null,
        createdAt: 2_500,
        updatedAt: 2_500,
      },
    ]);
    expect(switched.active).toEqual(await repo.getActiveSession());
    expect(requireUndo(switched)).toEqual({
      createdSessionId: 'session-exercise',
      previousSession: {
        id: 'session-study',
        activityId: STUDY_ID,
        startedAt: 1_000,
        endedAt: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
    });
  });

  it('undoes a switch by deleting the new session and restoring the previous active session', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(repo, createIdFactory('session-study', 'session-exercise'));
    const first = await service.switchTo(STUDY_ID, 1_000);
    const switched = await service.switchTo(EXERCISE_ID, 2_500);

    const restored = await service.undoSwitch(requireUndo(switched));

    expect(restored).toEqual(first.active);
    await expectOnlyActive(repo, first.active);
    expect(await repo.getSession('session-exercise')).toBeUndefined();
  });

  it.each(['switch', 'pause', 'stop'] as const)(
    'rejects a %s close at or before the active session start without partial writes',
    async (command) => {
      const repo = createMemoryRepository();
      const service = new TimerService(repo, createIdFactory('session-study', 'session-exercise'));
      const started = await service.switchTo(STUDY_ID, 5_000);

      const close = (at: number) => {
        if (command === 'switch') return service.switchTo(EXERCISE_ID, at);
        if (command === 'pause') return service.pause(at);
        return service.stop(at);
      };

      await expect(close(5_000)).rejects.toThrow('Timer time must be later than its start.');
      await expect(close(4_999)).rejects.toThrow('Timer time must be later than its start.');
      await expectOnlyActive(repo, started.active);
      expect(await repo.getPreferences()).toMatchObject({ lastPausedActivityId: null });
    },
  );

  it('pauses by closing the active session and remembering its activity', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(repo, createIdFactory('session-study'));
    await service.switchTo(STUDY_ID, 1_000);

    const paused = await service.pause(2_000);

    expect(paused).toEqual({
      id: 'session-study',
      activityId: STUDY_ID,
      startedAt: 1_000,
      endedAt: 2_000,
      createdAt: 1_000,
      updatedAt: 2_000,
    });
    expect(await repo.getActiveSession()).toBeUndefined();
    expect(await repo.getPreferences()).toMatchObject({ lastPausedActivityId: STUDY_ID });
  });

  it('stops by closing the active session and clearing the paused suggestion', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(repo, createIdFactory('session-one', 'session-two'));
    await service.switchTo(STUDY_ID, 1_000);
    await service.pause(2_000);
    await service.switchTo(STUDY_ID, 3_000);
    expect(await repo.getPreferences()).toMatchObject({ lastPausedActivityId: STUDY_ID });

    const stopped = await service.stop(4_000);

    expect(stopped).toMatchObject({ id: 'session-two', endedAt: 4_000, updatedAt: 4_000 });
    expect(await repo.getActiveSession()).toBeUndefined();
    expect(await repo.getPreferences()).toMatchObject({ lastPausedActivityId: null });
  });

  it('rejects an undo token after another session supersedes its created session', async () => {
    const repo = createMemoryRepository();
    const service = new TimerService(
      repo,
      createIdFactory('session-study', 'session-exercise', 'session-work'),
    );
    await service.switchTo(STUDY_ID, 1_000);
    const firstSwitch = await service.switchTo(EXERCISE_ID, 2_000);
    await service.switchTo(WORK_ID, 3_000);
    const beforeUndo = await repo.listSessions();

    const restored = await service.undoSwitch(requireUndo(firstSwitch));

    expect(restored).toBeNull();
    expect(await repo.listSessions()).toEqual(beforeUndo);
    expect(await repo.getActiveSession()).toMatchObject({
      id: 'session-work',
      activityId: WORK_ID,
      endedAt: null,
    });
  });
});
