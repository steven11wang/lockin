import type { Goal } from '../../domain/models';

export interface GoalProgress {
  minutes: number;
  targetMinutes: number;
  ratio: number;
  status: 'under' | 'met' | 'over';
  deltaMinutes: number;
}

export function calculateGoalProgress(goal: Goal, minutes: number): GoalProgress {
  if (!Number.isFinite(goal.targetMinutes) || goal.targetMinutes <= 0) {
    throw new RangeError('Goal target minutes must be positive');
  }

  const deltaMinutes = minutes - goal.targetMinutes;
  const status = goal.direction === 'minimum'
    ? deltaMinutes < 0 ? 'under' : 'met'
    : deltaMinutes > 0 ? 'over' : 'met';

  return {
    minutes,
    targetMinutes: goal.targetMinutes,
    ratio: minutes / goal.targetMinutes,
    status,
    deltaMinutes,
  };
}

export function describeGoal(progress: GoalProgress): string {
  if (progress.status === 'met') return 'Goal met';
  if (progress.status === 'over') {
    return `${progress.deltaMinutes} minutes over this period’s limit`;
  }
  return `${Math.abs(progress.deltaMinutes)} minutes remaining`;
}

export function describeGoalProgress(goal: Goal, progress: GoalProgress): string {
  const status = goal.direction === 'maximum' && progress.status === 'met'
    ? 'Within limit'
    : describeGoal(progress);
  return `${progress.minutes} of ${progress.targetMinutes} minutes · ${status}`;
}
