# Security policy

## Supported versions

Security fixes are applied to the **default branch** (e.g. `main`) as needed. There is no separate long-term support matrix for older tags unless explicitly published.

## Reporting a vulnerability

- **Preferred:** Open a **private** security advisory on the repository (GitHub: **Security → Report a vulnerability**), or contact the maintainers through a channel they publish for this project.
- Describe impact, affected components, and reproduction steps without exploiting systems you do not own.

Please **do not** file public issues with exploit details until a fix is available.

## Client-side secrets (`VITE_*`)

This app is built with **Vite** and runs entirely in the **browser**. Any value exposed as `import.meta.env.VITE_*` is **bundled into static JavaScript** and is **visible to anyone** who loads the deployed site.

- Treat **`VITE_OPENWEATHERMAP_API_KEY`**, **`VITE_ARCGIS_API_KEY`**, and similar keys as **public** when you deploy static hosting.
- **Do not** commit real `.env` files (they are gitignored); use **`.env.example`** for names only.
- For keys that must stay server-side, you would need a **backend proxy** — this repository does not provide one.

## What not to share publicly

- API keys, tokens, or cookies
- Personal data from users (the app’s default IndexedDB storage is **local to the user’s browser**; do not ask users to export DB dumps with sensitive info without consent)

## Dependencies

Run `npm audit` periodically and update dependencies as appropriate. CI does not replace your own review of third-party packages.

## Disclaimer

Weather and map data are loaded from **third-party APIs** (see **`API.md`**). This project does not guarantee the security or availability of those services.
