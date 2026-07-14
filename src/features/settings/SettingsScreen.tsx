import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { useRepository, useRepositoryQuery } from '../../app/RepositoryContext';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DEFAULT_PREFERENCES } from '../../domain/defaults';
import { normalizeRecordName } from '../../domain/validation';
import type {
  Activity,
  Emotion,
  FocusDialRepository,
  Goal,
  Id,
  Preferences,
  QuickSlot,
} from '../../domain/models';
import { DataTransferPanel } from '../dataTransfer/DataTransferPanel';
import './settings.css';

export interface GoalInput {
  id?: Id;
  activityId: Id;
  period: Goal['period'];
  direction: Goal['direction'];
  hours: number;
  minutes: number;
  enabled: boolean;
}

interface PendingReducedMotion {
  operationId: number;
  value: boolean;
  settled: boolean;
}

function generatedId(prefix: string): Id {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isQuickSlot(value: unknown): value is QuickSlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function quickSlotFromSelect(value: string): QuickSlot {
  const slot = Number(value);
  if (!isQuickSlot(slot)) throw new Error('Quick slot must be 1, 2, 3, or 4.');
  return slot;
}

export async function assignQuickSlot(
  repository: FocusDialRepository,
  activityId: Id,
  quickSlot: QuickSlot,
): Promise<void> {
  if (!isQuickSlot(quickSlot)) {
    throw new Error('Quick slot must be 1, 2, 3, or 4.');
  }
  await repository.runWrite(async () => {
    const activities = await repository.listActivities(true);
    const selected = activities.find(({ id }) => id === activityId);
    if (selected === undefined || selected.archivedAt !== null) {
      throw new Error('Choose an active activity for this quick slot.');
    }

    if (selected.quickSlot === quickSlot) return;
    const destinationOwner = activities.find((activity) => (
      activity.id !== activityId && activity.quickSlot === quickSlot
    ));
    if (destinationOwner !== undefined) {
      await repository.putActivity({
        ...destinationOwner,
        quickSlot: selected.quickSlot,
      });
    }
    await repository.putActivity({ ...selected, quickSlot });
  });
}

export async function archiveActivity(
  repository: FocusDialRepository,
  activityId: Id,
  archivedAt = Date.now(),
): Promise<void> {
  await repository.runWrite(async () => {
    const active = await repository.getActiveSession();
    if (active?.activityId === activityId) {
      throw new Error('Stop the active activity before archiving it.');
    }
    const activity = (await repository.listActivities(true)).find(({ id }) => id === activityId);
    if (activity === undefined) throw new Error('Activity not found.');
    if (activity.quickSlot !== null) {
      throw new Error(
        `Assign another activity to quick slot ${activity.quickSlot} before archiving ${activity.name}.`,
      );
    }
    await repository.putActivity({ ...activity, archivedAt });
  });
}

export async function archiveEmotion(
  repository: FocusDialRepository,
  emotionId: Id,
  archivedAt = Date.now(),
): Promise<void> {
  await repository.runWrite(async () => {
    const emotion = (await repository.listEmotions(true)).find(({ id }) => id === emotionId);
    if (emotion === undefined) throw new Error('Emotion not found.');
    await repository.putEmotion({ ...emotion, archivedAt });
  });
}

export async function saveGoal(
  repository: FocusDialRepository,
  input: GoalInput,
): Promise<Goal> {
  if (input.period !== 'daily' && input.period !== 'weekly') {
    throw new Error('Goal period must be daily or weekly.');
  }
  if (input.direction !== 'minimum' && input.direction !== 'maximum') {
    throw new Error('Goal direction must be minimum or maximum.');
  }
  const validParts = Number.isInteger(input.hours)
    && Number.isInteger(input.minutes)
    && input.hours >= 0
    && input.minutes >= 0;
  const targetMinutes = input.hours * 60 + input.minutes;
  if (!validParts || !Number.isSafeInteger(targetMinutes) || targetMinutes <= 0) {
    throw new Error('Goal target must be a positive whole number of minutes.');
  }

  const goal: Goal = {
    id: input.id ?? generatedId('goal'),
    activityId: input.activityId,
    period: input.period,
    direction: input.direction,
    targetMinutes,
    enabled: input.enabled,
  };
  await repository.runWrite(async () => {
    const activity = (await repository.listActivities()).find(({ id }) => id === input.activityId);
    if (activity === undefined) throw new Error('Choose an active activity for this goal.');
    await repository.putGoal(goal);
  });
  return goal;
}

interface ActivityEditorProps {
  activity: Activity;
  first: boolean;
  last: boolean;
  onSave: (activity: Activity, name: string, color: string) => Promise<void>;
  onMove: (activity: Activity, direction: -1 | 1) => Promise<void>;
  onQuickSlot: (activity: Activity, quickSlot: QuickSlot) => Promise<void>;
  onArchive: (activity: Activity) => Promise<void>;
}

function ActivityEditor({
  activity,
  first,
  last,
  onSave,
  onMove,
  onQuickSlot,
  onArchive,
}: ActivityEditorProps): JSX.Element {
  const [name, setName] = useState(activity.name);
  const [color, setColor] = useState(activity.color);

  useEffect(() => setName(activity.name), [activity.name]);
  useEffect(() => setColor(activity.color), [activity.color]);

  return (
    <article className="settings-card" aria-label={`${activity.name} activity settings`}>
      <div className="settings-card__fields">
        <label>
          Name
          <input
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label>
          Quick slot
          <select
            value={activity.quickSlot ?? ''}
            onChange={(event) => {
              void onQuickSlot(activity, quickSlotFromSelect(event.target.value));
            }}
          >
            {[1, 2, 3, 4].map((slot) => <option value={slot} key={slot}>Slot {slot}</option>)}
          </select>
        </label>
      </div>
      <div className="settings-card__actions">
        <button type="button" onClick={() => void onSave(activity, name, color)}>Save activity</button>
        <button type="button" disabled={first} onClick={() => void onMove(activity, -1)}>Move up</button>
        <button type="button" disabled={last} onClick={() => void onMove(activity, 1)}>Move down</button>
        <button className="settings-button--danger" type="button" onClick={() => void onArchive(activity)}>
          Archive activity
        </button>
      </div>
    </article>
  );
}

interface EmotionEditorProps {
  emotion: Emotion;
  first: boolean;
  last: boolean;
  onSave: (emotion: Emotion, name: string, color: string) => Promise<void>;
  onMove: (emotion: Emotion, direction: -1 | 1) => Promise<void>;
  onArchive: (emotion: Emotion) => Promise<void>;
}

function EmotionEditor({ emotion, first, last, onSave, onMove, onArchive }: EmotionEditorProps) {
  const [name, setName] = useState(emotion.name);
  const [color, setColor] = useState(emotion.color);

  useEffect(() => setName(emotion.name), [emotion.name]);
  useEffect(() => setColor(emotion.color), [emotion.color]);

  return (
    <article className="settings-card" aria-label={`${emotion.name} emotion settings`}>
      <div className="settings-card__fields">
        <label>
          Name
          <input
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
      </div>
      <div className="settings-card__actions">
        <button type="button" onClick={() => void onSave(emotion, name, color)}>Save emotion</button>
        <button type="button" disabled={first} onClick={() => void onMove(emotion, -1)}>Move up</button>
        <button type="button" disabled={last} onClick={() => void onMove(emotion, 1)}>Move down</button>
        <button className="settings-button--danger" type="button" onClick={() => void onArchive(emotion)}>
          Archive emotion
        </button>
      </div>
    </article>
  );
}

interface GoalFieldsProps {
  prefix: string;
  activities: readonly Activity[];
  activityId: Id;
  period: Goal['period'];
  direction: Goal['direction'];
  hours: string;
  minutes: string;
  enabled: boolean;
  onActivityId: (value: Id) => void;
  onPeriod: (value: Goal['period']) => void;
  onDirection: (value: Goal['direction']) => void;
  onHours: (value: string) => void;
  onMinutes: (value: string) => void;
  onEnabled: (value: boolean) => void;
}

function GoalFields(props: GoalFieldsProps): JSX.Element {
  const label = (value: string) => props.prefix === '' ? value : `${props.prefix} ${value.toLowerCase()}`;
  return (
    <div className="settings-card__fields settings-card__fields--goal">
      <label>
        {label('Activity')}
        <select value={props.activityId} onChange={(event) => props.onActivityId(event.target.value)}>
          {props.activities.map((activity) => (
            <option value={activity.id} key={activity.id}>{activity.name}</option>
          ))}
        </select>
      </label>
      <label>
        {label('Period')}
        <select
          value={props.period}
          onChange={(event) => props.onPeriod(event.target.value as Goal['period'])}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label>
        {label('Direction')}
        <select
          value={props.direction}
          onChange={(event) => props.onDirection(event.target.value as Goal['direction'])}
        >
          <option value="minimum">Minimum</option>
          <option value="maximum">Maximum</option>
        </select>
      </label>
      <label>
        {label('Hours')}
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={props.hours}
          onChange={(event) => props.onHours(event.target.value)}
        />
      </label>
      <label>
        {label('Minutes')}
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={props.minutes}
          onChange={(event) => props.onMinutes(event.target.value)}
        />
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={props.enabled}
          onChange={(event) => props.onEnabled(event.target.checked)}
        />
        {label('Enabled')}
      </label>
    </div>
  );
}

interface GoalEditorProps {
  goal: Goal;
  activities: readonly Activity[];
  activityName: string;
  onSave: (input: GoalInput) => Promise<void>;
  onDelete: (goal: Goal) => Promise<void>;
}

function GoalEditor({ goal, activities, activityName, onSave, onDelete }: GoalEditorProps) {
  const [activityId, setActivityId] = useState(goal.activityId);
  const [period, setPeriod] = useState(goal.period);
  const [direction, setDirection] = useState(goal.direction);
  const [hours, setHours] = useState(String(Math.floor(goal.targetMinutes / 60)));
  const [minutes, setMinutes] = useState(String(goal.targetMinutes % 60));
  const [enabled, setEnabled] = useState(goal.enabled);

  useEffect(() => {
    setActivityId(goal.activityId);
    setPeriod(goal.period);
    setDirection(goal.direction);
    setHours(String(Math.floor(goal.targetMinutes / 60)));
    setMinutes(String(goal.targetMinutes % 60));
    setEnabled(goal.enabled);
  }, [
    goal.id,
    goal.activityId,
    goal.period,
    goal.direction,
    goal.targetMinutes,
    goal.enabled,
  ]);

  return (
    <article
      className="settings-card"
      aria-label={`${activityName} ${goal.period} ${goal.direction} goal`}
    >
      <GoalFields
        prefix=""
        activities={activities}
        activityId={activityId}
        period={period}
        direction={direction}
        hours={hours}
        minutes={minutes}
        enabled={enabled}
        onActivityId={setActivityId}
        onPeriod={setPeriod}
        onDirection={setDirection}
        onHours={setHours}
        onMinutes={setMinutes}
        onEnabled={setEnabled}
      />
      <div className="settings-card__actions">
        <button type="button" onClick={() => void onSave({
          id: goal.id,
          activityId,
          period,
          direction,
          hours: Number(hours),
          minutes: Number(minutes),
          enabled,
        })}>Save goal</button>
        <button className="settings-button--danger" type="button" onClick={() => void onDelete(goal)}>
          Delete goal
        </button>
      </div>
    </article>
  );
}

export function SettingsScreen(): JSX.Element {
  const repository = useRepository();
  const activities = useRepositoryQuery(
    (repo) => repo.listActivities(true),
    [],
    [] as Activity[],
  );
  const emotions = useRepositoryQuery(
    (repo) => repo.listEmotions(true),
    [],
    [] as Emotion[],
  );
  const goals = useRepositoryQuery((repo) => repo.listGoals(), [], [] as Goal[]);
  const preferences = useRepositoryQuery(
    (repo) => repo.getPreferences(),
    [],
    DEFAULT_PREFERENCES,
  );
  const [error, setError] = useState<string | null>(null);
  const [newActivityName, setNewActivityName] = useState('');
  const [newActivityColor, setNewActivityColor] = useState('#5B5BD6');
  const [newEmotionName, setNewEmotionName] = useState('');
  const [newEmotionColor, setNewEmotionColor] = useState('#F2B84B');
  const [pendingReducedMotion, setPendingReducedMotion] = useState<PendingReducedMotion | null>(null);
  const reducedMotionOperationId = useRef(0);
  const [goalActivityId, setGoalActivityId] = useState('');
  const [goalPeriod, setGoalPeriod] = useState<Goal['period']>('daily');
  const [goalDirection, setGoalDirection] = useState<Goal['direction']>('minimum');
  const [goalHours, setGoalHours] = useState('');
  const [goalMinutes, setGoalMinutes] = useState('');
  const [goalEnabled, setGoalEnabled] = useState(true);

  const activeActivities = activities.filter(({ archivedAt }) => archivedAt === null);
  const archivedActivities = activities.filter(({ archivedAt }) => archivedAt !== null);
  const activeEmotions = emotions.filter(({ archivedAt }) => archivedAt === null);
  const archivedEmotions = emotions.filter(({ archivedAt }) => archivedAt !== null);
  const resolvedGoalActivityId = goalActivityId || activeActivities[0]?.id || '';
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));

  useEffect(() => {
    if (!pendingReducedMotion?.settled || pendingReducedMotion.value !== preferences.reducedMotion) {
      return;
    }
    setPendingReducedMotion((current) => (
      current?.operationId === pendingReducedMotion.operationId ? null : current
    ));
  }, [pendingReducedMotion, preferences.reducedMotion]);

  const perform = async (operation: () => Promise<void>, fallback: string): Promise<void> => {
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    }
  };

  const saveActivity = (activity: Activity, name: string, color: string) => perform(async () => {
    const normalized = normalizeRecordName(name);
    await repository.runWrite(async () => {
      const current = (await repository.listActivities(true)).find(({ id }) => id === activity.id);
      if (current === undefined) throw new Error('Activity not found.');
      await repository.putActivity({ ...current, name: normalized, color });
    });
  }, 'The activity could not be saved.');

  const moveActivity = (activity: Activity, direction: -1 | 1) => perform(async () => {
    await repository.runWrite(async () => {
      const currentActivities = await repository.listActivities();
      const index = currentActivities.findIndex(({ id }) => id === activity.id);
      const current = currentActivities[index];
      const neighbor = currentActivities[index + direction];
      if (current === undefined || neighbor === undefined) return;
      await repository.putActivity({ ...current, sortOrder: neighbor.sortOrder });
      await repository.putActivity({ ...neighbor, sortOrder: current.sortOrder });
    });
  }, 'The activity order could not be changed.');

  const addActivity = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      let name: string;
      try {
        name = normalizeRecordName(newActivityName);
      } catch {
        throw new Error('Activity name must be 1–40 characters.');
      }
      await repository.runWrite(async () => {
        const currentActivities = await repository.listActivities(true);
        const sortOrder = Math.max(0, ...currentActivities.map((activity) => activity.sortOrder)) + 1;
        await repository.putActivity({
          id: generatedId('activity'),
          name,
          color: newActivityColor,
          sortOrder,
          quickSlot: null,
          archivedAt: null,
        });
      });
      setNewActivityName('');
    }, 'The activity could not be added.');
  };

  const saveEmotion = (emotion: Emotion, name: string, color: string) => perform(async () => {
    const normalized = normalizeRecordName(name);
    await repository.runWrite(async () => {
      const current = (await repository.listEmotions(true)).find(({ id }) => id === emotion.id);
      if (current === undefined) throw new Error('Emotion not found.');
      await repository.putEmotion({ ...current, name: normalized, color });
    });
  }, 'The emotion could not be saved.');

  const moveEmotion = (emotion: Emotion, direction: -1 | 1) => perform(async () => {
    await repository.runWrite(async () => {
      const currentEmotions = await repository.listEmotions();
      const index = currentEmotions.findIndex(({ id }) => id === emotion.id);
      const current = currentEmotions[index];
      const neighbor = currentEmotions[index + direction];
      if (current === undefined || neighbor === undefined) return;
      await repository.putEmotion({ ...current, sortOrder: neighbor.sortOrder });
      await repository.putEmotion({ ...neighbor, sortOrder: current.sortOrder });
    });
  }, 'The emotion order could not be changed.');

  const addEmotion = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      let name: string;
      try {
        name = normalizeRecordName(newEmotionName);
      } catch {
        throw new Error('Emotion name must be 1–40 characters.');
      }
      await repository.runWrite(async () => {
        const currentEmotions = await repository.listEmotions(true);
        const sortOrder = Math.max(0, ...currentEmotions.map((emotion) => emotion.sortOrder)) + 1;
        await repository.putEmotion({
          id: generatedId('emotion'),
          name,
          color: newEmotionColor,
          sortOrder,
          archivedAt: null,
        });
      });
      setNewEmotionName('');
    }, 'The emotion could not be added.');
  };

  const writePreferences = async (changes: Partial<Preferences>): Promise<void> => {
    await repository.runWrite(async () => {
      const current = await repository.getPreferences();
      await repository.putPreferences({ ...current, ...changes });
    });
  };

  const savePreferences = async (changes: Partial<Preferences>): Promise<boolean> => {
    let saved = false;
    await perform(
      async () => {
        await writePreferences(changes);
        saved = true;
      },
      'Preferences could not be saved.',
    );
    return saved;
  };

  const saveReducedMotion = async (reducedMotion: boolean): Promise<void> => {
    const operationId = reducedMotionOperationId.current + 1;
    reducedMotionOperationId.current = operationId;
    setError(null);
    setPendingReducedMotion({ operationId, value: reducedMotion, settled: false });

    let failure: string | null = null;
    try {
      await writePreferences({ reducedMotion });
    } catch (caught) {
      failure = errorMessage(caught, 'Preferences could not be saved.');
    }

    if (failure === null) {
      setPendingReducedMotion((current) => (
        current?.operationId === operationId ? { ...current, settled: true } : current
      ));
      return;
    }

    if (reducedMotionOperationId.current !== operationId) return;
    setError(failure);

    let persistedValue: boolean;
    try {
      persistedValue = (await repository.getPreferences()).reducedMotion;
    } catch {
      setPendingReducedMotion((current) => (
        current?.operationId === operationId ? null : current
      ));
      return;
    }
    setPendingReducedMotion((current) => (
      current?.operationId === operationId
        ? { operationId, value: persistedValue, settled: true }
        : current
    ));
  };

  const addGoal = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      await saveGoal(repository, {
        activityId: resolvedGoalActivityId,
        period: goalPeriod,
        direction: goalDirection,
        hours: Number(goalHours),
        minutes: Number(goalMinutes),
        enabled: goalEnabled,
      });
      setGoalHours('');
      setGoalMinutes('');
    }, 'The goal could not be added.');
  };

  return (
    <section className="settings-screen" aria-labelledby="settings-heading">
      <header className="settings-header">
        <p className="settings-kicker">Make Focus Dial yours</p>
        <h1 id="settings-heading">Settings</h1>
        <p>Customize what you track, how goals work, and how time appears.</p>
      </header>

      {error !== null && <ErrorBanner errors={[error]} onDismiss={() => setError(null)} />}

      <section className="settings-section" aria-labelledby="activities-heading">
        <div>
          <p className="settings-kicker">Tracking</p>
          <h2 id="activities-heading">Activities</h2>
        </div>
        <div className="settings-list">
          {activeActivities.map((activity, index) => (
            <ActivityEditor
              activity={activity}
              first={index === 0}
              last={index === activeActivities.length - 1}
              key={activity.id}
              onSave={saveActivity}
              onMove={moveActivity}
              onQuickSlot={(item, slot) => perform(
                () => assignQuickSlot(repository, item.id, slot),
                'The quick slot could not be changed.',
              )}
              onArchive={(item) => perform(
                () => archiveActivity(repository, item.id),
                'The activity could not be archived.',
              )}
            />
          ))}
        </div>
        <form className="settings-add" onSubmit={addActivity}>
          <h3>Add activity</h3>
          <label>
            New activity name
            <input
              value={newActivityName}
              required
              onChange={(event) => setNewActivityName(event.target.value)}
            />
          </label>
          <label>
            New activity color
            <input
              type="color"
              value={newActivityColor}
              onChange={(event) => setNewActivityColor(event.target.value)}
            />
          </label>
          <button type="submit">Add activity</button>
        </form>
        {archivedActivities.length > 0 && (
          <div className="settings-archived">
            <h3>Archived activities</h3>
            <ul>{archivedActivities.map((activity) => <li key={activity.id}>{activity.name} (archived)</li>)}</ul>
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="emotions-heading">
        <div>
          <p className="settings-kicker">Check-ins</p>
          <h2 id="emotions-heading">Emotions</h2>
        </div>
        <div className="settings-list">
          {activeEmotions.map((emotion, index) => (
            <EmotionEditor
              emotion={emotion}
              first={index === 0}
              last={index === activeEmotions.length - 1}
              key={emotion.id}
              onSave={saveEmotion}
              onMove={moveEmotion}
              onArchive={(item) => perform(
                () => archiveEmotion(repository, item.id),
                'The emotion could not be archived.',
              )}
            />
          ))}
        </div>
        <form className="settings-add" onSubmit={addEmotion}>
          <h3>Add emotion</h3>
          <label>
            New emotion name
            <input
              value={newEmotionName}
              required
              onChange={(event) => setNewEmotionName(event.target.value)}
            />
          </label>
          <label>
            New emotion color
            <input
              type="color"
              value={newEmotionColor}
              onChange={(event) => setNewEmotionColor(event.target.value)}
            />
          </label>
          <button type="submit">Add emotion</button>
        </form>
        {archivedEmotions.length > 0 && (
          <div className="settings-archived">
            <h3>Archived emotions</h3>
            <ul>{archivedEmotions.map((emotion) => <li key={emotion.id}>{emotion.name} (archived)</li>)}</ul>
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="goals-settings-heading">
        <div>
          <p className="settings-kicker">Progress</p>
          <h2 id="goals-settings-heading">Goals and limits</h2>
        </div>
        <div className="settings-list">
          {goals.map((goal) => (
            <GoalEditor
              goal={goal}
              activities={activeActivities}
              activityName={activityById.get(goal.activityId)?.name ?? 'Archived activity'}
              key={goal.id}
              onSave={(input) => perform(
                async () => { await saveGoal(repository, input); },
                'The goal could not be saved.',
              )}
              onDelete={(item) => perform(
                () => repository.runWrite(() => repository.deleteGoal(item.id)),
                'The goal could not be deleted.',
              )}
            />
          ))}
        </div>
        {activeActivities.length > 0 && (
          <form className="settings-add" onSubmit={addGoal}>
            <h3>Add goal</h3>
            <GoalFields
              prefix="New goal"
              activities={activeActivities}
              activityId={resolvedGoalActivityId}
              period={goalPeriod}
              direction={goalDirection}
              hours={goalHours}
              minutes={goalMinutes}
              enabled={goalEnabled}
              onActivityId={setGoalActivityId}
              onPeriod={setGoalPeriod}
              onDirection={setGoalDirection}
              onHours={setGoalHours}
              onMinutes={setGoalMinutes}
              onEnabled={setGoalEnabled}
            />
            <button type="submit">Add goal</button>
          </form>
        )}
      </section>

      <section className="settings-section settings-preferences" aria-labelledby="preferences-heading">
        <div>
          <p className="settings-kicker">Display</p>
          <h2 id="preferences-heading">Preferences</h2>
        </div>
        <label>
          Week starts on
          <select
            value={preferences.weekStartsOn}
            onChange={(event) => void savePreferences({
              weekStartsOn: Number(event.target.value) as Preferences['weekStartsOn'],
            })}
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
            <option value={2}>Tuesday</option>
            <option value={3}>Wednesday</option>
            <option value={4}>Thursday</option>
            <option value={5}>Friday</option>
            <option value={6}>Saturday</option>
          </select>
        </label>
        <label>
          Time format
          <select
            value={preferences.hourCycle}
            onChange={(event) => void savePreferences({
              hourCycle: Number(event.target.value) as Preferences['hourCycle'],
            })}
          >
            <option value={12}>12-hour</option>
            <option value={24}>24-hour</option>
          </select>
        </label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={pendingReducedMotion?.value ?? preferences.reducedMotion}
            onChange={(event) => void saveReducedMotion(event.target.checked)}
          />
          Reduce motion
        </label>
      </section>

      <DataTransferPanel />
    </section>
  );
}
