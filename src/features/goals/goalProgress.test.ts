import type { Goal } from '../../domain/models';
import {
  calculateGoalProgress,
  describeGoal,
} from './goalProgress';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-study',
    activityId: 'activity-study',
    period: 'daily',
    direction: 'minimum',
    targetMinutes: 120,
    enabled: true,
    ...overrides,
  };
}

describe('goal progress', () => {
  it('reports remaining minutes for a daily minimum goal', () => {
    const progress = calculateGoalProgress(makeGoal(), 90);

    expect(progress).toEqual({
      minutes: 90,
      targetMinutes: 120,
      ratio: 0.75,
      status: 'under',
      deltaMinutes: -30,
    });
    expect(describeGoal(progress)).toBe('30 minutes remaining');
  });

  it('treats exceeding a minimum as met rather than over a limit', () => {
    const progress = calculateGoalProgress(makeGoal(), 150);

    expect(progress).toMatchObject({ status: 'met', deltaMinutes: 30, ratio: 1.25 });
    expect(describeGoal(progress)).toBe('Goal met');
  });

  it('reports excess minutes factually for a weekly maximum goal', () => {
    const progress = calculateGoalProgress(makeGoal({
      period: 'weekly',
      direction: 'maximum',
      targetMinutes: 60,
    }), 102);

    expect(progress).toMatchObject({ status: 'over', deltaMinutes: 42, ratio: 1.7 });
    expect(describeGoal(progress)).toBe('42 minutes over this period’s limit');
  });

  it('treats staying at or below a maximum as met', () => {
    const maximum = makeGoal({ direction: 'maximum', targetMinutes: 60 });

    expect(calculateGoalProgress(maximum, 45)).toMatchObject({
      status: 'met',
      deltaMinutes: -15,
    });
    expect(calculateGoalProgress(maximum, 60)).toMatchObject({
      status: 'met',
      deltaMinutes: 0,
    });
  });

  it('requires a positive target in minutes', () => {
    expect(() => calculateGoalProgress(makeGoal({ targetMinutes: 0 }), 10))
      .toThrow('Goal target minutes must be positive');
    expect(() => calculateGoalProgress(makeGoal({ targetMinutes: -10 }), 10))
      .toThrow('Goal target minutes must be positive');
  });
});
