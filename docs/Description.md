# Project description — Coral Gables Weather Grid

**The Coral Gables Weather Radar** is a browser-based **3D weather visualization** focused on **Coral Gables, Florida**. It combines a public **ArcGIS** city scene with **live and forecast weather** from multiple public APIs, a **station grid** with interpolated conditions, **wind arrows**, **historical playback** on a fixed wall-time window **from 48 hours ago through the current moment** (Open-Meteo hourly UTC backfill plus a live **now** frame when needed, with IndexedDB fallback), and **National Weather Service** alerts.

This document is a **high-level product overview** of what the project **is** and **does today**. For setup, scripts, and repo layout, see **`../README.md`**. For external services, merge rules, and trust notes, see **`API.md`**.

---

## Purpose

The app is meant to give residents, students, and curious users a **spatial** view of weather across the Coral Gables area: not just one airport reading, but a **field** of conditions derived from several stations and models, shown on a **3D map** you can explore. It is a **demonstration / education** tool, not a replacement for official warnings or professional meteorological systems.

---

## What it does today

### Map and visualization

- Renders a **3D WebScene** (Esri ArcGIS) centered on a configurable extent around Coral Gables.
- Draws a **grid** of cells colored by **temperature** (and related styling), with multiple **visual styles** (e.g. translucent “Gulf Glass,” a simpler grid, and an optional **Tidefield Membrane** look).
- Shows **sampling points** across the region; each can be inspected via popups (temperature, humidity, wind, pressure, etc., depending on mode and data availability).
- Displays **wind vectors** (arrows) at stations and an **area-mean** wind indicator for the city, with directions aligned to standard meteorological convention.

### Weather data

- Pulls **current conditions** from **NOAA/NWS (Weather.gov)**, **Open-Meteo**, and optionally **OpenWeatherMap** (if an API key is configured).
- **Merges** sources according to configurable priorities—for example, NWS is often preferred for the city center so readings track official local stations when possible.
- Supports **short-horizon forecasts** (e.g. about **3 hours** and **24 hours** ahead) by selecting the nearest forecast time step from the loaded forecast timelines; the **longest** available hourly timeline is usually used as the base (often NWS), with **pressure** and **wind gust** filled from other providers when the base timeline omits them.
- Runs **inverse-distance interpolation** between stations so each grid cell gets a smooth field for display (this is **not** a full atmospheric model).

### Time modes

- **Current** — Latest merged conditions and interpolated grid.
- **Forecast** — Same grid logic using forecast periods at the chosen offset.
- **Historical** — Builds a list of frames whose timestamps lie in **`[now − 48h, now]`** (configurable retention). **Open-Meteo** hourly series (UTC, `past_days=2`, intersected across stations) fill most of the window; **`finalizePlaybackSnapshots`** clips to the window and appends the **live grid at `now`** when the last hourly row is more than a couple of minutes old so the **right edge is truly current**. If hourly backfill fails, **IndexedDB** refresh snapshots are used (sparse), with the same clipping and **now** cap. The **slider maps to clock time** across that window, not merely frame index.
- **Split-screen** — Compare two modes side by side (e.g. current vs forecast) with linked navigation where implemented.

### Alerts and messaging

- Shows **active NWS alerts** relevant to the map location (toasts / UI integration as configured).
- Optional **welcome** and **microclimate**-style notices driven by configuration and conditions.

### Persistence

- Saves **weather snapshots** in **IndexedDB** on refresh (same retention window as playback) for pruning and **fallback** playback. **Historical** mode itself primarily uses **Open-Meteo** hourly data fetched in the browser when you open that mode (no project backend). Nothing is sent to a project-specific server by default.

### Developer experience

- Built with **Vite**, **ES modules**, **ESLint**, **Prettier**, and **Vitest**; **CI** can run lint, format check, tests, and production build. Browser debug logs can be mirrored to the **terminal** during dev/preview via a small Vite middleware.

---

## What it is not

- **Not** an official NWS or government product—though it **uses** NWS data among others.
- **Not** a certified source for aviation, marine, or emergency decisions.
- **Not** a guarantee of forecast accuracy; skill depends on the underlying APIs and on interpolation between points.
- **Not** a server-hosted archive for all users—**offline** snapshot history is **local** to each browser profile; **Historical** mode still needs network access for the primary Open-Meteo hourly load.

---

## Technology snapshot

| Area          | Choice                                       |
| ------------- | -------------------------------------------- |
| Map / 3D      | ArcGIS Maps SDK for JavaScript, WebScene     |
| App shell     | Vanilla JS (`js/main.js`), Vite              |
| Weather       | NWS API, Open-Meteo, optional OpenWeatherMap |
| Local storage | IndexedDB                                    |
| Styling       | CSS (`styles/main.css`)                      |

---

## Related documents

| File              | Contents                                     |
| ----------------- | -------------------------------------------- |
| `../README.md`    | How to run, configure `.env`, CI, layout     |
| `USER_MANUAL.md`  | End-user controls and troubleshooting        |
| `API.md`          | External APIs, endpoints, merge, trust notes |
| `DEPLOY.md`       | Static hosting checklist                     |
| `SECURITY.md`     | Client-side keys, reporting                  |
| `ARCHITECTURE.md` | Data flow and modules                        |

---

_Last updated to match the application behavior as of the current repository; features evolve with development._
