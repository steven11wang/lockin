# Focus Dial

Focus Dial is a private, local-first time tracker for starting and switching activities, correcting a daily timeline, reviewing weekly patterns and goals, and recording optional emotion check-ins. It is an installable web app designed for phones and laptops.

## Run it locally

You need Node.js 20.19+ or 22.12+, with npm and Google Chrome or Chromium.

```sh
npm install
npm run dev
```

Open the local address printed by the development server.

Use these checks before sharing a change:

```sh
npm run check
npm run test:e2e
```

`npm run check` runs the automated tests and creates a production build. `npm run test:e2e` builds and previews that production app, then tests it in clean browser contexts at desktop and touch sizes.

The Playwright configuration uses the system copy of Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` for both projects; it does not use Playwright's bundled browser. Install Chrome at that location on macOS, or change `chromeExecutable` in `playwright.config.ts` to the executable path for your Chrome or Chromium installation.

## Install and use offline

Installation and offline use should be tried with a production build, not the development server:

```sh
npm run build
npm exec vite preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173` in Chrome, then use Chrome's install icon or **Install Focus Dial** menu action. After one successful production load, the app shell is cached so the installed app and browser page can reopen offline. An offline message confirms that changes still stay on the device.

Focus Dial has no account or cloud sync. Activities, sessions, goals, preferences, and emotion check-ins are stored in IndexedDB for the current browser profile on the current device. Another browser, profile, or device will not see that data. Clearing browser storage can erase it, so keep JSON backups.

Focus Dial always keeps exactly four active quick slots. In **Settings**, assigning an unassigned activity to an occupied slot replaces that slot's owner; moving an already assigned activity to an occupied slot swaps the two owners. Assign another active activity to a quick slot before archiving its current owner.

If browser storage becomes full or unavailable, a global **Storage status** alert appears and Focus Dial stops accepting changes so a failed save is never presented as successful. If existing data can still be read, open **Settings** → **Your data** and download a JSON backup. If storage is full, free browser or device space; if storage is unavailable, restore browser storage access. Then use **Reload Focus Dial** (or reload the page) before continuing.

## Back up, restore, export, or reset

Open **Settings**, then **Your data**.

- **Download JSON backup** saves a complete, lossless copy of the app data.
- Choose a backup file to see an **Import preview** with record counts, date range, and existing IDs before any import action is enabled.
- **Add new records** is the normal, additive restore: existing IDs are skipped and current records are kept.
- **Replace all data** is a separate destructive restore. Focus Dial first downloads a JSON safety backup of the current data, then replaces it in one operation. Invalid or unsupported backups are rejected without changing local data.
- **Download session CSV** and **Download emotion CSV** create separate analysis-ready exports.
- **Delete local data** requires typing `DELETE`. It removes local records and restores the starter activities, emotions, and preferences. It cannot be undone without a backup.

Emotion insights describe patterns in recorded check-ins only. They do not establish causes and are not a diagnosis, treatment recommendation, or other medical advice.
