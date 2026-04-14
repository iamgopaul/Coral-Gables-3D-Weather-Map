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
- This repo includes optional **`netlify.toml`** and **`vercel.json`** at the project root with **`Cache-Control: no-cache`** for `index.html` and long-lived cache for `assets/*`. Copy them to your deploy context or mirror the same rules in your host’s dashboard (CloudFront, GitHub Pages + Actions, etc.).

## Changes not showing after deploy

If new behavior (for example **historical playback** hourly backfill) works locally but not on the live URL, the production bundle is usually fine — the browser or CDN is still serving an **old `index.html`** or an **old JS file**.

1. **Confirm you deployed a fresh build** — Run `npm run build` from the commit that contains the change, then upload **all** of **`dist/`** (including the new `dist/assets/index-*.js` and `dist/index.html`). Partial uploads (only some files) break loads or leave mixed versions.
2. **Confirm the pipeline uses the right branch** — CI/CD must check out **`main`** (or your release branch), install, and build — not an old artifact cache from a previous run.
3. **Purge the CDN / edge cache** — Many hosts cache `index.html` for hours or days. Invalidate cache or purge URLs for `/` and `/index.html` after each release.
4. **Hard-refresh or cache-bust in the browser** — Try an incognito window, or DevTools → Network → **Disable cache** → reload. If it works there, the issue was browser or intermediary cache.
5. **Verify the shipped JS** — Open DevTools → **Network** → reload → select the main script under **`assets/`** (e.g. `index-XXXX.js`) → **Response** → search for **`past_days`** (from the Open-Meteo hourly URL). If that string is missing, the live site is still serving an **older** hashed file; redeploy full `dist/` and purge CDN.

## Checklist

| Step                                                           | Done |
| -------------------------------------------------------------- | ---- |
| `npm run build` succeeds                                       | ☐    |
| `.env` values set **before** build                             | ☐    |
| **Entire `dist/`** uploaded / published (not a partial copy)   | ☐    |
| CDN / host: **`index.html` not cached for days** (see Caching) | ☐    |
| Site served over **HTTPS** (recommended) or HTTP               | ☐    |
| Smoke test: grid loads, weather populates, no console errors   | ☐    |
| Understand **`VITE_*` keys are public** in the built JS        | ☐    |

## Vercel (GitHub integration)

- **Project → Settings → General**: confirm **Framework Preset** is **Vite** (or **Other** with **Build Command** `npm run build` and **Output Directory** `dist`).
- **`vercel.json`** at the repo root sets short cache for **`/`** and **`/index.html`** and long cache for **`/assets/*`**. Push it so the next production deploy picks it up.
- If the live site still looks old while **build logs are green**: open **Deployments** → the latest deployment → **⋯** → **Redeploy** → enable **Use existing Build Cache** = **off** (clear build cache) once, or use **Redeploy** after a trivial commit. In **Project → Settings → Data Cache**, you can clear the **Data Cache** if you use features that cache fetch responses (this app’s weather calls are client-side, so the usual fix is HTML/asset cache: redeploy + hard refresh).
- **Verify**: In the browser, **View Source** on `https://yoursite.vercel.app/` and confirm the `<script type="module" src="/assets/index-….js">` hash matches the newest file in the GitHub **`dist`** output from CI (or run `npm run build` locally and compare the filename).

## Related

- **`../README.md`** — Local dev, `run.sh`, CI
- **`API.md`** — External services and merge behavior
- **`SECURITY.md`** — Client-side keys and reporting
