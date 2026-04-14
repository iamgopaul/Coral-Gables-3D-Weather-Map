#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Installing dependencies…"
npm install

if [[ ! -f .env ]]; then
    cp .env.example .env
    echo "Created .env from .env.example — edit it to set VITE_* keys (optional)."
fi

if [[ -f .env ]] && ! grep -qE '^[[:space:]]*VITE_OPENWEATHERMAP_API_KEY=.+' .env; then
    echo "⚠️  VITE_OPENWEATHERMAP_API_KEY is missing or empty in .env — OpenWeatherMap will be skipped."
    echo "   Add a line like: VITE_OPENWEATHERMAP_API_KEY=your_key_here (no spaces around =)"
fi

echo "Building…"
npm run build

echo "Serving production build at http://localhost:8000/ (Ctrl+C to stop)"
exec npm run preview
