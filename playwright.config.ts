import { defineConfig, devices } from '@playwright/test';

const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm exec vite preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        launchOptions: { executablePath: chromeExecutable },
      },
    },
    {
      name: 'Touch Chrome 390x844',
      use: {
        browserName: 'chromium',
        launchOptions: { executablePath: chromeExecutable },
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
