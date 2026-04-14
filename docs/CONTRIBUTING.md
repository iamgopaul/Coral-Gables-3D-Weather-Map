# Contributing

Thanks for helping improve **Coral Gables Weather Grid**. This document covers how to report issues, propose changes, and keep CI green.

## Reporting issues

- Use the repository **Issues** tab (or your team’s tracker).
- Include **what you expected**, **what happened**, and **how to reproduce** (browser, OS, URL, steps).
- For weather oddities, note **date/time**, **view mode** (Current / forecast / historical / split), and whether **Refresh** was used.
- **Do not paste secrets** — no API keys, `.env` contents, or private tokens in issues or screenshots.

## Pull requests

1. **Branch from** `main` / `master` (or the default branch your fork uses).
2. **Keep changes focused** — one logical fix or feature per PR when possible.
3. **Run checks locally** before pushing (same order as CI):

```bash
npm run lint
npm run format:check
npm run test
npm run build
```

Or the project script:

```bash
./run.sh --check   # lint → format:check → test, then you still run build if you want
```

4. **Formatting** — if Prettier fails, run `npm run format` and commit the result.
5. **Describe the PR** in complete sentences: what changed and why.

## Environment and API keys

- Copy **`.env.example`** → **`.env`** at the repo root (see `../README.md`).
- Only variables prefixed with **`VITE_`** are exposed to the app via Vite.
- **`VITE_OPENWEATHERMAP_API_KEY`** is optional; without it, OpenWeatherMap is skipped (Open‑Meteo + NOAA still work).
- Keys are **inlined at build time** into the client bundle — treat them as **public** for static deployments.

## Code style

- **ESLint** and **Prettier** are the source of truth (`eslint.config.js`, `.prettierrc`).
- Match existing patterns in the file you edit (imports, naming, error handling).

## Tests

- Add or update **Vitest** tests under `tests/` when you change behavior that can be unit-tested (`npm run test`).
- Prefer testing **pure helpers** (merge, interpolation, time helpers) over full ArcGIS integration.

## Questions

For architecture and APIs, see **`ARCHITECTURE.md`** and **`API.md`**. For what the app does from a user perspective, see **`USER_MANUAL.md`** and **`Description.md`**.
