# The Coral Gables Weather Radar

3D **ArcGIS Maps SDK for JavaScript** app for Coral Gables, FL: live conditions, wind field arrows, forecasts, historical playback, split-screen comparison, and NWS alert toasts. The UI is responsive for desktop and mobile (bottom-sheet menu on narrow viewports).

## Features

- **Multi-source weather merge** — Open‑Meteo, OpenWeatherMap (optional), and NOAA/NWS (Weather.gov) merged per-field.
- **Wind vectors** — directional arrows at each sampling point, area-mean wind at the city marker, and popups with speed and compass direction.
- **3D temperature surface** — relief-style mesh driven by the station field (interpolated between stations); grid looks include **Gulf Glass** (translucent), Basic Grid, and Tidefield Membrane.
- **Modes** — current, forecast, historical playback, and **split-screen compare** (linked popups and wind selection across panes).
- **Alerts & notices** — NWS alert feed toasts + themed welcome and microclimate notices (auto-dismiss timing configurable).
- **Local history** — IndexedDB snapshots for playback.
- **Sampling points** — popups include human-readable Coral Gables area labels and coordinates.

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
│   ├── main.js             # App glue: state, scene, UI wiring
│   ├── config.js           # Grid, APIs, scene, refresh intervals
│   ├── samplingPoints.js
│   ├── features/timeFeatures.js   # Forecast helpers, playback controller
│   ├── api/
│   │   ├── weatherService.js     # Merge + fetch orchestration
│   │   ├── openmeteo.js
│   │   ├── openweathermap.js
│   │   └── noaa.js
│   ├── storage/db.js
│   ├── ui/
│   │   └── dataStatus.js         # Data / API sources / stations display
│   ├── viz/
│   │   └── wind.js               # Wind arrows + area-mean indicator
│   └── utils/
│       ├── interpolation.js
│       ├── gridGenerator.js
│       └── tempColors.js
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

- **`npm run build`** — output in `dist/` for static hosting (e.g. Vercel, GitHub Pages). Keys from `.env` are **inlined into the JS bundle** at build time, so anyone can read them from the deployed files. For truly private keys, use a small backend proxy instead of client-only env.

### Optional: plain `http-server`

Without Vite, `import.meta.env` is unset and **API keys in config stay empty** (Open-Meteo + NOAA still work).

```bash
npx http-server -p 8000 -c-1 -a 127.0.0.1
```

If you bind to all interfaces, scanners may probe the port; paths like `${jndi:…}` or `POST /onvif/device_service` are **not from this app** — automated probes against open ports.

## Configuration

- **Secrets** — Root **`.env`** or **`.env.local`** (copy from **`.env.example`**). Vite only exposes variables prefixed with `VITE_`.
  - `VITE_OPENWEATHERMAP_API_KEY` (optional)
  - `VITE_ARCGIS_API_KEY` (optional)
  - `VITE_NWS_CONTACT_EMAIL` (recommended; appended to NWS User‑Agent)
- **`js/config.js`** — WebScene / portal URLs, grid extent, refresh intervals, and all non-secret settings.

## Usage highlights

- **View mode** (control panel): Current, forecasts, Historical, **Split-Screen Compare**.
- **Split-screen**: Choose left/right data sources; both panes stay camera-linked; grid, point, and wind clicks can show linked popups.
- **Debug console**: Press **`D`** to toggle the in-app log.

## Roadmap / potential future updates

Planned or under consideration (not commitments):

- **Data accuracy** — Tighter station metadata, additional validation layers, calibration against ground truth, and clearer uncertainty or confidence in merged fields where APIs disagree.
- **Graph visualizations** — Charts and time-series views (e.g. temperature and wind trends, forecast strips, historical comparison) beyond the 3D scene and legend.
- **Carbon sequestration** — Contextual environmental layers or estimates (e.g. urban green space, rough CO₂ or biomass proxies) to sit alongside weather for sustainability and education; would require vetted datasets and clear methodology in the UI.

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

Provided as-is for demonstration. Weather sources are credited in the app UI and provider modules. WebScene attribution follows the ArcGIS portal item used in `js/config.js`.
