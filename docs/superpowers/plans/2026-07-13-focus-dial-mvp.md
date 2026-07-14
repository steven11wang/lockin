# Focus Dial MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete local-first Focus Dial progressive web app for live time tracking, timeline correction, daily and weekly analysis, goals, timestamped emotion check-ins, customization, backup, and offline use.

**Architecture:** Build a client-only React/TypeScript application with a versioned IndexedDB repository and small domain services for timer commands, timeline validation, aggregation, emotion patterns, and data transfer. UI features consume those services through repository context rather than accessing storage directly, which keeps the timer and analytics testable and leaves a clean boundary for future synchronization.

**Tech Stack:** React, TypeScript, Vite, Dexie, Vitest, Testing Library, Playwright, and vite-plugin-pwa.

## Global Constraints

- The app is local-first and client-only; phone and laptop records remain separate in this version.
- The app works offline after its first successful load and is installable through a web app manifest.
- At most one session has `endedAt: null`; completed sessions have positive duration and never overlap.
- Absolute timestamps are stored; dates and times are displayed in the current local timezone.
- Initial quick activities are Study, Exercise, Work, and Social; initial dial activities are Eat, Doom Scrolling, and Doing Nothing.
- Initial emotions are Happy, Calm, Focused, Energized, Tired, Anxious, Frustrated, and Sad.
- Emotion logging is available anytime and is never a forced prompt.
- Emotion associations require at least three relevant check-ins and are described as patterns, never causes, diagnoses, or treatment recommendations.
- Core controls work with touch, mouse, and keyboard; tap targets are at least 44 by 44 CSS pixels.
- The layout has no horizontal scrolling at a 320-pixel viewport and honors reduced-motion preferences.
- JSON backup is lossless; CSV exports separate sessions from emotion entries.
- No account, cloud sync, automatic activity detection, scheduled mood prompt, team, billing, clinical assessment, or native wrapper is included.

## File map

### Application shell

- `package.json` — scripts and dependency manifest.
- `vite.config.ts` — React, tests, and PWA generation.
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — strict TypeScript configuration.
- `index.html` — application mount and mobile metadata.
- `src/main.tsx` — browser entry point.
- `src/app/App.tsx` — responsive navigation and screen selection.
- `src/app/RepositoryContext.tsx` — repository injection and subscribed query hook.
- `src/app/app.css` — tokens, reset, navigation, responsive layout, and accessibility styles.

### Domain and persistence

- `src/domain/models.ts` — record types and repository interface.
- `src/domain/defaults.ts` — initial activities, emotions, and preferences.
- `src/storage/database.ts` — Dexie schema and migrations.
- `src/storage/dexieRepository.ts` — browser implementation of the repository interface.
- `src/storage/memoryRepository.ts` — deterministic test implementation.

### Focus and timeline

- `src/features/focus/timerService.ts` — atomic start, switch, pause, stop, and undo behavior.
- `src/features/focus/useActiveTimer.ts` — active-session query and elapsed display updates.
- `src/features/focus/FocusScreen.tsx` — main timer experience.
- `src/features/focus/Dial.tsx` — touch, pointer, wheel, and keyboard activity selection.
- `src/features/today/timeline.ts` — day clipping, gaps, overlap validation, and edit resolution.
- `src/features/today/TodayScreen.tsx` — timeline, summaries, emotion markers, and editing UI.
- `src/features/today/SessionEditor.tsx` — add/edit session form and conflict choices.

### Emotions, goals, and weekly insights

- `src/features/emotions/EmotionSheet.tsx` — anytime emotion/intensity/comment form.
- `src/features/emotions/emotionInsights.ts` — counts, per-emotion intensity, and qualified associations.
- `src/features/goals/goalProgress.ts` — daily and weekly minimum/maximum calculations.
- `src/features/week/aggregate.ts` — calendar-safe activity aggregation.
- `src/features/week/WeekScreen.tsx` — activity bars, comparisons, goals, mood strip, and pattern copy.

### Settings, ownership, and verification

- `src/features/settings/SettingsScreen.tsx` — activities, emotions, quick slots, goals, and preferences.
- `src/features/dataTransfer/backup.ts` — versioned JSON and CSV serialization and validation.
- `src/features/dataTransfer/DataTransferPanel.tsx` — export, previewed import, replace-all safety flow, and deletion.
- `src/components/ErrorBanner.tsx` — non-destructive storage and validation feedback.
- `src/components/ConfirmDialog.tsx` — accessible destructive-action confirmation.
- `src/test/setup.ts` — DOM matchers and IndexedDB test setup.
- `src/**/*.test.ts(x)` — colocated unit and integration tests.
- `tests/e2e/focus-dial.spec.ts` — phone/desktop/offline/accessibility journey.
- `playwright.config.ts` — local Vite test server and browser projects.

---

## Phase 1 — Core tracker

### Task 1: Scaffold the tested responsive application shell

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/App.test.tsx`
- Create: `src/app/app.css`
- Create: `src/test/setup.ts`

**Interfaces:**
- Consumes: None.
- Produces: `App(): JSX.Element` and the four stable navigation labels `Focus | Today | Week | Settings`.

- [ ] **Step 1: Create the dependency and test configuration**

Create `package.json` with the scripts below, then run `npm install react react-dom dexie` and `npm install -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom fake-indexeddb vite-plugin-pwa @playwright/test` so npm records exact resolved versions in `package-lock.json`.

```json
{
  "name": "focus-dial",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "check": "npm run test && npm run build"
  }
}
```

Configure Vitest with `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, and `restoreMocks: true`. Configure strict TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noEmit`.

- [ ] **Step 2: Write the failing shell test**

```tsx
// src/app/App.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

it('opens on Focus and navigates among all four destinations', async () => {
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole('heading', { name: 'What are you doing?' })).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Today' }));
  expect(screen.getByRole('heading', { name: 'Today' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Week' }));
  expect(screen.getByRole('heading', { name: 'This week' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
```

- [ ] **Step 3: Run the test and verify the expected failure**

Run: `npm test -- src/app/App.test.tsx`

Expected: FAIL because `./App` does not exist.

- [ ] **Step 4: Implement the smallest navigable shell**

Create `App.tsx` with a typed `View` union, Focus as the initial view, a `<main>` heading for each temporary screen, and one semantic `<nav aria-label="Primary">`. Create `main.tsx` with `createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)`. Add CSS variables for the dark graphite background, lime accent, violet secondary accent, readable text, 44-pixel controls, phone bottom navigation, and a desktop left rail at `min-width: 768px`.

```tsx
type View = 'focus' | 'today' | 'week' | 'settings';
const headings: Record<View, string> = {
  focus: 'What are you doing?',
  today: 'Today',
  week: 'This week',
  settings: 'Settings',
};
```

- [ ] **Step 5: Verify the shell**

Run: `npm test -- src/app/App.test.tsx && npm run build`

Expected: one passing test and a successful production build with no TypeScript errors.

- [ ] **Step 6: Commit the shell**

```bash
git add package.json package-lock.json vite.config.ts tsconfig*.json index.html src
git commit -m "feat: scaffold Focus Dial application shell"
```

### Task 2: Add the typed domain model and versioned local repository

**Files:**
- Create: `src/domain/models.ts`
- Create: `src/domain/defaults.ts`
- Create: `src/storage/database.ts`
- Create: `src/storage/dexieRepository.ts`
- Create: `src/storage/memoryRepository.ts`
- Create: `src/storage/repository.test.ts`
- Create: `src/app/RepositoryContext.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `App` from Task 1.
- Produces: `FocusDialRepository`, `createDexieRepository(name?: string)`, `createMemoryRepository(seed?)`, `RepositoryProvider`, `useRepository()`, and `useRepositoryQuery(load, deps)`.

- [ ] **Step 1: Define the exact records and repository contract**

```ts
// src/domain/models.ts
export type Id = string;
export interface Activity { id: Id; name: string; color: string; icon?: string; sortOrder: number; quickSlot: 1|2|3|4|null; archivedAt: number|null }
export interface Session { id: Id; activityId: Id; startedAt: number; endedAt: number|null; createdAt: number; updatedAt: number }
export interface Emotion { id: Id; name: string; color: string; sortOrder: number; archivedAt: number|null }
export interface EmotionEntry { id: Id; emotionId: Id; intensity: 1|2|3|4|5; comment: string; recordedAt: number; activityId: Id|null; sessionId: Id|null; createdAt: number; updatedAt: number }
export interface Goal { id: Id; activityId: Id; period: 'daily'|'weekly'; direction: 'minimum'|'maximum'; targetMinutes: number; enabled: boolean }
export interface Preferences { schemaVersion: 1; weekStartsOn: 0|1|2|3|4|5|6; hourCycle: 12|24; reducedMotion: boolean; lastPausedActivityId: Id|null }
export interface DateRange { start: number; end: number }

export interface FocusDialRepository {
  subscribe(listener: () => void): () => void;
  runWrite<T>(operation: () => Promise<T>): Promise<T>;
  listActivities(includeArchived?: boolean): Promise<Activity[]>;
  putActivity(activity: Activity): Promise<void>;
  listSessions(range?: DateRange): Promise<Session[]>;
  getSession(id: Id): Promise<Session|undefined>;
  getActiveSession(): Promise<Session|undefined>;
  putSession(session: Session): Promise<void>;
  deleteSession(id: Id): Promise<void>;
  listEmotions(includeArchived?: boolean): Promise<Emotion[]>;
  putEmotion(emotion: Emotion): Promise<void>;
  listEmotionEntries(range?: DateRange): Promise<EmotionEntry[]>;
  putEmotionEntry(entry: EmotionEntry): Promise<void>;
  deleteEmotionEntry(id: Id): Promise<void>;
  listGoals(): Promise<Goal[]>;
  putGoal(goal: Goal): Promise<void>;
  deleteGoal(id: Id): Promise<void>;
  getPreferences(): Promise<Preferences>;
  putPreferences(preferences: Preferences): Promise<void>;
  clearAll(): Promise<void>;
}
```

- [ ] **Step 2: Write failing persistence tests**

Test both repository implementations through the same contract suite. Assert that first open seeds exactly seven activities, four unique quick slots, eight emotions, Monday week start, and no session. Add a test that a subscriber fires once after a completed `runWrite` but not midway through it.

```ts
it('seeds the approved defaults', async () => {
  const repo = factory();
  expect((await repo.listActivities()).map(a => a.name)).toEqual([
    'Study','Exercise','Work','Social','Eat','Doom Scrolling','Doing Nothing'
  ]);
  expect((await repo.listActivities()).filter(a => a.quickSlot).map(a => a.quickSlot)).toEqual([1,2,3,4]);
  expect(await repo.getPreferences()).toMatchObject({ schemaVersion: 1, weekStartsOn: 1 });
});
```

- [ ] **Step 3: Run the repository tests and verify failure**

Run: `npm test -- src/storage/repository.test.ts`

Expected: FAIL because the repositories and defaults do not exist.

- [ ] **Step 4: Implement defaults, Dexie schema, and both repositories**

Use stable IDs such as `activity-study` and `emotion-happy`. Dexie version 1 contains tables `activities`, `sessions`, `emotions`, `emotionEntries`, `goals`, and `preferences`. Index sessions by `startedAt`, `endedAt`, and `activityId`; index emotion entries by `recordedAt`, `emotionId`, and `activityId`. Seed only when the activity table is empty.

`runWrite` must wrap Dexie mutations in one read-write transaction and notify subscribers after commit. The memory repository must clone returned objects so tests cannot mutate storage by reference.

- [ ] **Step 5: Add repository injection and subscribed queries**

```tsx
export function useRepositoryQuery<T>(load: (repo: FocusDialRepository) => Promise<T>, deps: readonly unknown[], initial: T): T {
  const repo = useRepository();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    let live = true;
    const refresh = () => void load(repo).then(next => { if (live) setValue(next); });
    refresh();
    const unsubscribe = repo.subscribe(refresh);
    return () => { live = false; unsubscribe(); };
  }, [repo, ...deps]);
  return value;
}
```

Wrap `<App />` in `<RepositoryProvider repository={createDexieRepository()}>` from `main.tsx`.

- [ ] **Step 6: Verify persistence and build**

Run: `npm test -- src/storage/repository.test.ts && npm run build`

Expected: the contract suite passes for memory and IndexedDB repositories; the production build succeeds.

- [ ] **Step 7: Commit the domain and persistence layer**

```bash
git add src/domain src/storage src/app/RepositoryContext.tsx src/main.tsx
git commit -m "feat: add local Focus Dial repository"
```

### Task 3: Implement timer commands and invariants with tests

**Files:**
- Create: `src/features/focus/timerService.ts`
- Create: `src/features/focus/timerService.test.ts`
- Modify: `src/domain/models.ts`

**Interfaces:**
- Consumes: `FocusDialRepository`, `Session`, and `Preferences` from Task 2.
- Produces: `TimerService`, `SwitchResult`, and `TimerUndoToken`.

- [ ] **Step 1: Define the timer API and failing behavior tests**

```ts
export interface TimerUndoToken { createdSessionId: Id; previousSession: Session|null }
export interface SwitchResult { active: Session; undo: TimerUndoToken|null }
export class TimerService {
  constructor(private readonly repo: FocusDialRepository, private readonly makeId: () => string = () => crypto.randomUUID()) {}
  switchTo(activityId: Id, at = Date.now()): Promise<SwitchResult>;
  undoSwitch(token: TimerUndoToken): Promise<Session|null>;
  pause(at = Date.now()): Promise<Session|null>;
  stop(at = Date.now()): Promise<Session|null>;
}
```

Tests must cover: first start, repeat selection returning the existing session, atomic switch at one timestamp, undo restoring the previous active session, rejection of a future/earlier close time, pause remembering the activity, stop clearing the suggestion, and undo rejection after another session supersedes the token.

- [ ] **Step 2: Run timer tests and verify failure**

Run: `npm test -- src/features/focus/timerService.test.ts`

Expected: FAIL because `TimerService` does not exist.

- [ ] **Step 3: Implement the timer transaction rules**

Inside `repo.runWrite`, read the active session. When switching to a different activity, set its `endedAt` and `updatedAt` to `at`, then create the new session with `startedAt: at` and `endedAt: null`. When the requested activity is already active, return it with `undo: null`.

Pause and stop close the active session. Pause writes `lastPausedActivityId` to the activity ID; stop writes null. Reject `at <= active.startedAt` with `Timer time must be later than its start.` Undo may delete the created active session and reopen the prior session only if the created session is still the current active session.

- [ ] **Step 4: Verify timer behavior**

Run: `npm test -- src/features/focus/timerService.test.ts src/storage/repository.test.ts`

Expected: all timer and repository tests pass.

- [ ] **Step 5: Commit the timer service**

```bash
git add src/features/focus src/domain/models.ts
git commit -m "feat: add atomic timer commands"
```

### Task 4: Build the Focus screen, quick buttons, and accessible dial

**Files:**
- Create: `src/features/focus/useActiveTimer.ts`
- Create: `src/features/focus/Dial.tsx`
- Create: `src/features/focus/Dial.test.tsx`
- Create: `src/features/focus/FocusScreen.tsx`
- Create: `src/features/focus/FocusScreen.test.tsx`
- Create: `src/features/focus/focus.css`
- Modify: `src/app/App.tsx`
- Modify: `src/app/app.css`

**Interfaces:**
- Consumes: `TimerService`, repository hooks, `Activity`, and Focus navigation from Tasks 1–3.
- Produces: `Dial({activities, selectedId, onSelect, onActivate})`, `FocusScreen()`, and an `openEmotionSheet` callback prop reserved for Task 6.

- [ ] **Step 1: Write failing interaction tests**

Render `FocusScreen` with a memory repository and deterministic clock. Verify that Study starts with one click, Exercise switches without a gap, elapsed time derives from `startedAt`, repeated Study selection does not create a second record, Pause shows “Resume Study,” Stop clears it, and Undo restores the prior active activity.

For `Dial`, verify ArrowRight/ArrowLeft wrap, Home/End select edges, Enter activates, wheel selects one item per gesture, and every activity name remains visible to assistive technology.

- [ ] **Step 2: Run Focus tests and verify failure**

Run: `npm test -- src/features/focus/Dial.test.tsx src/features/focus/FocusScreen.test.tsx`

Expected: FAIL because Focus components do not exist.

- [ ] **Step 3: Implement the active timer hook**

`useActiveTimer` queries the active session and updates only the displayed `now` value once per second. Compute elapsed milliseconds with `Math.max(0, now - active.startedAt)`; never increment a stored duration counter.

```ts
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}
```

- [ ] **Step 4: Implement Focus and Dial**

Show the four `quickSlot` activities in fixed order. Show all unarchived activities in dial `sortOrder`. Use a single selected dial ID and a center button labeled `Start {activity}`. Pointer dragging converts the angle around the dial center into a nearest index; keyboard and wheel handlers update selection without starting until activation.

After a switch, render an Undo button for ten seconds and clear its token afterward. Keep the “How do you feel?” button visible but have its callback supplied by App so Task 6 can add the sheet without changing Focus internals.

- [ ] **Step 5: Verify Focus on unit, build, and viewport checks**

Run: `npm test -- src/features/focus && npm run build`

Expected: Focus tests pass, build succeeds, and component CSS contains no fixed width wider than `min(100%, 34rem)`.

- [ ] **Step 6: Commit the Focus experience**

```bash
git add src/features/focus src/app
git commit -m "feat: build the Focus Dial timer experience"
```

### Task 5: Add Today timeline calculations and safe editing

**Files:**
- Create: `src/features/today/timeline.ts`
- Create: `src/features/today/timeline.test.ts`
- Create: `src/features/today/SessionEditor.tsx`
- Create: `src/features/today/TodayScreen.tsx`
- Create: `src/features/today/TodayScreen.test.tsx`
- Create: `src/features/today/today.css`
- Create: `src/components/ConfirmDialog.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: repository session methods and local timestamp rules.
- Produces: `getLocalDayRange(date)`, `clipSessionToRange(session, range)`, `findTimelineGaps(sessions, range)`, `summarizeDay(sessions, range, now)`, `validateSessionCandidate(candidate, neighbors)`, `resolveConflict(...)`, and `TodayScreen()`.

```ts
export interface TimelineGap { start: number; end: number; durationMs: number }
export interface DaySummary { trackedMs: number; untrackedMs: number; byActivity: Record<Id, number> }
export type ConflictChoice = 'shorten-candidate'|'trim-neighbors';
export interface ConflictResolution { candidate: Session; neighborUpdates: Session[] }
export function resolveConflict(candidate: Session, conflicts: Session[], choice: ConflictChoice): ConflictResolution;
```

- [ ] **Step 1: Write failing timeline unit tests**

```ts
it('splits reporting at local midnight without mutating storage', () => {
  const range = { start: new Date(2026, 6, 13).getTime(), end: new Date(2026, 6, 14).getTime() };
  const session = makeSession({ startedAt: range.start - 3_600_000, endedAt: range.start + 1_800_000 });
  expect(clipSessionToRange(session, range)).toMatchObject({ startedAt: range.start, endedAt: range.start + 1_800_000 });
  expect(session.startedAt).toBe(range.start - 3_600_000);
});
```

Add cases for an active session, no gaps before the first or after the last event, internal gap detection, total tracked time, per-activity totals, untracked time inside the visible span, zero/negative duration, overlap rejection, and explicit trim-left/trim-right resolutions.

- [ ] **Step 2: Run timeline tests and verify failure**

Run: `npm test -- src/features/today/timeline.test.ts`

Expected: FAIL because timeline functions do not exist.

- [ ] **Step 3: Implement pure timeline functions**

Use `new Date(year, month, day + 1).getTime()` rather than adding 86,400,000 milliseconds. Represent validation as a discriminated union:

```ts
export type SessionValidation =
  | { ok: true }
  | { ok: false; reason: 'non-positive'|'future-start'|'overlap'; conflicts: Session[] };
```

Gap detection sorts clipped sessions by start, walks from the first recorded start to the last recorded end/current time, and emits only positive internal gaps. `summarizeDay` returns tracked milliseconds, milliseconds by activity ID, and gap milliseconds from those same clipped records so the timeline and summary cannot disagree.

- [ ] **Step 4: Write failing Today screen tests**

Verify chronological rows, tracked/per-activity/untracked summary values, a fill-gap action with prefilled times, successful manual creation, edit rejection that preserves form input, explicit neighbor trimming, deletion with Undo, and an active-session start edit that rejects a future time.

- [ ] **Step 5: Implement Today and SessionEditor**

Use native date/time controls with visible text labels. Save all related trim changes in one `runWrite`. The conflict dialog names both affected activities and offers `Cancel`, `Shorten this entry`, or `Trim neighboring entry`; no neighbor changes occur before the explicit choice.

- [ ] **Step 6: Verify the core-tracker phase**

Run: `npm test && npm run build`

Expected: all tests pass and the production build succeeds. Manual smoke check: start Study, switch to Exercise, open Today, edit the Study end, undo, and reload with Exercise still active.

- [ ] **Step 7: Commit the Today experience**

```bash
git add src/features/today src/components/ConfirmDialog.tsx src/app/App.tsx
git commit -m "feat: add editable daily timeline"
```

---

## Phase 2 — Emotions, goals, and insights

### Task 6: Add anytime emotion check-ins and Today markers

**Files:**
- Create: `src/features/emotions/EmotionSheet.tsx`
- Create: `src/features/emotions/EmotionSheet.test.tsx`
- Create: `src/features/emotions/emotions.css`
- Modify: `src/app/App.tsx`
- Modify: `src/features/focus/FocusScreen.tsx`
- Modify: `src/features/today/TodayScreen.tsx`
- Modify: `src/features/today/TodayScreen.test.tsx`

**Interfaces:**
- Consumes: emotion repository methods, current active session, and the Focus callback seam from Task 4.
- Produces: `EmotionSheet({open, onClose, recordedAt?})` and timestamped Today emotion markers.

```ts
export interface EmotionSheetProps {
  open: boolean;
  onClose: () => void;
  recordedAt?: number;
}
```

- [ ] **Step 1: Write failing emotion form tests**

Verify that the sheet opens from Focus, requires one emotion, accepts intensity 1–5 and an optional comment, automatically captures active `activityId` and `sessionId`, does not pause the timer, and can save when no timer is active. Verify Escape and Cancel close without saving and that focus returns to the invoking button.

- [ ] **Step 2: Run emotion tests and verify failure**

Run: `npm test -- src/features/emotions/EmotionSheet.test.tsx`

Expected: FAIL because `EmotionSheet` does not exist.

- [ ] **Step 3: Implement the emotion sheet**

Render emotions as native radio inputs visually styled as text-labeled choice buttons and render comment as a textarea. Use the exact intensity labels `1 — very mild`, `2 — mild`, `3 — moderate`, `4 — strong`, and `5 — very strong`. Create the entry with `recordedAt` captured when Save is pressed, not when the sheet opens. Trim comment whitespace but preserve internal newlines.

- [ ] **Step 4: Add emotion markers to Today**

Merge session boundary events and emotion entries into one sorted display sequence while retaining session rows. Marker buttons use accessible names such as `Calm, intensity 4, 2:15 PM`; selecting reveals the comment and linked activity. Show daily emotion counts and each emotion’s intensity range without combining unlike emotions into one score. Add a labeled comment-search field that filters emotion markers case-insensitively. Add edit and delete with the same temporary Undo pattern as sessions.

- [ ] **Step 5: Verify emotion integration**

Run: `npm test -- src/features/emotions src/features/today && npm run build`

Expected: tests pass; saving an emotion leaves the active timer running and places the marker at the correct timestamp.

- [ ] **Step 6: Commit emotion logging**

```bash
git add src/features/emotions src/features/focus src/features/today src/app/App.tsx
git commit -m "feat: add anytime emotion check-ins"
```

### Task 7: Implement calendar-safe activity aggregation and goal progress

**Files:**
- Create: `src/features/week/aggregate.ts`
- Create: `src/features/week/aggregate.test.ts`
- Create: `src/features/goals/goalProgress.ts`
- Create: `src/features/goals/goalProgress.test.ts`

**Interfaces:**
- Consumes: `Session`, `Activity`, `Goal`, `Preferences`, `DateRange`, and `clipSessionToRange`.
- Produces: `getWeekRange(anchor, weekStartsOn)`, `aggregateActivities(sessions, range, now)`, `activityTimeBands(sessions, range, now)`, `comparePeriods(current, previous)`, and `calculateGoalProgress(goal, minutes)`.

```ts
export type TimeBand = 'morning'|'afternoon'|'evening'|'night';
export interface ActivityAggregate {
  totalMs: number;
  byActivity: Record<Id, number>;
  byDay: Array<{ range: DateRange; byActivity: Record<Id, number> }>;
}
export interface GoalProgress {
  minutes: number;
  targetMinutes: number;
  ratio: number;
  status: 'under'|'met'|'over';
  deltaMinutes: number;
}
```

- [ ] **Step 1: Write failing aggregation tests**

Cover local midnight, active sessions clipped at `now`, a session spanning two days, month/year boundaries, a daylight-saving day, current partial-week comparison against the equivalent previous-week duration, archived activities retained in historic totals, and activity durations grouped into morning (5:00–11:59), afternoon (12:00–16:59), evening (17:00–21:59), and night (22:00–4:59).

```ts
expect(calculateGoalProgress(minimumGoal(120), 90)).toEqual({
  minutes: 90, targetMinutes: 120, ratio: 0.75, status: 'under', deltaMinutes: -30
});
expect(calculateGoalProgress(maximumGoal(60), 102)).toMatchObject({ status: 'over', deltaMinutes: 42 });
```

- [ ] **Step 2: Run aggregation tests and verify failure**

Run: `npm test -- src/features/week/aggregate.test.ts src/features/goals/goalProgress.test.ts`

Expected: FAIL because the aggregation modules do not exist.

- [ ] **Step 3: Implement calendar boundaries and totals**

Build each day and time-band boundary using the local `Date` constructor. Clip each session to every intersecting day and band, then sum `endedAt ?? now` minus `startedAt`. Return totals as minutes only at the presentation boundary; keep milliseconds during calculation to avoid cumulative rounding error.

- [ ] **Step 4: Implement factual goal copy**

```ts
export function describeGoal(progress: GoalProgress): string {
  if (progress.status === 'met') return 'Goal met';
  if (progress.status === 'over') return `${progress.deltaMinutes} minutes over this period’s limit`;
  return `${Math.abs(progress.deltaMinutes)} minutes remaining`;
}
```

- [ ] **Step 5: Verify aggregation**

Run: `npm test -- src/features/week src/features/goals`

Expected: all calendar and goal tests pass in the local test timezone.

- [ ] **Step 6: Commit aggregation and goals**

```bash
git add src/features/week src/features/goals
git commit -m "feat: calculate weekly activity and goal progress"
```

### Task 8: Add qualified emotion analysis and the Week screen

**Files:**
- Create: `src/features/emotions/emotionInsights.ts`
- Create: `src/features/emotions/emotionInsights.test.ts`
- Create: `src/features/week/WeekScreen.tsx`
- Create: `src/features/week/WeekScreen.test.tsx`
- Create: `src/features/week/week.css`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: aggregators from Task 7, emotion records from Task 2, and Today time-band definitions.
- Produces: `summarizeEmotions(entries, emotions, activities, range)`, `EmotionPattern[]`, and `WeekScreen()`.

```ts
export interface EmotionSummary {
  countsByEmotion: Record<Id, number>;
  intensitiesByEmotion: Record<Id, Array<1|2|3|4|5>>;
  chronological: EmotionEntry[];
  patterns: EmotionPattern[];
}
export function summarizeEmotions(
  entries: EmotionEntry[], emotions: Emotion[], activities: Activity[], range: DateRange
): EmotionSummary;
```

- [ ] **Step 1: Write failing emotion-insight tests**

```ts
it('requires three check-ins before describing an activity pattern', () => {
  expect(buildActivityPatterns(twoExerciseEntries, emotions, activities)).toEqual([]);
  expect(buildActivityPatterns(threeExerciseEntries, emotions, activities)[0]?.sampleSize).toBe(3);
});
```

Also test counts by emotion/day, intensity distribution within one emotion, morning/afternoon/evening/night bands, chronological mood-strip order, null activity, archived labels, and wording that contains `pattern` but none of `caused`, `diagnosis`, or `treatment`.

- [ ] **Step 2: Run insight tests and verify failure**

Run: `npm test -- src/features/emotions/emotionInsights.test.ts`

Expected: FAIL because emotion insight functions do not exist.

- [ ] **Step 3: Implement descriptive insight results**

```ts
export interface EmotionPattern {
  kind: 'activity'|'time-band';
  subject: string;
  emotionNames: string[];
  sampleSize: number;
  sentence: string;
}
```

Group intensity only within the same emotion. Do not map different emotions onto a single numeric mood score. Sort patterns by sample size descending, then subject name, and return at most five so the Week screen stays focused.

- [ ] **Step 4: Write failing Week screen tests**

Verify seven accessible daily bars with text summaries, totals and time-of-day distribution by activity, current/previous comparison, minimum and maximum goal copy, chronological mood strip, qualified pattern statements, and a clear empty state when the week has no records.

- [ ] **Step 5: Implement Week**

Use CSS grid/flex bars rather than a charting dependency. Each visual bar has an adjacent or screen-reader text summary. The screen reads current sessions and emotion entries for the selected week, recomputes from raw records, and offers previous/next week controls without allowing navigation beyond the current week.

- [ ] **Step 6: Verify the complete insight phase**

Run: `npm test && npm run build`

Expected: all tests and build pass. Manual smoke check: record three Exercise/Calm entries, then confirm the Week pattern names the sample size and uses non-causal language.

- [ ] **Step 7: Commit Week insights**

```bash
git add src/features/emotions src/features/week src/app/App.tsx
git commit -m "feat: add weekly activity and emotion insights"
```

---

## Phase 3 — Customization, data ownership, offline install, and hardening

### Task 9: Build settings for activities, emotions, goals, and preferences

**Files:**
- Create: `src/features/settings/SettingsScreen.tsx`
- Create: `src/features/settings/SettingsScreen.test.tsx`
- Create: `src/features/settings/settings.css`
- Modify: `src/app/App.tsx`
- Modify: `src/domain/models.ts`

**Interfaces:**
- Consumes: all repository record methods and `Goal` semantics.
- Produces: `SettingsScreen()` and validated mutation helpers `assignQuickSlot`, `archiveActivity`, `archiveEmotion`, and `saveGoal`.

- [ ] **Step 1: Write failing settings tests**

Verify rename/recolor/reorder activity, assign exactly one activity per quick slot, add an activity, archive without deleting history, add/rename/archive an emotion, create daily/weekly minimum/maximum goals with positive whole minutes, change week start/hour cycle/reduced motion, and reject archiving the currently active activity with a clear message.

- [ ] **Step 2: Run settings tests and verify failure**

Run: `npm test -- src/features/settings/SettingsScreen.test.tsx`

Expected: FAIL because Settings does not exist.

- [ ] **Step 3: Implement mutation helpers and forms**

When assigning a quick slot, clear that slot from its current owner and assign it to the selected activity in one `runWrite`. Archiving sets `archivedAt = Date.now()` and keeps all old session/emotion relationships readable. Activity and emotion names must contain 1–40 trimmed characters. Goal target input converts hours/minutes to a positive integer `targetMinutes`.

- [ ] **Step 4: Connect preferences to existing screens**

Use `weekStartsOn` in Week aggregation, `hourCycle` in every `Intl.DateTimeFormat`, and a root `data-reduced-motion` attribute. Quick-button and dial order update immediately through repository subscriptions.

- [ ] **Step 5: Verify settings**

Run: `npm test -- src/features/settings src/features/focus src/features/week && npm run build`

Expected: tests pass and custom settings survive repository recreation.

- [ ] **Step 6: Commit settings**

```bash
git add src/features/settings src/app/App.tsx src/domain/models.ts
git commit -m "feat: add Focus Dial customization and goals"
```

### Task 10: Implement lossless backup, CSV export, safe import, and local deletion

**Files:**
- Create: `src/features/dataTransfer/backup.ts`
- Create: `src/features/dataTransfer/backup.test.ts`
- Create: `src/features/dataTransfer/DataTransferPanel.tsx`
- Create: `src/features/dataTransfer/DataTransferPanel.test.tsx`
- Create: `src/components/ErrorBanner.tsx`
- Modify: `src/features/settings/SettingsScreen.tsx`

**Interfaces:**
- Consumes: every repository record type and `clearAll`.
- Produces: `FocusDialBackupV1`, `createBackup(repo)`, `parseBackup(text)`, `previewImport(backup, repo)`, `importBackup(mode)`, `resetToApprovedDefaults(repo)`, `sessionsToCsv`, `emotionEntriesToCsv`, and `DataTransferPanel()`.

```ts
export type ImportMode = 'additive'|'replace-all';
export interface ImportPreview { counts: Record<'activities'|'sessions'|'emotions'|'emotionEntries'|'goals', number>; start: number|null; end: number|null; duplicateIds: number }
export function createBackup(repo: FocusDialRepository): Promise<FocusDialBackupV1>;
export function parseBackup(text: string): { ok: true; backup: FocusDialBackupV1 }|{ ok: false; errors: string[] };
export function previewImport(backup: FocusDialBackupV1, repo: FocusDialRepository): Promise<ImportPreview>;
export function importBackup(backup: FocusDialBackupV1, mode: ImportMode, repo: FocusDialRepository): Promise<void>;
export function resetToApprovedDefaults(repo: FocusDialRepository): Promise<void>;
```

- [ ] **Step 1: Write failing backup tests**

Create a repository fixture containing archived records, a cross-midnight session, goals, preferences, and commented emotion entries. Assert JSON export/import is deeply equal, CSV quotes commas/newlines/double quotes, additive import skips existing IDs, replace-all restores exactly the backup, invalid ranges/intensities/references reject before mutation, and a schema version above 1 returns `Backup version is newer than this app supports.`

- [ ] **Step 2: Run backup tests and verify failure**

Run: `npm test -- src/features/dataTransfer/backup.test.ts`

Expected: FAIL because backup functions do not exist.

- [ ] **Step 3: Implement the versioned backup schema**

```ts
export interface FocusDialBackupV1 {
  kind: 'focus-dial-backup';
  version: 1;
  exportedAt: number;
  activities: Activity[];
  sessions: Session[];
  emotions: Emotion[];
  emotionEntries: EmotionEntry[];
  goals: Goal[];
  preferences: Preferences;
}
```

Parse unknown JSON with explicit type guards; collect all validation errors before returning failure. For replace-all, create and trigger a safety-backup download before calling `clearAll`, then insert the validated records in one write transaction. A failed transaction leaves original records intact. `resetToApprovedDefaults` clears all user records and then inserts the seven approved activities, eight approved emotions, and default preferences in one transaction.

- [ ] **Step 4: Implement the data-transfer UI**

Provide buttons for JSON backup, session CSV, and emotion CSV. File selection shows record counts and min/max timestamps before enabling `Add new records` or `Replace all data`. Require the user to type `DELETE` before local-data deletion, then call `resetToApprovedDefaults` so the empty app reopens with usable starter labels. Show validation/storage errors through `ErrorBanner` with `role="alert"` and preserve the selected file until dismissed.

- [ ] **Step 5: Verify ownership flows**

Run: `npm test -- src/features/dataTransfer src/features/settings && npm run build`

Expected: round-trip, import preview, destructive confirmation, and build all pass.

- [ ] **Step 6: Commit data ownership**

```bash
git add src/features/dataTransfer src/features/settings src/components
git commit -m "feat: add backup import and data export"
```

### Task 11: Make the app installable and reliably offline

**Files:**
- Modify: `vite.config.ts`
- Modify: `index.html`
- Create: `public/icons/icon-192.svg`
- Create: `public/icons/icon-512.svg`
- Create: `src/app/OfflineStatus.tsx`
- Create: `src/app/OfflineStatus.test.tsx`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: the production application and Vite configuration.
- Produces: generated manifest/service worker, install metadata, and `OfflineStatus()`.

- [ ] **Step 1: Write the failing offline-status test**

Mock `navigator.onLine` and dispatch `online`/`offline` events. Assert the app shows `Offline — changes stay on this device` only while offline and announces the transition through a polite live region.

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- src/app/OfflineStatus.test.tsx`

Expected: FAIL because `OfflineStatus` does not exist.

- [ ] **Step 3: Configure the PWA build**

Use `VitePWA({ registerType: 'autoUpdate', includeAssets: ['icons/icon-192.svg','icons/icon-512.svg'], manifest: { name: 'Focus Dial', short_name: 'Focus Dial', start_url: '/', display: 'standalone', background_color: '#17191f', theme_color: '#17191f', icons: [...] } })`. Set Workbox to precache built assets and use `navigateFallback: '/index.html'`. Add mobile theme-color and viewport metadata to `index.html`.

- [ ] **Step 4: Implement status and offline verification**

Render `OfflineStatus` in App. Run `npm run build && npm exec vite preview -- --host 127.0.0.1`, load once in a browser, switch the browser context offline, reload, and verify Focus renders and existing IndexedDB records remain readable.

- [ ] **Step 5: Run PWA checks**

Run: `npm test -- src/app/OfflineStatus.test.tsx && npm run build`

Expected: test passes; `dist/manifest.webmanifest`, a service worker, and both icons exist.

- [ ] **Step 6: Commit installability**

```bash
git add vite.config.ts index.html public src/app
git commit -m "feat: make Focus Dial installable offline"
```

### Task 12: Add end-to-end accessibility, responsive, and persistence verification

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/focus-dial.spec.ts`
- Modify: `src/app/app.css`
- Modify: feature CSS files found by the test.
- Modify: `package.json`

**Interfaces:**
- Consumes: the complete app.
- Produces: repeatable browser verification for phone, desktop, reload persistence, and offline startup.

- [ ] **Step 1: Configure Playwright and write the failing journey**

Configure `webServer.command` as `npm run build && npm exec vite preview -- --host 127.0.0.1 --port 4173`, `webServer.url` as `http://127.0.0.1:4173`, and `reuseExistingServer: true`. Add Chromium projects for `Desktop Chrome` and a 390×844 touch viewport so the same production service worker is exercised by offline tests.

The journey must:

```ts
test('tracks time, records emotion, and reports the week', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Study' }).click();
  await page.getByRole('button', { name: 'How do you feel?' }).click();
  await page.getByRole('radio', { name: 'Focused' }).check();
  await page.getByRole('radio', { name: '4 — strong' }).check();
  await page.getByLabel('Comment').fill('The library is quiet today.');
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await page.reload();
  await expect(page.getByText('Study', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('button', { name: /Focused, intensity 4/ })).toBeVisible();
});
```

Add separate checks for keyboard-only dial selection, 320-pixel no-horizontal-overflow, 44-pixel quick-button hit boxes, reduced motion, text summaries for charts, and offline reload after an initial production load.

- [ ] **Step 2: Run end-to-end tests and record concrete failures**

Run: `npm run test:e2e`

Expected: initial failures identify any remaining accessible-name, viewport, persistence, or offline defects.

- [ ] **Step 3: Fix only observed hardening defects**

For each failed assertion, update the smallest responsible component or stylesheet. Do not loosen assertions. Use `aria-live="polite"` for timer/status text, `aria-current="page"` for navigation, visible `:focus-visible` outlines, `min-height/min-width: 44px` for interactive controls, and `@media (prefers-reduced-motion: reduce)` to remove nonessential transitions.

- [ ] **Step 4: Run complete verification**

Run: `npm run check && npm run test:e2e`

Expected: all unit/integration tests pass, TypeScript and production build succeed, and both Playwright projects pass.

- [ ] **Step 5: Inspect the production diff and commit hardening**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intentional app/test changes.

```bash
git add package.json package-lock.json playwright.config.ts tests src
git commit -m "test: verify Focus Dial end to end"
```

### Task 13: Final acceptance pass and concise user documentation

**Files:**
- Create: `README.md`
- Modify: files implicated by acceptance failures only.

**Interfaces:**
- Consumes: all completed features and the approved design acceptance criteria.
- Produces: verified MVP and local run/install/backup instructions.

- [ ] **Step 1: Write the README**

Document the product purpose, `npm install`, `npm run dev`, `npm run check`, `npm run test:e2e`, browser installation steps, local-only storage limitation, JSON backup/restore, CSV exports, and the fact that emotion patterns are descriptive rather than medical guidance.

- [ ] **Step 2: Execute the acceptance checklist**

Using a clean browser profile, verify all eleven acceptance criteria from `docs/superpowers/specs/2026-07-13-focus-dial-time-tracker-design.md`. Record each as pass or fail in the implementation session notes; fix every failure with a focused test before changing production code.

- [ ] **Step 3: Run final automated verification**

Run: `npm run check && npm run test:e2e && git diff --check`

Expected: every command exits 0 with no failing tests, build errors, or whitespace errors.

- [ ] **Step 4: Commit documentation and any acceptance fixes**

```bash
git add README.md src tests
git commit -m "docs: add Focus Dial usage and verification"
```

- [ ] **Step 5: Confirm clean handoff state**

Run: `git status --short && git log --oneline -8`

Expected: empty status followed by the implementation’s recent focused commits.
