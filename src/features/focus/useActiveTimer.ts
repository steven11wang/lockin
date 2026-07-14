import { useEffect, useState } from 'react';
import type { Session } from '../../domain/models';
import { useRepositoryQuery } from '../../app/RepositoryContext';

export interface ActiveTimerState {
  active: Session | undefined;
  elapsedMs: number;
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function useActiveTimer(): ActiveTimerState {
  const active = useRepositoryQuery(
    (repository) => repository.getActiveSession(),
    [],
    undefined,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (active === undefined) return undefined;

    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active?.id, active?.startedAt]);

  return {
    active,
    elapsedMs: active === undefined ? 0 : Math.max(0, now - active.startedAt),
  };
}
