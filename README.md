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
- Vanilla **ES modules** (`js/main.js`).
- **IndexedDB** (`js/storage/db.js`).

## Project layout

```
coral-gables-weather-grid/
├── index.html              # Entry (serve over HTTP, not file://)
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

```bash
npx http-server -p 8000 -c-1
```

Open `http://localhost:8000/` (or your chosen port). Use a **hard refresh** after pulling changes if assets look stale (`index.html` may append cache-bust query params on scripts/styles).

**Listen only on this machine** (fewer random LAN/internet hits in your terminal):

```bash
npx http-server -p 8000 -c-1 -a 127.0.0.1
```

If you bind to all interfaces (`0.0.0.0`, the default), scanners may probe the port; weird paths like `${jndi:…}` or `POST /onvif/device_service` are **not from this app** — they are automated exploit/camera probes against anything listening on that port. This static site does not run Log4j or ONVIF; you can ignore those lines or use `-a 127.0.0.1`.

## Configuration

Edit **`js/config.js`** for:

- WebScene / portal URLs, grid extent, refresh intervals.
- **API keys** — OpenWeatherMap key belongs in config (do not commit real keys to public repos; use a private env or local override).

Optional: `ARCGIS_API_KEY` if you add layers that require it.

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
