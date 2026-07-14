import type {
  FocusDialRepository,
  Id,
  Preferences,
  Session,
  SwitchResult,
  TimerUndoToken,
} from '../../domain/models';

export type { SwitchResult, TimerUndoToken } from '../../domain/models';

const INVALID_TIMER_TIME_MESSAGE = 'Timer time must be later than its start.';

function assertValidCloseTime(session: Session, at: number): void {
  if (at <= session.startedAt) throw new Error(INVALID_TIMER_TIME_MESSAGE);
}

export class TimerService {
  constructor(
    private readonly repo: FocusDialRepository,
    private readonly makeId: () => string = () => crypto.randomUUID(),
  ) {}

  switchTo(activityId: Id, at = Date.now()): Promise<SwitchResult> {
    return this.repo.runWrite(async () => {
      const previousSession = (await this.repo.getActiveSession()) ?? null;

      if (previousSession?.activityId === activityId) {
        return { active: previousSession, undo: null };
      }

      if (previousSession !== null) {
        assertValidCloseTime(previousSession, at);
        await this.repo.putSession({ ...previousSession, endedAt: at, updatedAt: at });
      }

      const active: Session = {
        id: this.makeId(),
        activityId,
        startedAt: at,
        endedAt: null,
        createdAt: at,
        updatedAt: at,
      };
      await this.repo.putSession(active);

      return {
        active,
        undo: { createdSessionId: active.id, previousSession },
      };
    });
  }

  undoSwitch(token: TimerUndoToken): Promise<Session | null> {
    return this.repo.runWrite(async () => {
      const active = await this.repo.getActiveSession();
      if (active?.id !== token.createdSessionId) return null;

      await this.repo.deleteSession(token.createdSessionId);
      if (token.previousSession === null) return null;

      const restored: Session = { ...token.previousSession, endedAt: null };
      await this.repo.putSession(restored);
      return restored;
    });
  }

  pause(at = Date.now()): Promise<Session | null> {
    return this.closeActive(at, 'pause');
  }

  stop(at = Date.now()): Promise<Session | null> {
    return this.closeActive(at, 'stop');
  }

  private closeActive(at: number, command: 'pause' | 'stop'): Promise<Session | null> {
    return this.repo.runWrite(async () => {
      const active = await this.repo.getActiveSession();
      if (active === undefined) return null;

      assertValidCloseTime(active, at);
      const completed: Session = { ...active, endedAt: at, updatedAt: at };
      const preferences: Preferences = await this.repo.getPreferences();

      await this.repo.putSession(completed);
      await this.repo.putPreferences({
        ...preferences,
        lastPausedActivityId: command === 'pause' ? active.activityId : null,
      });

      return completed;
    });
  }
}
