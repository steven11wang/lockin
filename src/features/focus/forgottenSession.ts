import type { Session } from '../../domain/models';

/** Active sessions longer than this are treated as possibly forgotten. */
export const FORGOTTEN_SESSION_THRESHOLD_MS = 3 * 60 * 60 * 1_000;

export function isForgottenSession(session: Session | undefined, now: number): boolean {
  if (session === undefined || session.endedAt !== null) return false;
  return now - session.startedAt >= FORGOTTEN_SESSION_THRESHOLD_MS;
}

export function formatStartedAgo(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  if (minutes === 0) {
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  const hourLabel = hours === 1 ? '1 hour' : `${hours} hours`;
  const minuteLabel = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `${hourLabel} ${minuteLabel}`;
}

export function forgottenPromptMessage(activityName: string, startedAt: number, now: number): string {
  return `Still ${activityName}? You started ${formatStartedAgo(now - startedAt)} ago.`;
}
