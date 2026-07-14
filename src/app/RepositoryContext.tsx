import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import type { FocusDialRepository, RepositoryHealth } from '../domain/models';

const RepositoryContext = createContext<FocusDialRepository | null>(null);

interface RepositoryProviderProps {
  repository: FocusDialRepository;
  children: ReactNode;
}

export function RepositoryProvider({ repository, children }: RepositoryProviderProps): JSX.Element {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): FocusDialRepository {
  const repository = useContext(RepositoryContext);
  if (repository === null) throw new Error('useRepository must be used within a RepositoryProvider.');
  return repository;
}

export function useRepositoryHealth(): RepositoryHealth {
  const repository = useRepository();
  const [health, setHealth] = useState(repository.getHealth);

  useEffect(() => {
    setHealth(repository.getHealth());
    return repository.subscribeHealth(() => setHealth(repository.getHealth()));
  }, [repository]);

  return health;
}

export function useRepositoryQuery<T>(
  load: (repo: FocusDialRepository) => Promise<T>,
  deps: readonly unknown[],
  initial: T,
): T {
  const repo = useRepository();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    let live = true;
    const refresh = () => void load(repo)
      .then((next) => {
        if (live) setValue(next);
      })
      .catch((error: unknown) => {
        repo.recordStorageFailure(error);
      });
    refresh();
    const unsubscribe = repo.subscribe(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [repo, ...deps]);

  return value;
}
