/// <reference types="vite/client" />
// Configuration constants
//
// Secrets: root `.env` or `.env.local` — `VITE_OPENWEATHERMAP_API_KEY`, `VITE_ARCGIS_API_KEY` (see `.env.example`).
// Use direct `import.meta.env.VITE_*` below so Vite can inline values at dev/build time.
// Plain `http-server` on raw sources: `import.meta.env` is missing — try/catch yields empty keys.
// Each secret uses a literal `import.meta.env.VITE_*` property so Vite can inline at dev/build.

function readOpenWeatherMapKey() {
    try {
        return String(import.meta.env.VITE_OPENWEATHERMAP_API_KEY ?? '').trim();
    } catch {
        return '';
    }
}

function readArcgisKey() {
    try {
        return String(import.meta.env.VITE_ARCGIS_API_KEY ?? '').trim();
    } catch {
        return '';
    }
}

/**
 * api.weather.gov requires a descriptive User-Agent; NWS asks for contact info for heavy use.
 * Set `VITE_NWS_CONTACT_EMAIL` in `.env` to append it (helps with API reliability / support).
 */
function readNwsUserAgent() {
    try {
        const contact = String(import.meta.env.VITE_NWS_CONTACT_EMAIL ?? '').trim();
        if (contact) {
            return `CoralGablesWeatherGrid/1.0 (contact: ${contact})`;
        }
    } catch {
        /* non-Vite host */
    }
    return 'CoralGablesWeatherGrid/1.0';
}

const OPENWEATHERMAP_API_KEY_FROM_ENV = readOpenWeatherMapKey();
const ARCGIS_API_KEY_FROM_ENV = readArcgisKey();
const NWS_USER_AGENT_FROM_ENV = readNwsUserAgent();

export const CONFIG = {
    // ArcGIS Configuration
    // WebScene: https://cggis.maps.arcgis.com/home/webscene/viewer.html?webscene=015327956f4a4785b2b689ab1a579489
    ARCGIS_WEBSCENE_ID: '015327956f4a4785b2b689ab1a579489',
    /** Portal where the WebScene item lives (public scene — no sign-in required) */
    ARCGIS_PORTAL_URL: 'https://cggis.maps.arcgis.com',
    ARCGIS_API_KEY: ARCGIS_API_KEY_FROM_ENV,
    /** Sent on every `api.weather.gov` request (points, observations, alerts). */
    NWS_USER_AGENT: NWS_USER_AGENT_FROM_ENV,

    /**
     * SceneView rendering quality (`low` | `medium` | `high`).
     * High = best lighting, atmosphere, and anti-aliasing; re-applied if the WebScene resets it.
     */
    SCENE_QUALITY_PROFILE: 'high',

    // Scene lighting — sun/sky follow real clock time (evening/night at the right hours)
    SCENE_LIVE_LIGHTING_ENABLED: true,
    /** How often to refresh simulated sun position (ms) */
    SCENE_LIGHTING_UPDATE_INTERVAL_MS: 60 * 1000,
    /** On-map panel: manual time-of-day + weather (off = drive from live clock + API data) */
    SCENE_LIGHTING_TEST_HUD: false,
    /** Local hour (0–23) for each preset when not using Live */
    SCENE_TIME_PRESET_HOURS: {
        morning: 8,
        midday: 12,
        evening: 15,
        night: 22
    },
    /**
     * Esri sky weather only applies when viewingMode is global (not local).
     * City WebScenes often load as local — force global after load so rain/clouds can render.
     */
    SCENE_FORCE_GLOBAL_FOR_WEATHER: true,
    /**
     * Fallback camera height (m) before extent framing — ignored when SCENE_FRAME_FULL_EXTENT_ON_LOAD
     * fits GRID_EXTENT. Very high views can suppress weather visibility in the SDK.
     */
    SCENE_INITIAL_CAMERA_Z_METERS: 1200,
    /**
     * Fixed opening camera (lon/lat °, z m, heading/tilt °). When fully set, used for SceneView at startup
     * and automatic extent framing is skipped. Remove or set to null to frame GRID_EXTENT again.
     */
    SCENE_INITIAL_CAMERA: {
        longitude: -80.358296,
        latitude: 25.598559,
        z: 4105.7,
        heading: 34.0,
        tilt: 78.9
    },
    /** Esri Weather widget on the map (off = widget stays headless; scene still follows API via code). */
    SCENE_ESRI_WEATHER_WIDGET: false,

    /**
     * On load, frame the camera to GRID_EXTENT and wait for tiles/scene to finish updating
     * so Coral Gables is fully drawn before interaction (avoids streaming while panning).
     * Ignored when `SCENE_INITIAL_CAMERA` defines a full preset (see main.js).
     */
    SCENE_FRAME_FULL_EXTENT_ON_LOAD: true,
    /**
     * Expand GRID_EXTENT before framing so the opening shot shows the full grid plus
     * surrounding map context (not a tight crop).
     */
    SCENE_INITIAL_EXTENT_BUFFER_RATIO: 0.12,
    /** Screen padding when fitting the buffered extent (px) — larger = more map around the grid */
    SCENE_INITIAL_VIEW_PADDING: {
        top: 64,
        bottom: 120,
        left: 64,
        right: 64
    },
    /** Camera tilt (deg) when framing the grid on load — modest oblique view */
    SCENE_INITIAL_GO_TO_TILT: 56,
    /** Max time to wait for view.updating to settle after framing (ms) */
    SCENE_INITIAL_LOAD_MAX_WAIT_MS: 60000,
    /**
     * While true, moving the SceneView logs camera x/y/z to the dev server terminal (`run.sh` / Vite → POST /__debug_log).
     * Geographic scenes: x = longitude (°), y = latitude (°), z = eye altitude (m). Also logs heading & tilt (°).
     */
    CAMERA_DEBUG_LOG_ENABLED: false,
    /** Minimum ms between camera lines (throttle; keeps terminal readable while orbiting). */
    CAMERA_DEBUG_LOG_INTERVAL_MS: 200,

    // Weather API — optional OpenWeatherMap (from `.env` via Vite); Open-Meteo + NOAA work without it
    OPENWEATHERMAP_API_KEY: OPENWEATHERMAP_API_KEY_FROM_ENV,

    // Location Configuration
    CORAL_GABLES_CENTER: {
        latitude: 25.7217,
        longitude: -80.2683
    },

    // Grid extent (approximate boundaries)
    GRID_EXTENT: {
        north: 25.76,
        south: 25.6834,
        east: -80.24,
        west: -80.2966
    },

    // Grid Configuration
    GRID_ROWS: 7,
    GRID_COLS: 7,
    GRID_RESOLUTION: 'medium', // fine, medium, coarse

    // Sampling Points Configuration
    TOTAL_SAMPLING_POINTS: 17,

    // Refresh Intervals (in milliseconds)
    WEATHER_REFRESH_INTERVAL: 2 * 60 * 1000, // 2 minutes

    /**
     * Parallel batch weather: how many station fetches run at once (each station still merges Open-Meteo + NOAA in parallel).
     * Higher = faster load; if you see 429/rate errors from an API, lower to 3–4 or set `WEATHER_BATCH_WAVE_GAP_MS` to 40–80.
     */
    WEATHER_BATCH_CONCURRENCY: 6,
    /** Optional pause (ms) between concurrency *waves* only — 0 = fastest. */
    WEATHER_BATCH_WAVE_GAP_MS: 0,
    /** If the first full-grid fetch yields zero successes, wait and retry once (helps flaky networks / cold APIs). */
    WEATHER_FETCH_RETRY_DELAY_MS: 1100,
    WEATHER_FETCH_MAX_ATTEMPTS: 2,
    /** NWS active-alerts poll — keep relatively frequent so the list stays current. */
    ALERT_REFRESH_INTERVAL: 60 * 1000, // 1 minute

    // Historical Data Configuration
    HISTORICAL_DATA_RETENTION: 48 * 60 * 60 * 1000, // 48 hours

    // Temperature Visualization Configuration
    /** @deprecated for live grid — main view uses relief mapping below */
    TEMP_TO_ELEVATION_SCALE: 20, // meters per degree F (absolute scale; poor for small spreads)
    ELEVATION_OFFSET_BASE: 0,
    MAX_ELEVATION: 1000, // maximum elevation in meters (mesh utilities)
    // Scene grid: map coldest→hottest across the current frame to this vertical span (meters)
    GRID_TEMP_RELIEF_METERS: 3200,
    GRID_BASE_ELEVATION_METERS: 320,
    // Treat near-uniform fields as flat at mid-relief (avoid divide-by-zero)
    GRID_TEMP_RANGE_EPSILON: 1e-6,

    /**
     * Default grid look: `gulf-glass` | `basic-grid` (legend temp colors) | `tidefield-membrane` (wow).
     * The control panel + localStorage override this after first visit.
     */
    MAP_VISUAL_STYLE: 'gulf-glass',

    /**
     * Gulf Glass — translucent temperature tint + soft “sea-glass” edges (outline blended toward a pale mint
     * so the mesh reads calmer than raw per-cell RGB outlines). Basemap stays visible through the fill.
     */
    GULF_GLASS_GRID_FILL_ALPHA: 22,
    GULF_GLASS_GRID_OUTLINE_ALPHA: 108,
    /** Thinner wire = less visual noise than Tidefield/Basic. */
    GULF_GLASS_GRID_OUTLINE_WIDTH: 1.35,
    /**
     * Outline = lerp(cellRgb, HIGHLIGHT) — reduces rainbow fringe; 0 = legacy per-cell outline color.
     */
    GULF_GLASS_OUTLINE_BLEND: 0.42,
    GULF_GLASS_OUTLINE_HIGHLIGHT_RGB: [198, 242, 228],
    GULF_GLASS_BEACON_SIZE: 12,
    /** Station dot fill alpha — slightly more solid than mesh for legibility */
    GULF_GLASS_BEACON_FILL_ALPHA: 232,
    /** Ring around station dots — UI scan green family */
    GULF_GLASS_BEACON_OUTLINE: [52, 198, 118, 232],
    GULF_GLASS_BEACON_Z_METERS: 48,

    /**
     * Tidefield Membrane — only when MAP_VISUAL_STYLE / UI = `tidefield-membrane`:
     * micro-ripples, pulse, station tethers. Mesh outline uses the same sea-glass lerp as Gulf Glass
     * (`GULF_GLASS_OUTLINE_*`). Loading sweep is the shared CSS overlay (`#refreshScanOverlay`).
     */
    TIDEfield_GRID_FILL_ALPHA: 22,
    TIDEfield_GRID_OUTLINE_ALPHA: 108,
    /** Same family as `GULF_GLASS_GRID_OUTLINE_WIDTH` — thin wire, less noise over the membrane. */
    TIDEfield_GRID_OUTLINE_WIDTH: 1.35,
    /** Slightly larger than Gulf Glass beacons so stations stay readable over ripples; ring uses `GULF_GLASS_BEACON_OUTLINE`. */
    TIDEfield_BEACON_SIZE: 13,
    TIDEfield_BEACON_Z_METERS: 52,
    TIDEfield_RIPPLE_METERS: 22,
    TIDEfield_RIPPLE_SPATIAL_FREQ: 0.0009,
    TIDEfield_RIPPLE_SPEED: 1.2,
    TIDEfield_PULSE_DURATION_MS: 2600,
    TIDEfield_PULSE_STRENGTH: 1.45,
    TIDEfield_TETHERS_ENABLED: true,
    TIDEfield_TETHER_Z_BOTTOM: 32,
    TIDEfield_TETHER_Z_TOP: null,
    TIDEfield_TETHER_COLOR: [34, 190, 96, 175],
    TIDEfield_TETHER_WIDTH: 1.35,
    /**
     * While weather is fetching, CSS overlay sweep: one leg = left → right across the viewport (ms).
     * Repeats with `animation-iteration-count: infinite` (no reverse pass).
     */
    WEATHER_LOADING_SCAN_LEG_DURATION_MS: 6800,
    /** [r, g, b, a] — `#refreshScanOverlay` sweep (all grid looks; Tidefield no longer draws a 3D scan band) */
    TIDEfield_SCAN_COLOR: [34, 190, 96, 82],

    /** Wind arrows (mph): bucket max speeds, then `WIND_VECTOR_COLORS`[0..3] calm → severe */
    WIND_VECTOR_SPEED_BREAKS_MPH: [10, 20, 30],
    WIND_VECTOR_COLORS: [
        [24, 128, 118, 208],
        [42, 188, 108, 228],
        [218, 148, 72, 236],
        [232, 102, 78, 246]
    ],
    /** Scene z (m) and max geodesic-ish span (deg) for Coral Gables live wind arrow */
    CORAL_GABLES_WIND_ARROW_Z_METERS: 440,
    CORAL_GABLES_WIND_ARROW_MAX_LEN_DEG: 0.016,

    /** Basic grid — station fill / ring (outline-only mesh; beacons read on dark basemap) */
    BASIC_GRID_BEACON_FILL: [24, 32, 42, 250],
    BASIC_GRID_BEACON_OUTLINE: [46, 188, 108, 255],

    /** Basic grid + loading placeholder — outline only; keep edges soft so tiles show through. */
    BASIC_GRID_OUTLINE_ALPHA: 118,

    // Animation Configuration
    DEFORMATION_ANIMATION_DURATION: 2000, // milliseconds
    PLAYBACK_SPEEDS: [1, 2, 4],

    /**
     * When station temps across the grid differ by at least `MICROCLIMATE_MIN_SPREAD_F`, occasionally
     * toast which Coral Gables area is hotter/colder (sampling-point regions). Not used with sample-data.
     */
    MICROCLIMATE_TOAST_ENABLED: true,
    /** °F difference (max−min among stations) to treat as drastic. */
    MICROCLIMATE_MIN_SPREAD_F: 10,
    /** 0–1: only some refreshes fire (keeps it occasional). */
    MICROCLIMATE_TOAST_CHANCE: 0.38,
    /** Min time between microclimate toasts (ms). */
    MICROCLIMATE_TOAST_MIN_INTERVAL_MS: 8 * 60 * 1000,
    /** Delay after refresh so it follows the welcome toast on first load (ms). */
    MICROCLIMATE_TOAST_DELAY_MS: 3600,
    /** Auto-dismiss for microclimate toast (ms). */
    MICROCLIMATE_TOAST_AUTO_DISMISS_MS: 60 * 1000,
    /** Friendly “good morning / dress for the weather” toast on first load (ms). */
    WELCOME_TOAST_AUTO_DISMISS_MS: 60 * 1000,
    /**
     * NWS alert toasts: `0` = stay on screen until you dismiss or the alert expires from the API feed
     * (stale toasts are removed automatically when NWS no longer returns them).
     */
    ALERT_TOAST_AUTO_DISMISS_MS: 60 * 1000,
    /** Max NWS toasts shown; `0` = show all active alerts. */
    ALERT_TOAST_MAX_VISIBLE: 0,
    ALERT_TOAST_EXIT_MS: 420,
    /**
     * When station data suggests storm-level wind, rain, fog, or snow but NWS text does not already
     * cover that hazard, show one extra “live conditions” toast (same strip as NWS).
     */
    LIVE_CONDITION_SUPPLEMENT_ENABLED: true,
    /** `0` = live supplement stays until conditions or NWS coverage change. */
    LIVE_CONDITION_SUPPLEMENT_AUTO_DISMISS_MS: 60 * 1000,

    // Alert Thresholds
    TEMP_GRADIENT_THRESHOLD: 15, // °F difference across grid
    TEMP_CHANGE_RATE_THRESHOLD: 5, // °F per hour
    HEAT_ISLAND_THRESHOLD: 10, // °F above average

    // API Endpoints
    OPENWEATHERMAP_CURRENT: 'https://api.openweathermap.org/data/2.5/weather',
    OPENWEATHERMAP_FORECAST: 'https://api.openweathermap.org/data/2.5/forecast',
    NOAA_POINTS: 'https://api.weather.gov/points',
    NOAA_ALERTS: 'https://api.weather.gov/alerts/active',

    // IndexedDB Configuration
    DB_NAME: 'CoralGablesWeatherGrid',
    DB_VERSION: 1,
    STORE_WEATHER_DATA: 'weatherData',
    STORE_ALERTS: 'alerts'
};

// Sampling point positions (will be calculated in samplingPoints.js)
export const SAMPLING_PATTERNS = {
    NORTH_ROW: 5,
    MIDDLE_ROW: 5,
    SOUTH_ROW: 5,
    MID_LAYER: 2
};

/**
 * Temperature legend + grid tinting (all grid looks use this scale).
 * Four stops — cool dark green → teal → emerald → hot amber (borders stay green, not blue).
 */
export const TEMP_COLOR_GRADIENT = [
    { temp: 40, color: [24, 56, 46] },
    { temp: 55, color: [22, 112, 88] },
    { temp: 72, color: [46, 188, 108] },
    { temp: 90, color: [245, 148, 72] }
];

// Weather condition icons/symbols
export const WEATHER_ICONS = {
    clear: '☀️',
    clouds: '☁️',
    rain: '🌧️',
    snow: '❄️',
    thunderstorm: '⛈️',
    drizzle: '🌦️',
    mist: '🌫️'
};
