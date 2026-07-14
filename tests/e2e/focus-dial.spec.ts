import { expect, test, type Page } from '@playwright/test';

const fixedNow = new Date('2026-07-13T14:00:00-04:00');
const defaultActivityNames = [
  'Study',
  'Exercise',
  'Work',
  'Social',
  'Eat',
  'Doom Scrolling',
  'Doing Nothing',
] as const;

interface PersistedSession {
  id: string;
  activityId: string;
  startedAt: number;
  endedAt: number | null;
}

interface PersistedEmotionEntry {
  emotionId: string;
  intensity: number;
  comment: string;
  activityId: string | null;
  sessionId: string | null;
}

interface PersistedState {
  sessions: PersistedSession[];
  emotionEntries: PersistedEmotionEntry[];
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Study', exact: true })).toBeVisible();
}

async function readPersistedState(page: Page): Promise<PersistedState> {
  return page.evaluate(() => new Promise<PersistedState>((resolve, reject) => {
    const openRequest = indexedDB.open('focus-dial');
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(['sessions', 'emotionEntries'], 'readonly');
      const sessionsRequest = transaction.objectStore('sessions').getAll();
      const emotionEntriesRequest = transaction.objectStore('emotionEntries').getAll();

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve({
          sessions: sessionsRequest.result as PersistedSession[],
          emotionEntries: emotionEntriesRequest.result as PersistedEmotionEntry[],
        });
      };
    };
  }));
}

async function ensureServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  if (!await page.evaluate(() => navigator.serviceWorker.controller !== null)) {
    await page.reload();
  }

  await expect.poll(
    () => page.evaluate(() => navigator.serviceWorker.controller !== null),
  ).toBe(true);
}

function maxCssDuration(value: string): number {
  return Math.max(...value.split(',').map((part) => {
    const duration = part.trim();
    return duration.endsWith('ms')
      ? Number.parseFloat(duration)
      : Number.parseFloat(duration) * 1_000;
  }));
}

test('tracks time, records emotion, and reports the week', async ({ page }) => {
  await page.clock.install({ time: fixedNow });
  await openApp(page);

  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Study', exact: true })).toBeVisible();
  await page.clock.fastForward(65_000);
  const timer = page.getByRole('timer', { name: 'Elapsed time' });
  await expect(timer).toHaveText('00:01:05');
  await expect(timer).toHaveAttribute('aria-live', 'polite');

  await page.getByRole('button', { name: 'How do you feel?' }).click();
  await page.getByRole('radio', { name: 'Focused' }).check();
  await page.getByRole('radio', { name: '4 — strong' }).check();
  await page.getByLabel('Comment').fill('The library is quiet today.');
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.getByRole('dialog', { name: 'How do you feel?' })).toBeHidden();

  const persistedBeforeReload = await readPersistedState(page);
  expect(persistedBeforeReload.sessions).toHaveLength(1);
  expect(persistedBeforeReload.sessions[0]).toMatchObject({
    activityId: 'activity-study',
    endedAt: null,
  });
  expect(persistedBeforeReload.emotionEntries).toEqual([
    expect.objectContaining({
      emotionId: 'emotion-focused',
      intensity: 4,
      comment: 'The library is quiet today.',
      activityId: 'activity-study',
      sessionId: persistedBeforeReload.sessions[0]!.id,
    }),
  ]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Study', exact: true })).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Elapsed time' })).toHaveText('00:01:05');

  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  const marker = page.getByRole('button', { name: /Focused, intensity 4/ });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(page.getByText('The library is quiet today.')).toBeVisible();
  await expect(page.getByText('Activity').locator('..')).toContainText('Study');

  await page.getByRole('button', { name: 'Week' }).click();
  await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily activity' })).toBeVisible();
  await expect(page.getByLabel('Total comparison')).toContainText('this period');
  await expect(page.locator('.week-day > p').filter({ hasText: 'Study 1m' })).toHaveCount(1);
  const chartSummaries = await page.locator('.week-day > p').allTextContents();
  expect(chartSummaries).toHaveLength(7);
  expect(chartSummaries.every((summary) => summary.includes('tracked'))).toBe(true);
  await expect(page.locator('.week-day__bar').first()).toHaveAttribute('aria-hidden', 'true');
});

test('supports keyboard-only dial selection for all seven default activities', async ({ page }) => {
  await page.clock.install({ time: fixedNow });
  await openApp(page);
  const dial = page.getByRole('listbox', { name: 'Activity dial' });
  const options = page.getByRole('option');

  await expect(options).toHaveCount(defaultActivityNames.length);
  await expect(options).toHaveText(defaultActivityNames);

  await dial.focus();
  await page.keyboard.press('Home');
  for (const [index, name] of defaultActivityNames.entries()) {
    if (index > 0) await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('option', { name })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: `Start ${name}` })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.clock.fastForward(1_000);
  }

  const persisted = await readPersistedState(page);
  const chronologicalSessions = [...persisted.sessions]
    .sort((left, right) => left.startedAt - right.startedAt);
  expect(chronologicalSessions.map((session) => session.activityId)).toEqual([
    'activity-study',
    'activity-exercise',
    'activity-work',
    'activity-social',
    'activity-eat',
    'activity-doom-scrolling',
    'activity-doing-nothing',
  ]);
  for (const [index, session] of chronologicalSessions.entries()) {
    const nextSession = chronologicalSessions[index + 1];
    expect(session.endedAt).toBe(nextSession?.startedAt ?? null);
  }
});

test('keeps the 320px layout usable with full-size quick targets and visible focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openApp(page);

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(0);
  expect(overflow.root).toBeLessThanOrEqual(0);

  const quickButtons = page.getByLabel('Quick activities').getByRole('button');
  await expect(quickButtons).toHaveCount(4);
  for (const button of await quickButtons.all()) {
    const bounds = await button.boundingBox();
    expect(bounds, 'quick activity button must have a rendered hit box').not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  }

  await page.keyboard.press('Tab');
  const focused = page.getByRole('button', { name: 'Study', exact: true });
  await expect(focused).toBeFocused();
  const focusStyle = await focused.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(focusStyle.width).toBeGreaterThanOrEqual(3);
});

test('disables nonessential motion for browser and saved app preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  const study = page.getByRole('button', { name: 'Study', exact: true });
  await study.evaluate((element) => {
    element.setAttribute(
      'style',
      'transition: transform 10s; animation: e2e-motion 10s infinite;',
    );
  });
  const browserPreference = await study.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  expect(maxCssDuration(browserPreference.animation)).toBeLessThanOrEqual(0.01);
  expect(maxCssDuration(browserPreference.transition)).toBeLessThanOrEqual(0.01);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('checkbox', { name: 'Reduce motion' }).check();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reduced-motion', 'true');
  const settingsButton = page.getByRole('button', { name: 'Settings' });
  await settingsButton.evaluate((element) => {
    element.setAttribute(
      'style',
      'transition: transform 10s; animation: e2e-motion 10s infinite;',
    );
  });
  const savedPreference = await settingsButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationDuration, transition: style.transitionDuration };
  });
  expect(maxCssDuration(savedPreference.animation)).toBeLessThanOrEqual(0.01);
  expect(maxCssDuration(savedPreference.transition)).toBeLessThanOrEqual(0.01);
});

test('uses one stable polite online status node', async ({ context, page }) => {
  await openApp(page);
  const status = page.getByRole('status');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveText('');
  await status.evaluate((element) => {
    element.setAttribute('data-e2e-identity', 'stable');
  });

  await context.setOffline(true);
  await expect(status).toHaveText('Offline — changes stay on this device');
  await expect(status).toHaveAttribute('data-e2e-identity', 'stable');

  await context.setOffline(false);
  await expect(status).toHaveText('');
  await expect(status).toHaveAttribute('data-e2e-identity', 'stable');
});

test('refreshes an open second page through BroadcastChannel without a visibility fallback or loop', async ({ context, page }) => {
  await context.addInitScript(() => {
    const state = { posts: 0, visibilityChanges: 0 };
    const globals = globalThis as typeof globalThis & {
      __focusDialChannelState: typeof state;
    };
    globals.__focusDialChannelState = state;
    const NativeBroadcastChannel = globalThis.BroadcastChannel;
    class TrackingBroadcastChannel extends NativeBroadcastChannel {
      override postMessage(message: unknown): void {
        state.posts += 1;
        super.postMessage(message);
      }
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: TrackingBroadcastChannel,
    });
    document.addEventListener('visibilitychange', () => {
      state.visibilityChanges += 1;
    });
  });

  const secondPage = await context.newPage();
  await Promise.all([openApp(page), openApp(secondPage)]);
  await page.bringToFront();
  await Promise.all([page, secondPage].map((candidate) => candidate.evaluate(() => {
    const state = (globalThis as typeof globalThis & {
      __focusDialChannelState: { posts: number; visibilityChanges: number };
    }).__focusDialChannelState;
    state.posts = 0;
    state.visibilityChanges = 0;
  })));

  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect(secondPage.getByRole('heading', { name: 'Study', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Exercise', exact: true }).click();
  await expect(secondPage.getByRole('heading', { name: 'Exercise', exact: true })).toBeVisible();
  const readChannelState = (candidate: Page) => candidate.evaluate(() => (
    (globalThis as typeof globalThis & {
      __focusDialChannelState: { posts: number; visibilityChanges: number };
    }).__focusDialChannelState
  ));
  const stateAfterRefresh = await Promise.all([page, secondPage].map(readChannelState));
  expect(stateAfterRefresh[0]!.posts).toBeGreaterThan(0);
  expect(stateAfterRefresh[1]).toEqual({ posts: 0, visibilityChanges: 0 });

  await page.waitForTimeout(200);
  expect(await Promise.all([page, secondPage].map(readChannelState))).toEqual(stateAfterRefresh);
});

test('reloads the production app offline with IndexedDB records readable', async ({ context, page }) => {
  await openApp(page);
  await ensureServiceWorkerControl(page);
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await expect.poll(async () => (await readPersistedState(page)).sessions.length).toBe(1);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Study', exact: true })).toBeVisible();
    await expect(page.getByText('Offline — changes stay on this device')).toBeVisible();
    const offlineState = await readPersistedState(page);
    expect(offlineState.sessions).toEqual([
      expect.objectContaining({ activityId: 'activity-study', endedAt: null }),
    ]);
  } finally {
    await context.setOffline(false);
  }
});
