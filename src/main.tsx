import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { RepositoryProvider } from './app/RepositoryContext';
import { createDexieRepository } from './storage/dexieRepository';
import './app/app.css';

const repository = createDexieRepository();
const handlePageHide = (event: PageTransitionEvent) => {
  if (event.persisted) return;
  repository.dispose();
  window.removeEventListener('pagehide', handlePageHide);
};
window.addEventListener('pagehide', handlePageHide);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RepositoryProvider repository={repository}>
      <App />
    </RepositoryProvider>
  </StrictMode>,
);
