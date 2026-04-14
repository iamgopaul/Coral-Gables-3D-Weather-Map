# Coral Gables 3D Weather Grid

Interactive **ArcGIS Maps SDK for JavaScript** (3D) app: live and forecast weather over Coral Gables, Florida, shown on a deformable grid with **17 sampling points**, historical playback, **split-screen compare**, and alerts.

## Features

- **Multi-source weather** — Open-Meteo, OpenWeatherMap, and NOAA (Weather.gov) merged in `weatherService.js`; NWS-oriented merge for the city center where configured.
- **3D grid** — Temperature-driven relief and symbology; click cells or points for popups.
- **Modes** — Current, 3h / 24h forecast, historical playback, **split-screen** (two scenes, linked selection and camera sync).
- **IndexedDB** — Local snapshots for history and playback.
- **Auto-refresh** — Intervals configurable in `js/config.js`.

## Stack

- ArcGIS JS API **4.29** (public WebScene; no app login required for the bundled scene).
- Vanilla **ES modules** (`js/main.js`), dev/build via **[Vite](https://vitejs.dev/)** (loads `.env` for keys).
- **IndexedDB** (`js/storage/db.js`).

## Project layout

```
coral-gables-weather-grid/
├── run.sh                  # ./run.sh — npm install, .env bootstrap, build, preview (port 8000)
├── index.html              # Entry (serve over HTTP, not file://)
├── vite.config.js          # Dev server + production build
├── package.json
├── .env.example            # Copy → `.env` for API keys (gitignored)
├── styles/main.css
├── js/
│   ├── main.js             # Scene, UI, split-screen, visualization
│   ├── config.js           # Grid, APIs, scene, refresh intervals
│   ├── samplingPoints.js
│   ├── features/timeFeatures.js   # Forecast helpers, playback controller
│   ├── api/
│   │   ├── weatherService.js     # Merge + fetch orchestration
│   │   ├── openmeteo.js
│   │   ├── openweathermap.js
│   │   └── noaa.js
│   ├── storage/db.js
│   └── utils/
│       ├── interpolation.js
│       └── gridGenerator.js
└── README.md
```

## Run locally

The app must be served over **http** or **https** (the ArcGIS loader and modules will not work from `file://`).

### Recommended: Vite (loads `.env` secrets)

**One command** — installs dependencies, creates `.env` from the example if missing, **builds** production assets, then **serves** them (same as deploy, keys from `.env` inlined at build time):

```bash
./run.sh
```

Open **`http://localhost:8000/`** after the build finishes. Keys in `.env` are **not committed** (`.gitignore`).

For a **fast dev loop** (no production build, HMR):

```bash
npm run dev
```

Or manually:

```bash
npm install
cp .env.example .env
npm run build
npm run preview
```

- **`npm run build`** — output in `dist/` for static hosting (GitHub Pages, etc.). Keys from `.env` are **inlined into the JS bundle** at build time, so anyone can read them from the deployed files. For truly private keys, use a small backend proxy instead of client-only env.

### Optional: plain `http-server`

Without Vite, `import.meta.env` is unset and **API keys in config stay empty** (Open-Meteo + NOAA still work).

```bash
npx http-server -p 8000 -c-1 -a 127.0.0.1
```

If you bind to all interfaces, scanners may probe the port; paths like `${jndi:…}` or `POST /onvif/device_service` are **not from this app** — automated probes against open ports.

## Configuration

- **Secrets** — Root **`.env`** or **`.env.local`** (copy from **`.env.example`**): `VITE_OPENWEATHERMAP_API_KEY=your_key` (no spaces around `=`; name **must** start with `VITE_`). After changing `.env`, run **`./run.sh`** again so the production bundle picks up the new values. Vite inlines these into the built JS; `js/config.js` uses literal `import.meta.env.VITE_*` access so that inlining works.
- **`js/config.js`** — WebScene / portal URLs, grid extent, refresh intervals, and all non-secret settings.

## Usage highlights

- **View mode** (control panel): Current, forecasts, Historical, **Split-Screen Compare**.
- **Split-screen**: Choose left/right data sources; both panes stay aligned; grid/point clicks can show linked popups.
- **Debug console**: Press **`D`** to toggle the in-app log.

## Browser support

Modern Chromium / Firefox / Safari / Edge with **WebGL** and **IndexedDB**.

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| Blank or stuck 3D view | Confirm you’re on `http://localhost`, not `file://`. Check browser console and network (ArcGIS CDN + portal item). |
| Weather errors | Verify keys and endpoints in `config.js`; check console for which provider failed. |
| Split-screen fails to open | Wait until the main scene has finished loading; ensure forecast/history data exists if the chosen mode needs it. |
| Heavy scene | Lower `SCENE_QUALITY_PROFILE` or grid resolution in `config.js`. |

## License / credits

Provided as-is for demonstration. Weather sources are credited in the app UI and provider modules. WebScene attribution follows the ArcGIS portal item used in `config.js`.
