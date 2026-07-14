# Focus Dial Time Tracker — Product Design

Date: July 13, 2026

## Summary

Focus Dial is a local-first, installable web app for tracking where time goes and how the user feels throughout the day. It is designed for phone and laptop screens, works offline, and prioritizes a fast, gadget-like interaction: tap a favorite activity to switch immediately, or use a digital dial to reach additional activities.

The first version combines live time tracking, correction of missed or inaccurate entries, daily and weekly reports, activity goals and limits, and timestamped emotion check-ins with optional comments. Data stays in the current browser. Export and import provide backup and transfer until account-based synchronization is added in a later version.

“Focus Dial” is the working product name and can be changed without affecting this design.

## Goals

- Make starting or switching an activity take one intentional action.
- Show where time went today and how patterns change across a week.
- Support minimum goals, such as study time, and maximum limits, such as doom-scrolling time.
- Let the user record an emotion and comment at any point without interrupting the active timer.
- Reveal descriptive relationships between activities, time of day, and emotions without presenting medical or causal conclusions.
- Preserve accurate timer state across page reloads, closed tabs, phone locks, and offline use.
- Keep the first version private and local while leaving a clean path to future synchronization.

## Non-goals for the first version

- Automatic detection of applications or websites.
- Account creation, cloud storage, or cross-device synchronization.
- Shared projects, teams, billing, or invoicing.
- Clinical mental-health assessment or advice.
- Native iOS, Android, or desktop applications.
- Push reminders or scheduled mood prompts.

## Initial activities

The app begins with seven editable activities:

| Activity | Initial access |
| --- | --- |
| Study | Quick button |
| Exercise | Quick button |
| Work | Quick button |
| Social | Quick button |
| Eat | Dial |
| Doom Scrolling | Dial |
| Doing Nothing | Dial |

The user can rename, recolor, reorder, add, or archive activities. Exactly four active activities may be assigned to quick buttons at a time; all active activities remain available through the dial.

## Information architecture

The primary navigation has four destinations:

1. **Focus** — active timer, quick buttons, digital dial, and emotion check-in.
2. **Today** — editable chronological timeline, untracked gaps, activity totals, and emotion markers.
3. **Week** — activity patterns, goals and limits, mood summaries, and descriptive associations.
4. **Settings** — activities, quick-button order, goals, data export/import, and display preferences.

On phones, these destinations use a bottom navigation bar. On wider screens, they use a compact left rail while keeping the same labels and order.

## Focus experience

### Timer display

The Focus screen opens by default. It gives visual priority to the current activity name and elapsed time. When nothing is running, the center reads “What are you doing?” and invites the user to choose an activity.

The elapsed time is derived from the stored start timestamp rather than from accumulated browser ticks. This keeps the display correct after a reload, suspended tab, phone lock, clock update, or temporary loss of power.

### Quick buttons

Tapping one of the four quick buttons starts that activity immediately. If another activity is already running, the app closes the previous session at the same timestamp and starts the new session. The two sessions do not overlap or leave an artificial gap.

After a switch, a short-lived Undo action restores the prior state. Repeated tapping of the currently active activity does not create duplicate sessions.

### Digital dial

The dial provides access to every active activity, including those already assigned to quick buttons. It supports:

- Dragging or swiping on touch screens.
- Pointer dragging or mouse-wheel selection on laptops.
- Arrow-key selection and Enter/Space activation for keyboard users.
- A central press or button to start the selected activity.

The selected label is always shown as text; color is supportive and never the only identifier.

### Pause and stop

Pause ends the active session and remembers the paused activity as the suggested next choice. Stop ends the session and clears that suggestion. Pausing and stopping produce the same valid session record; the distinction affects only the next-screen affordance.

### Emotion check-in

A persistent “How do you feel?” action is available on the Focus screen and in global navigation. It never appears as a forced prompt.

An emotion check-in contains:

- One emotion selected from a customizable list.
- Intensity from 1 to 5.
- An optional free-text comment.
- An automatically captured timestamp.
- The active activity and session, when one exists.

Initial emotions are Happy, Calm, Focused, Energized, Tired, Anxious, Frustrated, and Sad. The user may add, rename, recolor, or archive emotion labels. Saving a check-in does not pause or switch the timer.

## Today experience

### Timeline

The Today screen presents sessions in chronological order. Each row shows its activity, start time, end time, and duration. Emotion check-ins appear as timestamped markers between or within sessions; selecting a marker reveals its intensity and comment.

Untracked periods between the first and last recorded event are shown as gaps. Selecting a gap opens a compact form with activity, start time, and end time prefilled to the gap boundaries.

### Editing rules

The user can add, edit, or delete completed sessions and emotion check-ins. An edit cannot create a negative duration or overlap another session. When an intended edit conflicts with a neighboring session, the app explains the conflict and offers explicit choices to shorten the edited session or trim the neighboring session. It never changes neighboring data silently.

Deleting a session or emotion check-in offers a temporary Undo action. Editing an active session changes its start time but cannot set that time in the future.

### Daily summary

The daily summary shows total tracked time, time by activity, untracked time within the visible day span, goal progress, and the sequence and frequency of emotion check-ins. It does not invent a single “mood score.” Intensity is summarized within each emotion rather than averaged across unlike emotions.

## Week experience

### Activity analysis

The default week runs Monday through Sunday using the device’s local timezone; the user may change the starting day in Settings. It includes:

- Stacked daily bars showing time by activity.
- Total and daily-average time for each activity.
- Change from the previous complete or equivalent partial week.
- Goal and limit progress.
- The user’s most-tracked activity and the time-of-day distribution for each activity, such as when Study or Doom Scrolling occurs most often.

Sessions that cross midnight are split for reporting without changing the original stored record. Day and week calculations use calendar boundaries rather than fixed 24-hour assumptions, so daylight-saving transitions remain accurate.

### Goals and limits

A goal targets one activity, uses either a daily or weekly period, and has one of two directions:

- **Minimum** — reach at least a target duration.
- **Maximum** — stay at or below a target duration.

Progress appears subtly on Focus and in detail on Week. Language remains factual and nonjudgmental, for example “42 minutes over this week’s limit.” Goals do not block tracking.

### Emotion analysis

Weekly emotion reporting includes:

- Check-in count by emotion and day.
- Intensity distribution within each emotion.
- A chronological mood strip that preserves the order of check-ins.
- Emotion frequency by associated activity.
- Emotion frequency by broad local-time band: morning (5:00–11:59), afternoon (12:00–16:59), evening (17:00–21:59), and night (22:00–4:59).

The app may show descriptive statements such as “Three of four check-ins during Exercise were Calm or Energized.” An activity or time-of-day association requires at least three relevant check-ins in the selected period. The app labels these as observed patterns, never causes, diagnoses, or treatment recommendations.

Comments remain private journal text. The first version shows them in the timeline and allows simple text search; it does not perform sentiment analysis or send them to an external service.

## Settings and data ownership

Settings allow the user to manage activities, emotions, quick buttons, colors, goals, week start, time format, and reduced-motion preference.

The app provides:

- A complete JSON backup for lossless export and restore.
- A CSV export of sessions and a separate CSV export of emotion check-ins for personal analysis.
- Import validation with a preview of record counts and date range before any data is changed.
- A full local-data deletion action protected by an explicit confirmation.

Import is additive by default and ignores records with existing IDs. A replace-all import is a separate, clearly labeled action that creates a downloadable safety backup first.

## Technical architecture

The app is a responsive progressive web application built as a client-only single-page app. The recommended implementation uses React and TypeScript, an IndexedDB-backed repository, a service worker for offline assets, and browser-native installability through a web app manifest.

The system is divided into focused modules:

- **Timer engine** — owns start, switch, pause, stop, undo, and active-session invariants.
- **Local repository** — provides versioned storage and typed create/read/update/delete operations.
- **Timeline service** — validates edits, detects gaps, and detects overlaps.
- **Aggregation service** — derives daily and weekly activity totals and goal progress.
- **Emotion insight service** — computes counts, within-emotion intensity summaries, and minimum-sample descriptive associations.
- **Import/export service** — validates backups and produces JSON and CSV files.
- **Presentation layer** — Focus, Today, Week, and Settings screens that consume the services through stable interfaces.

No summary total is treated as authoritative stored data; summaries are derived from raw sessions, check-ins, goals, and calendar boundaries. This prevents stale analytics after edits.

## Data model

### Activity

- `id`: stable unique identifier
- `name`: display name
- `color`: accessible display color
- `icon`: optional icon key
- `sortOrder`: dial order
- `quickSlot`: 1–4 or null
- `archivedAt`: timestamp or null

### Session

- `id`: stable unique identifier
- `activityId`: related activity
- `startedAt`: absolute timestamp
- `endedAt`: absolute timestamp or null for the one active session
- `createdAt`: absolute timestamp
- `updatedAt`: absolute timestamp

### Emotion

- `id`: stable unique identifier
- `name`: display label
- `color`: accessible display color
- `sortOrder`: picker order
- `archivedAt`: timestamp or null

### EmotionEntry

- `id`: stable unique identifier
- `emotionId`: related emotion
- `intensity`: integer from 1 through 5
- `comment`: optional text
- `recordedAt`: absolute timestamp
- `activityId`: activity active at that moment, or null
- `sessionId`: associated session, or null
- `createdAt`: absolute timestamp
- `updatedAt`: absolute timestamp

### Goal

- `id`: stable unique identifier
- `activityId`: related activity
- `period`: daily or weekly
- `direction`: minimum or maximum
- `targetMinutes`: positive integer
- `enabled`: boolean

### Preferences

- Schema version
- Week-start day
- 12- or 24-hour time display
- Reduced-motion choice
- Last paused activity identifier

All records use stable client-generated IDs and update timestamps so a future synchronization layer can reconcile them without replacing the local domain model.

## State invariants and error handling

- At most one session may have a null `endedAt` value.
- Completed sessions must have an end later than their start and may not overlap.
- Timer switching uses one transaction so ending one session and starting another succeed or fail together.
- Invalid edits remain in the form with a clear, specific message; unsaved input is not discarded.
- If browser storage is unavailable or full, the app stops accepting new records, preserves current in-memory form input, and explains how to export or free space.
- A failed import changes no stored records.
- A corrupt or newer-version backup is rejected with a readable explanation.
- The app displays dates in the current local timezone while storing absolute timestamps.

## Accessibility and responsive behavior

- Core tracking works with touch, mouse, and keyboard.
- Tap targets are at least 44 by 44 CSS pixels.
- Visible focus states and semantic labels are provided for all controls.
- Charts have text summaries and never rely only on color.
- Motion is subtle and disabled when reduced motion is requested.
- The phone layout supports a 320-pixel-wide viewport without horizontal scrolling.
- The desktop layout stays focused rather than stretching content across the full window.

## Testing strategy

### Unit tests

- Timer start, repeated selection, switch, pause, stop, and undo.
- One-active-session and no-overlap invariants.
- Timeline gap and conflict detection.
- Daily and weekly aggregation across midnight, month/year boundaries, timezone changes, and daylight-saving transitions.
- Minimum and maximum goal calculations.
- Emotion counts, within-emotion intensity summaries, activity associations, and minimum sample thresholds.
- Import schema validation, duplicate handling, and lossless JSON round trips.

### Integration tests

- Persistence and recovery after reload or simulated tab suspension.
- Session and emotion create/edit/delete flows with Undo.
- Additive and replace-all import behavior.
- Offline application startup after the first successful load.

### End-to-end and visual tests

- Focus-to-Today-to-Week journeys on phone and desktop viewport sizes.
- Touch dial, pointer dial, and keyboard dial behavior.
- Timer accuracy after closing and reopening the app.
- Accessible names, focus order, contrast, reduced motion, and chart summaries.

## Acceptance criteria for the first version

The first version is ready when the user can:

1. Install or open the app on a phone or laptop and use it offline after the first load.
2. Start or switch among the four quick activities with one tap.
3. Select and start any other activity through the digital dial.
4. Pause or stop tracking without losing the completed session.
5. Close and reopen the app while a timer is running and see the correct elapsed time.
6. Add, edit, delete, and restore sessions while preventing invalid overlaps.
7. Record an emotion, intensity, and optional comment at any time without interrupting the timer.
8. Review daily timelines, gaps, totals, and emotion markers.
9. Review weekly activity patterns, goal or limit progress, and appropriately qualified emotion patterns.
10. Customize activities, emotions, quick buttons, and goals.
11. Export and restore a complete JSON backup and export analysis-ready CSV files.

## Future synchronization boundary

Cloud synchronization is intentionally deferred. A later version may add authentication and a remote replica of the same records. The local repository remains the source used by the user interface, while a separate synchronization service exchanges records by stable ID and update timestamp. Conflict policy and account recovery will receive their own design before implementation.
