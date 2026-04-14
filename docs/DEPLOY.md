# Deploying Coral Gables Weather Grid

The app is a **static SPA** after build: HTML, JS, and CSS under `dist/`. There is **no Node server required** in production unless you add one yourself.

## Prerequisites

- **Node.js** (LTS recommended) and **npm**
- Weather APIs are called **from the user’s browser** (`fetch` to NWS, Open‑Meteo, etc.) — ensure your host allows users to reach the public internet.

## Build

From the repository root:

```bash
npm ci          # or npm install
cp .env.example .env
# Edit .env — set VITE_* keys if needed (see ../README.md)
npm run build
```

Output: **`dist/`** — upload this folder’s contents to your static host (or configure the host to use `dist` as the web root).

## Environment variables at build time

Vite **inlines** `import.meta.env.VITE_*` when you run **`npm run build`**. Changing `.env` on the server **after** build does **not** change the bundle unless you rebuild.

- Set **`VITE_OPENWEATHERMAP_API_KEY`** before build if you want OpenWeatherMap data.
- **`VITE_NWS_CONTACT_EMAIL`** is recommended for NWS `User-Agent` string (see `API.md`).
- **`VITE_ARCGIS_API_KEY`** only if your deployment requires it for Esri resources.

## Serving over HTTP(S)

- The app **must** be served over **`http://` or `https://`**. Opening `index.html` via **`file://`** will **not** work (ArcGIS modules and ES modules expect HTTP).
- Configure the host to serve **`index.html`** for client-side routes if you add any in the future (current app uses hash-less paths from root).

## CORS and APIs

- Browser requests go **directly** to weather and Esri endpoints. You do **not** need a same-origin proxy for the default APIs (they send CORS headers suitable for browser use).
- If you introduce a **custom API** on another origin, configure **CORS** on that API.

## Caching

- For production updates, use **cache-busting** (Vite fingerprints JS/CSS assets) or set short cache on `index.html` and longer on hashed assets.
- A long-lived **CDN cache** of `index.html` alone can leave users on an old shell — prefer immutable asset URLs (Vite default) + short HTML TTL.

## Checklist

| Step                                                         | Done |
| ------------------------------------------------------------ | ---- |
| `npm run build` succeeds                                     | ☐    |
| `.env` values set **before** build                           | ☐    |
| Site served over **HTTPS** (recommended) or HTTP             | ☐    |
| Smoke test: grid loads, weather populates, no console errors | ☐    |
| Understand **`VITE_*` keys are public** in the built JS      | ☐    |

## Related

- **`../README.md`** — Local dev, `run.sh`, CI
- **`API.md`** — External services and merge behavior
- **`SECURITY.md`** — Client-side keys and reporting
