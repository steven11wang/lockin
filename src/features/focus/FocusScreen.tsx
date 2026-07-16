import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useRepository, useRepositoryQuery } from '../../app/RepositoryContext';
import type { Activity, Id, Preferences, TimerUndoToken } from '../../domain/models';
import { calculateGoalProgress, describeGoalProgress } from '../goals/goalProgress';
import { getLocalDayRange } from '../today/timeline';
import { aggregateActivities, getWeekRange } from '../week/aggregate';
import { Dial } from './Dial';
import { EndSessionDialog } from './EndSessionDialog';
import {
  forgottenPromptMessage,
  isForgottenSession,
} from './forgottenSession';
import { TimerService } from './timerService';
import { formatElapsed, useActiveTimer } from './useActiveTimer';
import './focus.css';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The timer could not be updated.';
}

export function FocusScreen(): JSX.Element {
  const repository = useRepository();
  const timer = useMemo(() => new TimerService(repository), [repository]);
  const activities = useRepositoryQuery((repo) => repo.listActivities(), [], [] as Activity[]);
  const preferences = useRepositoryQuery<Preferences | null>(
    (repo) => repo.getPreferences(),
    [],
    null,
  );
  const sessions = useRepositoryQuery((repo) => repo.listSessions(), [], []);
  const goals = useRepositoryQuery((repo) => repo.listGoals(), [], []);
  const { active, elapsedMs } = useActiveTimer();
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const [undoToken, setUndoToken] = useState<TimerUndoToken | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [forgottenOpen, setForgottenOpen] = useState(false);
  const [endEarlierOpen, setEndEarlierOpen] = useState(false);
  const [endEarlierError, setEndEarlierError] = useState<string | null>(null);
  const [endEarlierSaving, setEndEarlierSaving] = useState(false);
  const dismissedForgottenSessionId = useRef<Id | null>(null);
  const timerCommandQueue = useRef<Promise<void>>(Promise.resolve());

  const quickActivities = [...activities]
    .filter((activity) => activity.quickSlot !== null)
    .sort((left, right) => (left.quickSlot ?? 0) - (right.quickSlot ?? 0));
  const activeActivity = activities.find((activity) => activity.id === active?.activityId);
  const pausedActivity = active === undefined
    ? activities.find((activity) => activity.id === preferences?.lastPausedActivityId)
    : undefined;
  const progressNow = active === undefined ? Date.now() : active.startedAt + elapsedMs;
  const dailyRange = getLocalDayRange(new Date(progressNow));
  const weeklyRange = getWeekRange(
    new Date(progressNow),
    preferences?.weekStartsOn ?? 1,
  );
  const activeGoals = activeActivity === undefined
    ? []
    : goals.filter((goal) => goal.enabled && goal.activityId === activeActivity.id);

  const considerForgottenPrompt = useCallback(() => {
    const now = Date.now();
    if (!isForgottenSession(active, now)) {
      setForgottenOpen(false);
      return;
    }
    if (dismissedForgottenSessionId.current === active?.id) return;
    setForgottenOpen(true);
  }, [active]);

  useEffect(() => {
    if (activeActivity !== undefined) {
      setSelectedId(activeActivity.id);
      return;
    }

    setSelectedId((current) => {
      if (activities.some((activity) => activity.id === current)) return current;
      return pausedActivity?.id ?? activities[0]?.id ?? null;
    });
  }, [activities, activeActivity, pausedActivity]);

  useEffect(() => {
    if (undoToken === null) return undefined;
    const timeout = window.setTimeout(() => {
      setUndoToken((current) => current === undoToken ? null : current);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [undoToken]);

  useEffect(() => {
    if (active === undefined) {
      dismissedForgottenSessionId.current = null;
      setForgottenOpen(false);
      setEndEarlierOpen(false);
      return;
    }
    if (dismissedForgottenSessionId.current !== null
      && dismissedForgottenSessionId.current !== active.id) {
      dismissedForgottenSessionId.current = null;
    }
    considerForgottenPrompt();
  }, [active, considerForgottenPrompt]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') considerForgottenPrompt();
    };
    const onFocus = () => considerForgottenPrompt();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [considerForgottenPrompt]);

  const enqueueTimerCommand = (command: () => Promise<void>): Promise<void> => {
    const result = timerCommandQueue.current.then(command, command);
    timerCommandQueue.current = result.then(() => undefined, () => undefined);
    return result;
  };

  const activate = (activityId: Id): Promise<void> => enqueueTimerCommand(async () => {
    try {
      setCommandError(null);
      const current = await repository.getActiveSession();
      const at = current === undefined || current.activityId === activityId
        ? Date.now()
        : Math.max(Date.now(), current.startedAt + 1);
      const result = await timer.switchTo(activityId, at);
      setSelectedId(activityId);
      setForgottenOpen(false);
      setEndEarlierOpen(false);
      if (result.undo !== null) setUndoToken(result.undo);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  });

  const pause = (): Promise<void> => enqueueTimerCommand(async () => {
    try {
      setCommandError(null);
      const current = await repository.getActiveSession();
      if (current === undefined) return;
      await timer.pause(Math.max(Date.now(), current.startedAt + 1));
      setUndoToken(null);
      setForgottenOpen(false);
      setEndEarlierOpen(false);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  });

  const stop = (at = Date.now()): Promise<void> => enqueueTimerCommand(async () => {
    try {
      setCommandError(null);
      const current = await repository.getActiveSession();
      if (current === undefined) return;
      await timer.stop(Math.max(at, current.startedAt + 1));
      setUndoToken(null);
      setForgottenOpen(false);
      setEndEarlierOpen(false);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  });

  const undoSwitch = (): Promise<void> => enqueueTimerCommand(async () => {
    if (undoToken === null) return;
    const ownedToken = undoToken;
    try {
      setCommandError(null);
      await timer.undoSwitch(ownedToken);
      setUndoToken((current) => current === ownedToken ? null : current);
    } catch (error) {
      setCommandError(errorMessage(error));
    }
  });

  const keepGoing = () => {
    if (active !== undefined) dismissedForgottenSessionId.current = active.id;
    setForgottenOpen(false);
  };

  const openEndedEarlier = () => {
    setForgottenOpen(false);
    setEndEarlierError(null);
    setEndEarlierOpen(true);
  };

  const switchFromForgotten = () => {
    if (active !== undefined) dismissedForgottenSessionId.current = active.id;
    setForgottenOpen(false);
  };

  const confirmEndedEarlier = (endedAt: number): Promise<void> => enqueueTimerCommand(async () => {
    try {
      setEndEarlierError(null);
      setEndEarlierSaving(true);
      const current = await repository.getActiveSession();
      if (current === undefined) {
        setEndEarlierOpen(false);
        return;
      }
      await timer.stop(endedAt);
      setUndoToken(null);
      setEndEarlierOpen(false);
    } catch (error) {
      setEndEarlierError(errorMessage(error));
    } finally {
      setEndEarlierSaving(false);
    }
  });

  const forgottenMessage = activeActivity !== undefined && active !== undefined
    ? forgottenPromptMessage(activeActivity.name, active.startedAt, Date.now())
    : '';

  return (
    <section className="focus-screen" aria-labelledby="focus-heading">
      <header className="focus-status">
        <p className="focus-status__eyebrow">
          {activeActivity === undefined ? (pausedActivity === undefined ? 'Ready when you are' : 'Paused') : 'Focusing now'}
        </p>
        <h1 id="focus-heading">{activeActivity?.name ?? 'What are you doing?'}</h1>
        <output
          className="focus-status__elapsed"
          role="timer"
          aria-label="Elapsed time"
          aria-live="polite"
        >
          {formatElapsed(elapsedMs)}
        </output>
      </header>

      {activeGoals.length > 0 && (
        <section className="focus-goals" aria-label="Current activity goals">
          <ul>
            {activeGoals.map((goal) => {
              const range = goal.period === 'daily' ? dailyRange : weeklyRange;
              const minutes = Math.floor(
                (aggregateActivities(sessions, range, progressNow).byActivity[goal.activityId] ?? 0)
                  / 60_000,
              );
              const progress = calculateGoalProgress(goal, minutes);
              return (
                <li key={goal.id}>
                  <span>{goal.period === 'daily' ? 'Daily' : 'Weekly'} {goal.direction}</span>
                  <output>{describeGoalProgress(goal, progress)}</output>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="quick-activities" aria-label="Quick activities">
        {quickActivities.map((activity) => (
          <button
            className="quick-activities__button"
            type="button"
            aria-pressed={activity.id === active?.activityId}
            style={{ '--activity-color': activity.color } as React.CSSProperties}
            key={activity.id}
            onClick={() => void activate(activity.id)}
          >
            <span className="quick-activities__swatch" aria-hidden="true" />
            {activity.name}
          </button>
        ))}
      </div>

      <Dial
        activities={activities}
        selectedId={selectedId}
        isActive={active !== undefined}
        onSelect={setSelectedId}
        onActivate={(activityId) => void activate(activityId)}
        onStop={() => void stop()}
      />

      <div className="focus-actions">
        {activeActivity !== undefined && (
          <button type="button" onClick={() => void pause()}>Pause</button>
        )}
        {pausedActivity !== undefined && (
          <button type="button" onClick={() => void activate(pausedActivity.id)}>
            Resume {pausedActivity.name}
          </button>
        )}
        {undoToken !== null && (
          <button type="button" onClick={() => void undoSwitch()}>Undo switch</button>
        )}
      </div>

      {commandError !== null && <p className="focus-error" role="alert">{commandError}</p>}

      {forgottenOpen && activeActivity !== undefined && active !== undefined && !endEarlierOpen && (
        <ConfirmDialog
          title="Still going?"
          onCancel={keepGoing}
          actions={(
            <>
              <button type="button" onClick={keepGoing}>Keep going</button>
              <button type="button" onClick={openEndedEarlier}>Ended earlier</button>
              <button type="button" onClick={switchFromForgotten}>Switch activity</button>
            </>
          )}
        >
          <p>{forgottenMessage}</p>
        </ConfirmDialog>
      )}

      {endEarlierOpen && activeActivity !== undefined && active !== undefined && (
        <EndSessionDialog
          activityName={activeActivity.name}
          startedAt={active.startedAt}
          defaultEnd={Math.min(Date.now(), active.startedAt + elapsedMs)}
          maxEnd={Date.now()}
          saving={endEarlierSaving}
          error={endEarlierError}
          onCancel={() => {
            setEndEarlierOpen(false);
            setEndEarlierError(null);
          }}
          onConfirm={(endedAt) => void confirmEndedEarlier(endedAt)}
        />
      )}
    </section>
  );
}
