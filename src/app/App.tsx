import { useState, type JSX } from 'react';
import { useRepositoryHealth, useRepositoryQuery } from './RepositoryContext';
import { DEFAULT_PREFERENCES } from '../domain/defaults';
import { EmotionSheet } from '../features/emotions/EmotionSheet';
import { FocusScreen } from '../features/focus/FocusScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { TodayScreen } from '../features/today/TodayScreen';
import { WeekScreen } from '../features/week/WeekScreen';
import { OfflineStatus } from './OfflineStatus';

type View = 'focus' | 'today' | 'week' | 'settings';

const destinations: ReadonlyArray<{ view: View; label: string }> = [
  { view: 'focus', label: 'Focus' },
  { view: 'today', label: 'Today' },
  { view: 'week', label: 'Week' },
  { view: 'settings', label: 'Settings' },
];

export interface AppProps {
  openEmotionSheet?: () => void;
  reloadPage?: () => void;
}

export function App({ openEmotionSheet, reloadPage }: AppProps): JSX.Element {
  const [view, setView] = useState<View>('focus');
  const [emotionSheetOpen, setEmotionSheetOpen] = useState(false);
  const repositoryHealth = useRepositoryHealth();
  const preferences = useRepositoryQuery(
    (repository) => repository.getPreferences(),
    [],
    DEFAULT_PREFERENCES,
  );

  const showEmotionSheet = () => {
    openEmotionSheet?.();
    setEmotionSheetOpen(true);
  };

  return (
    <div className="app-shell" data-reduced-motion={preferences.reducedMotion ? 'true' : 'false'}>
      <OfflineStatus />
      {repositoryHealth.status !== 'healthy' && (
        <aside className="storage-health" role="alert" aria-label="Storage status">
          <strong>
            {repositoryHealth.status === 'full'
              ? 'Browser storage is full.'
              : 'Browser storage is unavailable.'}
          </strong>
          <span>{repositoryHealth.message}</span>
          <button
            type="button"
            onClick={reloadPage ?? (() => window.location.reload())}
          >
            Reload Focus Dial
          </button>
        </aside>
      )}

      <main className={`app-content app-content--${view}`}>
        {view === 'focus' && <FocusScreen />}
        {view === 'today' && <TodayScreen />}
        {view === 'week' && <WeekScreen />}
        {view === 'settings' && <SettingsScreen />}
      </main>

      <EmotionSheet open={emotionSheetOpen} onClose={() => setEmotionSheetOpen(false)} />

      <nav className="primary-nav" aria-label="Primary">
        {destinations.map((destination) => (
          <button
            className="primary-nav__button"
            type="button"
            aria-current={view === destination.view ? 'page' : undefined}
            key={destination.view}
            onClick={() => setView(destination.view)}
          >
            {destination.label}
          </button>
        ))}
        <button
          className="primary-nav__button primary-nav__emotion"
          type="button"
          onClick={showEmotionSheet}
        >
          How do you feel?
        </button>
      </nav>
    </div>
  );
}
