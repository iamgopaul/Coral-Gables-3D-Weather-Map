# APIs used by Coral Gables Weather Grid

This document describes **external services** the app calls from the browser, how **reliable** they are in practice, and **where** in the codebase each is used. It is meant for operators and developers; it is not a legal or SLA guarantee from any provider.

---

## Summary

| API / service                        | Auth                              | Primary role in this app                                                                              |
| ------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **api.weather.gov** (NWS)            | None; `User-Agent` required       | US station observations, hourly forecast, **active alerts**; often preferred for “live” US conditions |
| **Open-Meteo**                       | None (`api.open-meteo.com`)       | Global current + forecast; **hourly past window** for historical playback; **always** used when other sources fail |
| **OpenWeatherMap**                   | API key (`VITE_*`)                | Optional third source for current + 5‑day/3‑h forecast                                                |
| **ArcGIS / Esri**                    | Optional API key; public WebScene | 3D map, scene, **Maps SDK** loaded from CDN                                                           |
| **Vite dev server** (`/__debug_log`) | Local only                        | Forwards browser logs to the terminal during `npm run dev` / `preview` — not a weather API            |

All weather **requests** are issued from the **user’s browser** (client-side `fetch`). API keys in `.env` are **inlined at build time** into the JS bundle; treat keys as **public** if you ship static hosting.

---

## National Weather Service (`api.weather.gov`)

**Official U.S. government** weather API from NOAA/NWS.

### Endpoints used

| Flow                           | URL pattern                                                   | Module           |
| ------------------------------ | ------------------------------------------------------------- | ---------------- |
| Resolve lat/lon → grid + links | `GET https://api.weather.gov/points/{lat},{lon}`              | `js/api/noaa.js` |
| Observation stations list      | From `points` → `observationStations` URL                     | `js/api/noaa.js` |
| Latest observation             | `GET {station}/observations/latest`                           | `js/api/noaa.js` |
| Hourly forecast                | From `points` → `forecastHourly` URL                          | `js/api/noaa.js` |
| Active alerts                  | `GET https://api.weather.gov/alerts/active?point={lat},{lon}` | `js/api/noaa.js` |

Headers: **`User-Agent`** is set from `CONFIG.NWS_USER_AGENT` (`js/config.js`), optionally extended with **`VITE_NWS_CONTACT_EMAIL`** — NWS requests a descriptive agent and contact for heavy or automated use.

### Trust and accuracy

- **Trust**: Authoritative for **official NWS forecasts and warnings** in the U.S. Observations come from **real ASOS/AWOS-type stations** (nearest station to the point, not necessarily inside Coral Gables city limits).
- **Accuracy**: Varies by variable and location. Temperature, dewpoint, and pressure are generally strong; **wind** is parsed with **unit-aware** conversion (NWS may report km/h with a unit code that must not be mistaken for m/s — see `js/api/noaa.js` and tests).
- **Limits**: Coverage is **US-focused**. Outside CONUS behavior may differ. **Rate limits** apply; abusive traffic can be throttled.

### Where it appears in the project

- **`WeatherService.fetchCurrentWeather`** — merged with other sources (`js/api/weatherService.js`); Coral Gables center often uses **`MERGE_PRIORITY_NOAA_FIRST`** (`main.js` / prefetch).
- **`WeatherService.fetchForecast`** — hourly periods; often **wins** as the base forecast because the hourly list is long.
- **`fetchWeatherAlerts`** — alert toasts and UI (`main.js`, idle callback).
- **Forecast gaps**: Parsed NWS hourly periods do **not** always include **MSL pressure** or **wind gust**; the app **fills** those from Open‑Meteo / OpenWeatherMap by **closest timestamp** (`enrichForecastPressureFromSources`, `enrichForecastWindGustFromSources` in `weatherService.js`).

---

## Open-Meteo

**Open-Meteo** provides open global weather and forecast data (multiple models combined).

### Endpoints used

| Flow                    | Base                                                         | Module                |
| ----------------------- | ------------------------------------------------------------ | --------------------- |
| Current conditions      | `GET https://api.open-meteo.com/v1/forecast?...&current=...` | `js/api/openmeteo.js` |
| Hourly forecast (3‑day) | Same API with `hourly=...`                                   | `js/api/openmeteo.js` |
| Hourly **past** window  | Same API with `hourly=...`, **`past_days=2`**, **`forecast_days=0`**, **`timezone=UTC`** | `js/api/openmeteo.js` (`fetchHourlyPastWindow`) |

Parameters for current/forecast include **`temperature_unit=fahrenheit`**, **`wind_speed_unit=mph`**, **`timezone=auto`**. Forecast hourly series is **subsampled every 3 hours** in the parser when building the `forecasts` array (fewer periods than full hourly).

The **historical playback** path uses **`timezone=UTC`** so every sampling point shares identical `hourly.time` keys; `weatherService.fetchBatchHistoricalHourly` requests one such series per station, then `timeFeatures.buildSnapshotsFromHistoricalHourly` intersects timestamps and trims to the configured retention window (see `README.md` → _Historical playback_).

### Trust and accuracy

- **Trust**: Reputable **open** service with documented models; **not** a government official forecast in the U.S. sense.
- **Accuracy**: Depends on underlying models (often ECMWF/GFS-class inputs). Typically good for **synoptic** patterns; local effects (sea breeze, urban heat) may differ from a nearby ASOS station.
- **Limits**: **No API key** for the public endpoint; fair-use / rate limits apply. Uptime is generally good but not contractually guaranteed.

### Where it appears in the project

- Always fetched for **current** and **forecast** in `weatherService.js` (alongside NOAA and optionally OWM).
- **Merge**: Competes field-by-field with other sources using **`MERGE_PRIORITY_*`**.
- **Enrichment**: Supplies **pressure** and **gust** for forecast periods when the winning NWS timeline omits them.
- **Historical playback**: `fetchBatchHistoricalHourly` drives the **Historical** view; values are **model / reanalysis-style hourly fields**, not a guarantee of past ASOS observations at each pin.

---

## OpenWeatherMap

Commercial/global weather API (**optional** — requires **`VITE_OPENWEATHERMAP_API_KEY`**).

### Endpoints used

| Flow                 | URL                                                   | Module                     |
| -------------------- | ----------------------------------------------------- | -------------------------- |
| Current              | `GET https://api.openweathermap.org/data/2.5/weather` | `js/api/openweathermap.js` |
| 5‑day / 3‑h forecast | `GET .../data/2.5/forecast`                           | `js/api/openweathermap.js` |

Configured in `js/config.js` as `OPENWEATHERMAP_CURRENT` / `OPENWEATHERMAP_FORECAST`.

### Trust and accuracy

- **Trust**: Widely used aggregator; quality depends on their data pipeline and stations.
- **Accuracy**: Variable by region; can differ from NWS for the same coordinates. Useful as a **third** opinion when configured.
- **Limits**: **Key required**; free tiers have call limits. If the key is missing, the app **skips** OWM and logs a one-time console warning (`weatherService.js`).

### Where it appears in the project

- **`WeatherService.fetchCurrentWeather`** and **`fetchForecast`** — only if the key is set.
- **Forecast enrichment**: Can supply **pressure** and **wind gust** when Open‑Meteo does not have a usable value.

---

## ArcGIS / Esri (Maps SDK & portal)

The **3D map** is built with **ArcGIS Maps SDK for JavaScript** (loaded from CDN) and a **public WebScene** hosted on ArcGIS Online.

### Resources used

| Resource     | URL / ID                                                     | Purpose                    |
| ------------ | ------------------------------------------------------------ | -------------------------- |
| JS API + CSS | `https://js.arcgis.com/4.29/` (see `index.html`)             | SceneView, layers, symbols |
| Portal       | `CONFIG.ARCGIS_PORTAL_URL` (`https://cggis.maps.arcgis.com`) | WebScene item              |
| WebScene     | `CONFIG.ARCGIS_WEBSCENE_ID`                                  | City 3D scene              |

**`VITE_ARCGIS_API_KEY`**: Optional in `config.js`. Public scenes may work without it depending on Esri/portal settings; if your deployment requires authentication for certain layers, configure the key per Esri docs.

### Trust and accuracy

- **Trust**: Esri-hosted content and SDK are production-grade; **basemap and elevation** are standard GIS products, not meteorological observations.
- **“Weather” in the scene**: The app also drives **lighting / sky / optional Esri weather widget** from **live API weather** in `main.js` — that atmospheric depiction is **visualization**, not a second numerical forecast.

### Where it appears

- **`js/main.js`** — `initArcGIS`, layers, SceneView, optional Weather widget wiring.
- **`js/config.js`** — portal, scene id, quality, camera.

---

## Internal: Vite `POST /__debug_log`

**Not** a third-party API. **`vite.config.js`** registers middleware so `debugLog()` in `main.js` can mirror lines to the **terminal** during development and `npm run preview`. It does not affect weather accuracy.

---

## How data is combined (high level)

1. **Current weather** — Multiple sources are fetched; **`mergeWeatherData`** in `js/api/weatherService.js` picks values per field using **`MERGE_PRIORITY_DEFAULT`** or **`MERGE_PRIORITY_NOAA_FIRST`** for the city center.
2. **Forecast** — Each location gets parallel forecast calls; the object with the **most periods** is kept, then **pressure** and **wind gust** are filled from other successful responses if missing.
3. **Grid display** — Station values are **interpolated** (IDW) in `js/utils/interpolation.js`; the map is **not** a full numerical weather model.
4. **Historical playback** — Prefer **Open-Meteo hourly past** (`fetchBatchHistoricalHourly` → `buildSnapshotsFromHistoricalHourly`); if that yields no frames, use **IndexedDB** snapshots in the same retention window (`timeFeatures.getHistoricalSnapshots`).

For a shorter product-oriented summary, see **`../README.md`** → _Forecast & merge_.

---

## Disclaimer

Weather **accuracy** depends on sensors, models, and interpolation. This app **displays** provider data and **merges** it according to the rules above; it does **not** certify observations for legal, aviation, or emergency decisions. For official warnings, follow **NWS** and local authorities.
