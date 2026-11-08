import { defineConfig } from 'vitest/config';

// FPV_BASE lets the GitHub Pages build serve the game from /lockin/fpv/.
export default defineConfig({
  base: process.env.FPV_BASE ?? './',
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
  },
});
