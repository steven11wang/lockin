import type { JSX } from 'react';

export interface ErrorBannerProps {
  errors: readonly string[];
  onDismiss: () => void;
}

export function ErrorBanner({ errors, onDismiss }: ErrorBannerProps): JSX.Element | null {
  if (errors.length === 0) return null;
  return (
    <div className="error-banner" role="alert">
      {errors.length === 1
        ? <p>{errors[0]}</p>
        : <ul>{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>}
      <button type="button" onClick={onDismiss}>Dismiss error</button>
    </div>
  );
}
