# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) where versioning is used.

## [Unreleased]

### Added

- Documentation set (under `docs/`): `Description.md`, `API.md`, `CONTRIBUTING.md`, `SECURITY.md`, `DEPLOY.md`, `ARCHITECTURE.md`, `USER_MANUAL.md`.

### Changed

- (Track user-visible and developer-facing changes here when you release.)

---

## [0.1.0] - 2026-04-14

### Added

- 3D ArcGIS WebScene for Coral Gables with temperature grid, multiple grid visual styles (Gulf Glass, Basic Grid, Tidefield Membrane).
- Multi-source weather: NOAA/NWS, Open‑Meteo, optional OpenWeatherMap; field merge and forecast timeline selection with pressure/gust enrichment.
- Wind vectors, split-screen compare, historical playback from IndexedDB, NWS alert toasts.
- Vite build, ESLint, Prettier, Vitest, GitHub Actions CI (`lint` → `format:check` → `test` → `build`).
- Dev/preview `debugLog` forwarding to terminal via `POST /__debug_log`.

<!-- After the first public tag, add compare/release links here. -->
