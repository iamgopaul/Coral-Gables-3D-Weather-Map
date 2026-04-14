#!/usr/bin/env bash
# Install deps, optionally run lint/format/tests (CI parity), build, and preview the production bundle.
# Usage: ./run.sh | ./run.sh --check
set -euo pipefail
cd "$(dirname "$0")"

CHECK=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK=1 ;;
        -h | --help)
            echo "Usage: ./run.sh [--check]"
            echo ""
            echo "  (default)  npm install → build → preview at http://localhost:8000/"
            echo "  --check    Also run lint, format:check, and tests before build (same order as CI)."
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (try ./run.sh --help)" >&2
            exit 1
            ;;
    esac
done

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

if [[ "$CHECK" -eq 1 ]]; then
    echo "Running checks (lint → Prettier → tests)…"
    npm run lint
    npm run format:check
    npm run test
fi

echo "Building…"
npm run build

echo "Serving production build at http://localhost:8000/ (port from vite.config.js; Ctrl+C to stop)"
exec npm run preview
