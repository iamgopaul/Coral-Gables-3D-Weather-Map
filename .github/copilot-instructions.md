# Coral Gables 3D Weather Grid — Copilot context

## Overview

Vanilla ES-module app: **ArcGIS Maps SDK for JavaScript 4.x** (`SceneView` + public **WebScene**), deformable weather **grid** over Coral Gables, **17 sampling points**, forecast/history modes, **split-screen** compare (second `SceneView` + shared camera / linked hit-test).

## Code map

- **`js/main.js`** — `init`, `initArcGIS`, visualization, split lifecycle (`initializeSplitScreen` / `teardownSplitScreen`), popups, UI wiring.
- **`js/config.js`** — Scene/grid/API URLs; **secrets** come from root **`.env`** (`VITE_*` vars) via Vite (see `.env.example`).
- **`js/api/weatherService.js`** — Fetches from **Open-Meteo**, **OpenWeatherMap**, **NOAA**; merges with configurable priority (NOAA-first for canonical center where used).
- **`js/features/timeFeatures.js`** — Forecast windowing, historical snapshots, `PlaybackController`.
- **`js/storage/db.js`** — IndexedDB for snapshots.

## Conventions

- Prefer **small, focused diffs**; match existing patterns (`state` object, `require([...])` inside `initArcGIS`, `CONFIG` imports).
- Split-screen: respect **`splitScreenEpoch`**, **`splitSuppressCameraSync`**, and **`splitClickHandling`** to avoid camera/popup feedback loops.
- Do not embed **live API keys** in README, Copilot instructions, or committed files; use **`.env`** (gitignored).

## Run

**`./run.sh`** — `npm install`, `.env` bootstrap if missing, **`npm run build`**, **`npm run preview`** (production build on port 8000). For HMR dev: **`npm run dev`**. Optional: `npx http-server` without Vite leaves keys empty.
