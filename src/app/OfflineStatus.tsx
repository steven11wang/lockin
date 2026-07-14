import { useEffect, useState, type JSX } from 'react';

export function OfflineStatus(): JSX.Element {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const updateStatus = () => setOffline(!navigator.onLine);

    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);

    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  return (
    <div role="status" aria-live="polite">
      {offline ? 'Offline — changes stay on this device' : null}
    </div>
  );
}
