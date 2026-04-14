// Configuration constants
export const CONFIG = {
    // ArcGIS Configuration
    // WebScene: https://cggis.maps.arcgis.com/home/webscene/viewer.html?webscene=015327956f4a4785b2b689ab1a579489
    ARCGIS_WEBSCENE_ID: '015327956f4a4785b2b689ab1a579489',
    /** Portal where the WebScene item lives (public scene — no sign-in required) */
    ARCGIS_PORTAL_URL: 'https://cggis.maps.arcgis.com',
    ARCGIS_API_KEY: '', // Optional API key for specific layers/services

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
    /** Esri Weather widget on the map (off = widget stays headless; scene still follows API via code). */
    SCENE_ESRI_WEATHER_WIDGET: false,

    /**
     * On load, frame the camera to GRID_EXTENT and wait for tiles/scene to finish updating
     * so Coral Gables is fully drawn before interaction (avoids streaming while panning).
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
    
    // Weather API Configuration — set your key for OpenWeatherMap (optional; Open-Meteo + NOAA still work)
    OPENWEATHERMAP_API_KEY: '',
    
    // Location Configuration
    CORAL_GABLES_CENTER: {
        latitude: 25.7217,
        longitude: -80.2683
    },
    
    // Grid extent (approximate boundaries)
    GRID_EXTENT: {
        north: 25.7600,
        south: 25.6834,
        east: -80.2400,
        west: -80.2966
    },
    
    // Grid Configuration
    GRID_ROWS: 7,
    GRID_COLS: 7,
    GRID_RESOLUTION: 'medium', // fine, medium, coarse
    
    // Sampling Points Configuration
    TOTAL_SAMPLING_POINTS: 17,
    
    // Refresh Intervals (in milliseconds)
    WEATHER_REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
    ALERT_REFRESH_INTERVAL: 2 * 60 * 1000,    // 2 minutes
    
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
    
    // Animation Configuration
    DEFORMATION_ANIMATION_DURATION: 2000, // milliseconds
    PLAYBACK_SPEEDS: [1, 2, 4],
    
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

// Color gradients for temperature visualization
export const TEMP_COLOR_GRADIENT = [
    { temp: -10, color: [0, 0, 255] },      // Deep blue
    { temp: 32, color: [0, 255, 255] },     // Cyan
    { temp: 60, color: [0, 255, 0] },       // Green
    { temp: 80, color: [255, 255, 0] },     // Yellow
    { temp: 100, color: [255, 165, 0] },    // Orange
    { temp: 120, color: [255, 0, 0] }       // Red
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
