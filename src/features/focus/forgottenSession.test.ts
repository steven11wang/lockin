import type { Session } from '../../domain/models';
import {
  FORGOTTEN_SESSION_THRESHOLD_MS,
  forgottenPromptMessage,
  formatStartedAgo,
  isForgottenSession,
} from './forgottenSession';

function active(startedAt: number): Session {
  return {
    id: 'session-1',
    activityId: 'activity-study',
    startedAt,
    endedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
}

describe('forgottenSession', () => {
  it('flags only long-running active sessions', () => {
    const now = 10_000_000;
    expect(isForgottenSession(undefined, now)).toBe(false);
    expect(isForgottenSession(active(now - FORGOTTEN_SESSION_THRESHOLD_MS + 1), now)).toBe(false);
    expect(isForgottenSession(active(now - FORGOTTEN_SESSION_THRESHOLD_MS), now)).toBe(true);
    expect(isForgottenSession({
      ...active(now - FORGOTTEN_SESSION_THRESHOLD_MS * 2),
      endedAt: now - 1_000,
    }, now)).toBe(false);
  });

  it('formats human durations for the recovery prompt', () => {
    expect(formatStartedAgo(45 * 60_000)).toBe('45 minutes');
    expect(formatStartedAgo(60_000)).toBe('1 minute');
    expect(formatStartedAgo(3 * 60 * 60_000)).toBe('3 hours');
    expect(formatStartedAgo(3 * 60 * 60_000 + 15 * 60_000)).toBe('3 hours 15 minutes');
  });

  it('builds the gentle recovery message', () => {
    const startedAt = 1_000;
    const now = startedAt + 4 * 60 * 60_000;
    expect(forgottenPromptMessage('Study', startedAt, now)).toBe(
      'Still Study? You started 4 hours ago.',
    );
  });
});
