# User manual — Coral Gables Weather Radar

How to **use** the app in a browser. For installation and developer setup, see **`../README.md`**. For what the project is, see **`Description.md`**.

## Opening the app

1. Use a **modern browser** (Chrome, Firefox, Safari, or Edge) with **WebGL** enabled.
2. Open the site over **`http://` or `https://`**.  
   **Do not** open the HTML file directly from disk (`file://`) — the 3D map will not load correctly.
3. Wait for the **3D scene** and **temperature grid** to appear. The first load may take a few seconds while map tiles and weather data load.

## Main controls

- **View mode** — Choose what the map shows:
    - **Current** — Latest merged weather for stations and the interpolated grid.
    - **Forecast (3h / 24h)** — Conditions near **about 3 hours** or **about 24 hours** from now (nearest forecast time step from the APIs).
    - **Historical** — The timeline is **48 hours ago through right now** (wall clock). The app usually loads **hourly** data from **Open-Meteo** for each station, then adds a **current** frame at the end if the last hour is not fresh enough. The **slider left = 48h before now**, **slider right = current** (see on-screen hint). If Open-Meteo cannot load, playback uses **snapshots** saved in this browser when you pressed **Refresh** (often fewer frames, but still clipped to the same window).
    - **Split-screen compare** — Two panes side by side with different sources or times (camera stays linked).
- **Refresh** — Fetches **current** weather again (and loads forecast data if needed). A **green sweep** animation may run across the map while data loads.
- **Grid look** — Visual style for the grid (e.g. Gulf Glass, Basic Grid, Tidefield Membrane), where available in the UI.

## Map interaction

- **Rotate / tilt / zoom** — Use the scene navigation controls (or touch gestures on supported devices).
- **Click grid cells or points** — **Popups** show temperature, humidity, wind, pressure, and related details when data is available.
- **Wind arrows** — Arrows show **where the wind is going** (downwind); text may say wind is **from** a compass direction — that is standard weather convention.

## Alerts and messages

- **National Weather Service alerts** may appear as **toasts** when active for the map area.
- Other **notices** (welcome, microclimate hints) may appear depending on conditions and settings — read and dismiss as needed.

## Debug log (optional)

- Press **`D`** to toggle an **on-screen debug log** (timestamps and status messages).
- If you run the app via **Vite** (`npm run dev` or `npm run preview`), some messages may also appear in the **terminal** where the server runs.

## Mobile

- On **narrow screens**, panels may collapse into a **bottom sheet** or similar — use the menu control to open settings and modes.

## Data and privacy (short)

- Weather is fetched from **public weather APIs**; see **`API.md`** for providers.
- **Historical playback** loads **Open-Meteo** hourly data in your browser when possible, combines it with your **current** grid for the instant at **now**, and may use **IndexedDB** refresh snapshots as **fallback**. That data stays on your device and is not uploaded to a project server by default.

## Limitations

- Forecasts and observations **depend on third-party services** — occasional errors or gaps are possible.
- The map **interpolates** between stations; fine-scale local effects may differ from a single official station reading.
- This app is **not** a replacement for **official warnings** — follow NWS and local authorities for emergencies.

## Troubleshooting

| Problem               | What to try                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blank or gray 3D view | Confirm the URL starts with `http://` or `https://`, not `file://`. Reload. Check network connection.                                                                                                          |
| No weather numbers    | Use **Refresh**; check that APIs are reachable (some networks block requests).                                                                                                                                 |
| Historical empty      | Check **network** access to **Open-Meteo**; try **Refresh** on **Current** then open **Historical** again. If offline or blocked, the app only has **IndexedDB** snapshots from past sessions (may be sparse). |
| Performance           | Close other heavy tabs; try a smaller window or lower scene quality if your build exposes that setting.                                                                                                        |

For developers: **`../README.md`** (Troubleshooting) and **`DEPLOY.md`** (hosting).
