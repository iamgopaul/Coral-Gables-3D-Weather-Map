# Coral Gables 3D Weather Grid — Copilot context

## Overview

Vanilla ES-module app: **ArcGIS Maps SDK for JavaScript 4.x** (`SceneView` + public **WebScene**), deformable weather **grid** over Coral Gables, **17 sampling points**, forecast/history modes, **split-screen** compare (second `SceneView` + shared camera / linked hit-test).

## Code map

- **`js/main.js`** — `init`, `initArcGIS`, visualization, split lifecycle (`initializeSplitScreen` / `teardownSplitScreen`), popups, UI wiring.
- **`js/config.js`** — Single source of truth: `ARCGIS_WEBSCENE_ID`, `ARCGIS_PORTAL_URL`, grid, scene quality, refresh intervals, API URLs/keys (keys must not be committed; use placeholders locally).
- **`js/api/weatherService.js`** — Fetches from **Open-Meteo**, **OpenWeatherMap**, **NOAA**; merges with configurable priority (NOAA-first for canonical center where used).
- **`js/features/timeFeatures.js`** — Forecast windowing, historical snapshots, `PlaybackController`.
- **`js/storage/db.js`** — IndexedDB for snapshots.

## Conventions

- Prefer **small, focused diffs**; match existing patterns (`state` object, `require([...])` inside `initArcGIS`, `CONFIG` imports).
- Split-screen: respect **`splitScreenEpoch`**, **`splitSuppressCameraSync`**, and **`splitClickHandling`** to avoid camera/popup feedback loops.
- Do not embed **live API keys** in README or instructions; reference `config.js` only.

## Run

Serve from repo root (e.g. `npx http-server -p 8000 -c-1`); open `index.html` via HTTP.
