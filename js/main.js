import { CONFIG } from './config.js';
import { generateSamplingPoints } from './samplingPoints.js';
import * as WeatherService from './api/weatherService.js';
import * as DB from './storage/db.js';
import { generateGridCells } from './utils/gridGenerator.js';
import { interpolateGrid, interpolate } from './utils/interpolation.js';
import * as TimeFeatures from './features/timeFeatures.js';

/**
 * ENHANCED Main Application with Time-Based Features
 * - Historical Playback
 * - Forecast Mode
 * - Split-Screen Comparison
 * - GUARANTEED Grid Visibility
 */

// Global state
const state = {
    samplingPoints: [],
    gridCells: [],
    weatherData: [],
    forecastData: [],
    historicalSnapshots: [],
    currentMode: 'current',
    sceneView: null,
    rightSceneView: null,
    layers: {
        grid: null,
        points: null,
        wind: null,
        splitGrid: null,
        splitPoints: null,
        splitWind: null
    },
    timers: {
        weatherRefresh: null,
        alertRefresh: null,
        countdownTimer: null,
        sceneLighting: null,
        lightingHudClock: null
    },
    playbackController: null,
    isShowingGrid: false,
    nextRefreshTime: null,
    /** 'live' | 'morning' | 'midday' | 'evening' | 'night' — scene sun time */
    sceneTimePreset: 'live',
    /** Esri scene weather preset: sunny | cloudy | rainy | snowy | foggy (see canonicalSceneWeatherMode) */
    sceneWeatherMode: 'sunny',
    /** Set after ArcGIS modules load — used by scene HUD */
    SunLightingClass: null,
    SunnyWeatherClass: null,
    CloudyWeatherClass: null,
    RainyWeatherClass: null,
    SnowyWeatherClass: null,
    FoggyWeatherClass: null,
    /** esri/webscene/Environment — replace whole object so portal lighting/weather is overridden */
    WebsceneEnvironmentClass: null,
    /** Esri Weather widget instance (optional) */
    weatherWidget: null,
    /** Second WebScene for split-screen (right pane) */
    splitMap: null,
    /** WatchHandle: sync camera left → right in split mode */
    splitCameraWatchHandle: null,
    /** WatchHandle: sync camera right → left in split mode */
    splitCameraWatchHandleRight: null,
    /** NWS-prioritized merged weather at Coral Gables center (legend + scene sky) */
    coralGablesLiveWeather: null,
    /** Handles from view.on('immediate-click') for split linked selection */
    splitInteractionHandles: [],
    /** Pairs of { graphic, symbol } to restore after split highlight */
    splitSelectionRestore: [],
    /** Skip split camera sync while handling linked clicks / popups (avoids viewpoint feedback loops). */
    splitSuppressCameraSync: false,
    /** Ignore overlapping immediate-click runs while async work is in flight */
    splitClickHandling: false,
    /** Bumped on split init / teardown so in-flight async init aborts after mode changes */
    splitScreenEpoch: 0,
    /** Prevents viewpoint watchers from re-entering during goTo (ping-pong / freeze). */
    splitCameraSyncing: false,
    /** Handles to remove when tearing down the right SceneView */
    splitRightInternalWatchHandles: [],
    /** Esri constructors for split pane — set after initArcGIS `require` (avoids nested `require` from ES modules). */
    esriSplit: null
};

// Make state accessible for debugging
window.debugState = state;

/**
 * Initialize the application
 */
async function init() {
    try {
        showLoading(true, 'Initializing...');
        debugLog('🚀 Application starting...');
        
        // Initialize IndexedDB
        await DB.initDB();
        debugLog('✓ Database initialized');
        
        // Generate sampling points
        state.samplingPoints = generateSamplingPoints();
        debugLog(`✓ Generated ${state.samplingPoints.length} sampling points`);
        
        // Generate grid cells
        state.gridCells = generateGridCells();
        debugLog(`✓ Generated ${state.gridCells.length} grid cells`);
        
        // Initialize ArcGIS Scene
        await initArcGIS();
        debugLog('✓ ArcGIS initialized');

        if (state.SunLightingClass && state.WebsceneEnvironmentClass) {
            setupLightingTestHud();
        }

        // Hide full-screen loader before weather/history — otherwise the map and control panel
        // (including Scene sun time) stay covered until the slow API calls finish.
        // Keep loader visible until first weather refresh completes so opening view shows
        // live API-driven sky/weather together with the grid (see refreshWeatherData).

        // Wait a brief moment for layers to be fully ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Show grid IMMEDIATELY with default colors (GUARANTEED VISIBILITY)
        debugLog('📊 Showing initial grid...');
        try {
            showImmediateGrid();
            debugLog('✓ Initial grid display called');
        } catch (gridError) {
            console.error('Grid display error:', gridError);
            debugLog('✗ Grid display failed: ' + gridError.message, true);
        }
        
        // Load historical snapshots
        try {
            state.historicalSnapshots = await TimeFeatures.getHistoricalSnapshots();
            debugLog(`✓ Loaded ${state.historicalSnapshots.length} historical snapshots`);
            updateSnapshotCount();
        } catch (err) {
            debugLog('⚠ No historical data yet (this is normal on first run)');
        }
        
        // Fetch initial weather data
        try {
            await refreshWeatherData();
            debugLog('✓ Initial weather data loaded');
        } catch (refreshErr) {
            debugLog('⚠ Initial weather fetch failed, grid showing with defaults', true);
        }
        
        // Setup UI event listeners
        setupEventListeners();
        debugLog('✓ Event listeners setup');
        
        // Start auto-refresh timers
        startAutoRefresh();
        debugLog('✓ Auto-refresh started');
        
        showLoading(false); // in case refreshWeatherData left it on
        debugLog('🎉 Application initialized successfully!');
        debugLog('Grid should be visible now!');
        
    } catch (error) {
        console.error('Failed to initialize application:', error);
        debugLog('✗ Critical error: ' + error.message, true);
        
        showError('Initialization error. Please refresh the page.');
        showLoading(false);
    }
}

/**
 * Show grid IMMEDIATELY with colorful default values
 * This GUARANTEES the grid is visible
 */
function showImmediateGrid() {
    // Prevent multiple simultaneous calls
    if (state.isShowingGrid) {
        debugLog('⚠ Grid display already in progress');
        return;
    }
    state.isShowingGrid = true;
    
    require(['esri/Graphic', 'esri/geometry/Polygon', 'esri/symbols/SimpleFillSymbol', 'esri/PopupTemplate'],
        (Graphic, Polygon, SimpleFillSymbol, PopupTemplate) => {
            
            try {
                if (!state.layers || !state.layers.grid) {
                    debugLog('⚠ Grid layer not ready yet, retrying in 500ms...');
                    state.isShowingGrid = false;
                    setTimeout(showImmediateGrid, 500);
                    return;
                }
                
                debugLog('🎨 Adding grid cells...');
                state.layers.grid.removeAll();
                
                const colors = [
                    [0, 0, 255],     // Blue
                    [0, 255, 255],   // Cyan
                    [0, 255, 0],     // Green
                    [255, 255, 0],   // Yellow
                    [255, 128, 0],   // Orange
                    [255, 0, 0]      // Red
                ];
                
                let added = 0;
                let failed = 0;
                
                state.gridCells.forEach((cell, index) => {
                    try {
                        const row = cell.row || 0;
                        const col = cell.col || 0;
                        const elevation = (row * 100) + (col * 80) + 500; // Much higher!
                        const colorIndex = (row + col) % colors.length;
                        const color = colors[colorIndex];
                        
                        const polygon = new Polygon({
                            rings: [[
                                [cell.bounds.west, cell.bounds.south, elevation],
                                [cell.bounds.east, cell.bounds.south, elevation],
                                [cell.bounds.east, cell.bounds.north, elevation],
                                [cell.bounds.west, cell.bounds.north, elevation],
                                [cell.bounds.west, cell.bounds.south, elevation]
                            ]],
                            spatialReference: { wkid: 4326 }
                        });
                        
                        const graphic = new Graphic({
                            geometry: polygon,
                            symbol: new SimpleFillSymbol({
                                color: [...color, 0], // 100% transparent
                                outline: {
                                    color: [...color, 255],
                                    width: 2
                                }
                            }),
                            attributes: {
                                row: row,
                                col: col,
                                elevation: elevation,
                                defaultColor: true
                            },
                            popupTemplate: new PopupTemplate({
                                title: `Grid Cell [${row}, ${col}]`,
                                content: `<b>Position:</b> Row ${row}, Col ${col}<br><b>Elevation:</b> ${elevation}m<br><i>Loading weather data...</i>`
                            })
                        });
                        
                        state.layers.grid.add(graphic);
                        added++;
                    } catch (cellErr) {
                        failed++;
                        console.error(`Error adding cell ${index}:`, cellErr);
                    }
                });
                
                debugLog(`✓ GRID VISIBLE: ${added} cells added` + (failed > 0 ? `, ${failed} failed` : ''));
                console.log(`%c🎨 GRID IS NOW VISIBLE! ${added} colorful cells added`, 'color: green; font-weight: bold; font-size: 14px');
                state.isShowingGrid = false;
                
            } catch (err) {
                console.error('Error in showImmediateGrid:', err);
                debugLog('✗ Grid rendering error: ' + err.message, true);
                state.isShowingGrid = false;
            }
        },
        (error) => {
            console.error('Error loading ArcGIS modules for grid:', error);
            debugLog('✗ Failed to load ArcGIS modules: ' + error.message, true);
            state.isShowingGrid = false;
        });
}

/**
 * Effective date/time used for sun lighting (live clock vs morning/midday/evening/night presets).
 */
function getSceneLightingDate() {
    const preset = state.sceneTimePreset || 'live';
    if (preset === 'live') {
        return new Date();
    }
    const h = CONFIG.SCENE_TIME_PRESET_HOURS?.[preset];
    if (h === undefined || Number.isNaN(h)) {
        return new Date();
    }
    const d = new Date();
    d.setHours(h, 0, 0, 0);
    return d;
}

/** ArcGIS Maps SDK: five scene weather types (SunnyWeather, CloudyWeather, RainyWeather, SnowyWeather, FoggyWeather). */
const SCENE_WEATHER_LABELS = {
    sunny: 'Sunny',
    cloudy: 'Cloudy',
    rainy: 'Rainy',
    snowy: 'Snowy',
    foggy: 'Foggy'
};

/** Map older UI values to the five canonical ArcGIS preset ids. */
function canonicalSceneWeatherMode(mode) {
    const m = mode || 'sunny';
    const legacy = {
        clear: 'sunny',
        rain: 'rainy',
        snow: 'snowy',
        overcast: 'cloudy'
    };
    return legacy[m] || m;
}

/**
 * Pick merged API weather nearest Coral Gables center (representative for scene sky).
 */
function pickRepresentativeWeatherSampleFromPoints(points) {
    if (
        state.coralGablesLiveWeather &&
        typeof state.coralGablesLiveWeather.temperature === 'number'
    ) {
        return state.coralGablesLiveWeather;
    }
    if (!points || !points.length) {
        return null;
    }
    const withData = points.filter(
        (p) => p && p.weatherData && typeof p.weatherData.temperature === 'number'
    );
    if (!withData.length) {
        return null;
    }
    const { latitude: lat0, longitude: lon0 } = CONFIG.CORAL_GABLES_CENTER;
    let best = withData[0];
    let bestD = Infinity;
    for (const p of withData) {
        const d = (p.latitude - lat0) ** 2 + (p.longitude - lon0) ** 2;
        if (d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return best.weatherData;
}

/**
 * Map merged API fields (OpenWeatherMap / Open-Meteo / NOAA) → Esri scene preset ids.
 */
function deriveSceneWeatherModeFromApiData(w) {
    if (!w) {
        return 'sunny';
    }
    const raw = String(w.weather || '')
        .toLowerCase()
        .trim();
    const desc = String(w.weatherDescription || '')
        .toLowerCase()
        .trim();

    if (raw.includes('snow') || desc.includes('snow') || desc.includes('ice')) {
        return 'snowy';
    }
    if (
        raw === 'rain' ||
        raw === 'drizzle' ||
        raw === 'thunderstorm' ||
        desc.includes('rain') ||
        desc.includes('drizzle') ||
        desc.includes('thunder') ||
        desc.includes('shower')
    ) {
        return 'rainy';
    }
    if (
        raw === 'mist' ||
        raw === 'fog' ||
        raw === 'haze' ||
        raw === 'foggy' ||
        desc.includes('fog') ||
        desc.includes('mist')
    ) {
        return 'foggy';
    }
    if (raw === 'clear' || raw === 'sunny') {
        return 'sunny';
    }
    if (raw === 'clouds' || raw === 'cloudy' || raw === 'cloud') {
        return 'cloudy';
    }
    if (typeof w.cloudCover === 'number' && w.cloudCover >= 70) {
        return 'cloudy';
    }
    if (typeof w.cloudCover === 'number' && w.cloudCover >= 35) {
        return 'cloudy';
    }
    if (desc.includes('overcast') || desc.includes('cloud')) {
        return 'cloudy';
    }
    if (desc.includes('clear') || desc.includes('fair')) {
        return 'sunny';
    }
    return 'sunny';
}

/** Valid SceneView.qualityProfile values for Esri 4.x */
function getSceneQualityProfile() {
    const q = CONFIG.SCENE_QUALITY_PROFILE;
    if (q === 'low' || q === 'medium' || q === 'high') {
        return q;
    }
    return 'high';
}

/**
 * Keep rendering quality at the configured profile (portal scenes sometimes downgrade after load).
 */
function ensureSceneViewQuality(view) {
    if (!view || !('qualityProfile' in view)) {
        return;
    }
    const target = getSceneQualityProfile();
    try {
        if (view.qualityProfile !== target) {
            view.qualityProfile = target;
        }
    } catch (e) {
        /* ignore */
    }
}

/** Sun uses real clock; sky weather follows latest API-derived preset. */
function syncSceneAtmosphereFromApiWeather() {
    state.sceneTimePreset = 'live';
    const sample = pickRepresentativeWeatherSampleFromPoints(state.samplingPoints);
    state.sceneWeatherMode = deriveSceneWeatherModeFromApiData(sample);
    if (CONFIG.SCENE_LIVE_LIGHTING_ENABLED) {
        if (state.sceneView) {
            applySceneEnvironment(state.sceneView);
        }
        if (state.rightSceneView) {
            applySceneEnvironment(state.rightSceneView);
        }
    }
}

/**
 * Esri scene weather — use SDK classes (same pattern that worked for sunny + rainy).
 */
function buildSceneWeather(mode) {
    const Sunny = state.SunnyWeatherClass;
    const Cloudy = state.CloudyWeatherClass;
    const Rainy = state.RainyWeatherClass;
    const Snowy = state.SnowyWeatherClass;
    const Foggy = state.FoggyWeatherClass;
    const m = canonicalSceneWeatherMode(mode);

    if (!Sunny) {
        return null;
    }

    switch (m) {
        case 'sunny':
            return new Sunny({ cloudCover: 0.02 });
        case 'cloudy':
            return Cloudy ? new Cloudy({ cloudCover: 0.5 }) : new Sunny({ cloudCover: 0.5 });
        case 'rainy':
            return Rainy ? new Rainy({ cloudCover: 0.44, precipitation: 0.36 }) : new Sunny({ cloudCover: 0.3 });
        case 'snowy':
            return Snowy
                ? new Snowy({
                      cloudCover: 0.425,
                      precipitation: 0.34,
                      snowCover: 'enabled'
                  })
                : new Sunny({ cloudCover: 0.3 });
        case 'foggy':
            return Foggy ? new Foggy({ fogStrength: 0.39 }) : new Sunny({ cloudCover: 0.3 });
        default:
            return new Sunny({ cloudCover: 0.12 });
    }
}

/**
 * Copy numeric preset fields from our built weather onto the live environment.weather
 * (after Esri WeatherViewModel.setWeatherByType, which installs the correct type instance).
 */
function mergeSceneWeatherPreset(view, preset) {
    if (!view?.environment || !preset) {
        return;
    }
    const cur = view.environment.weather;
    if (!cur) {
        return;
    }
    try {
        if (preset.cloudCover !== undefined) {
            cur.cloudCover = preset.cloudCover;
        }
        if (preset.precipitation !== undefined) {
            cur.precipitation = preset.precipitation;
        }
        if (preset.fogStrength !== undefined) {
            cur.fogStrength = preset.fogStrength;
        }
        if (preset.snowCover !== undefined) {
            cur.snowCover = preset.snowCover;
        }
    } catch (e) {
        console.warn('mergeSceneWeatherPreset:', e);
    }
}

/**
 * Apply sun + weather for a portal WebScene.
 * Time-of-day: same direct updates that work (`environment.lighting` from getSceneLightingDate()).
 * Weather: use Esri WeatherViewModel.setWeatherByType (identical to the Weather widget buttons),
 * then merge our preset strengths from buildSceneWeather. Fallback: assign weather instances.
 */
function applySceneEnvironment(view) {
    const SunLighting = state.SunLightingClass;
    const Environment = state.WebsceneEnvironmentClass;
    if (!view?.environment || !SunLighting || !Environment) {
        return;
    }

    const simDate = getSceneLightingDate();
    const hour = simDate.getHours();
    const isNight = hour >= 20 || hour < 6;
    const mode = canonicalSceneWeatherMode(state.sceneWeatherMode);

    if ('viewingMode' in view) {
        try {
            view.viewingMode = 'global';
        } catch (e) {
            /* ignore */
        }
    }
    ensureSceneViewQuality(view);

    const lighting = new SunLighting({
        date: simDate,
        directShadowsEnabled: true,
        cameraTrackingEnabled: false
    });

    let weatherPreset;
    try {
        weatherPreset = buildSceneWeather(mode);
    } catch (e) {
        console.warn('Weather objects:', e);
        return;
    }
    if (!weatherPreset) {
        return;
    }

    const prev = view.environment;
    let background = null;
    try {
        if (prev?.background && typeof prev.background.clone === 'function') {
            background = prev.background.clone();
        } else if (prev?.background) {
            background = prev.background;
        }
    } catch (e) {
        /* keep null */
    }

    let lightingOk = false;

    try {
        const env = view.environment;
        env.atmosphereEnabled = true;
        env.starsEnabled = isNight;
        env.lighting = lighting;
        lightingOk = true;
    } catch (e) {
        console.warn('Scene lighting update failed:', e);
    }

    try {
        const vm = state.weatherWidget?.viewModel;
        const useWidgetVm =
            vm &&
            typeof vm.setWeatherByType === 'function' &&
            state.weatherWidget?.view === view;
        if (useWidgetVm) {
            vm.setWeatherByType(mode);
            mergeSceneWeatherPreset(view, weatherPreset);
        } else {
            view.environment.weather = weatherPreset;
        }
    } catch (e) {
        console.warn('Scene weather update failed:', e);
        try {
            view.environment.weather = weatherPreset;
        } catch (e2) {
            console.warn('Direct weather assign failed:', e2);
        }
    }

    if (!lightingOk) {
        try {
            const newEnv = new Environment({
                lighting,
                weather: weatherPreset,
                atmosphereEnabled: true,
                starsEnabled: isNight,
                background
            });
            view.environment = newEnv;
            const vm = state.weatherWidget?.viewModel;
            const useWidgetVm =
                vm &&
                typeof vm.setWeatherByType === 'function' &&
                state.weatherWidget?.view === view;
            if (useWidgetVm) {
                vm.setWeatherByType(mode);
                mergeSceneWeatherPreset(view, weatherPreset);
            }
        } catch (e) {
            console.warn('Environment replace fallback failed:', e);
        }
    }

    try {
        const wt = view.environment?.weather?.type;
        if (wt && wt !== weatherPreset.type) {
            debugLog(`⚠ scene weather mismatch (wanted ${weatherPreset.type}, view has ${wt})`, true);
        }
    } catch (e) {
        /* ignore */
    }

    if (typeof view.requestRender === 'function') {
        view.requestRender();
    }
}

/**
 * Wire scene time + weather selects (control panel).
 */
function setupLightingTestHud() {
    const hud = document.getElementById('lightingTestHud');
    if (!hud) {
        debugLog('⚠ lightingTestHud missing from DOM', true);
        return;
    }
    if (!CONFIG.SCENE_LIGHTING_TEST_HUD || !CONFIG.SCENE_LIVE_LIGHTING_ENABLED) {
        hud.classList.remove('lighting-test-hud--visible');
        hud.classList.add('hidden');
        hud.setAttribute('hidden', '');
        return;
    }
    hud.classList.add('lighting-test-hud--visible');
    hud.classList.remove('hidden');
    hud.removeAttribute('hidden');

    const selTime = document.getElementById('sceneTimePresetSelect');
    const selWeather = document.getElementById('sceneWeatherSelect');
    const elSim = document.getElementById('lightingHudSimTime');
    const elHelp = document.getElementById('lightingHudOffset');

    if (selTime) {
        selTime.value = state.sceneTimePreset || 'live';
    }
    if (selWeather) {
        const canonW = canonicalSceneWeatherMode(state.sceneWeatherMode);
        state.sceneWeatherMode = canonW;
        selWeather.value = canonW;
    }

    const updateLabels = () => {
        const sim = getSceneLightingDate();
        if (elSim) {
            const fmt = {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit'
            };
            if (state.sceneTimePreset === 'live') {
                fmt.second = '2-digit';
            }
            elSim.textContent = sim.toLocaleString(undefined, fmt);
        }
        if (elHelp) {
            const preset = state.sceneTimePreset || 'live';
            const cw = canonicalSceneWeatherMode(state.sceneWeatherMode);
            const wLabel = SCENE_WEATHER_LABELS[cw] || cw;
            if (preset === 'live') {
                elHelp.textContent = `Live clock · Weather: ${wLabel}`;
            } else {
                const hr = CONFIG.SCENE_TIME_PRESET_HOURS?.[preset];
                elHelp.textContent = `Preset · ${preset} (${hr}:00) · Weather: ${wLabel}`;
            }
        }
    };

    const apply = () => {
        if (state.sceneView) {
            applySceneEnvironment(state.sceneView);
        }
        if (state.rightSceneView) {
            applySceneEnvironment(state.rightSceneView);
        }
        updateLabels();
    };

    const onTimeChange = () => {
        state.sceneTimePreset = (selTime && selTime.value) || 'live';
        apply();
    };
    const onWeatherChange = () => {
        const raw = (selWeather && selWeather.value) || 'sunny';
        const v = canonicalSceneWeatherMode(raw);
        const allowed = ['sunny', 'cloudy', 'rainy', 'snowy', 'foggy'];
        state.sceneWeatherMode = allowed.includes(v) ? v : 'sunny';
        apply();
    };
    if (selTime) {
        selTime.addEventListener('change', onTimeChange);
        selTime.addEventListener('input', onTimeChange);
    }
    if (selWeather) {
        selWeather.addEventListener('change', onWeatherChange);
        selWeather.addEventListener('input', onWeatherChange);
    }

    if (state.timers.lightingHudClock) {
        clearInterval(state.timers.lightingHudClock);
    }
    state.timers.lightingHudClock = setInterval(updateLabels, 1000);
    apply();
}

/**
 * Initialize ArcGIS Scene View (public WebScene — no OAuth)
 */
async function initArcGIS() {
    return new Promise((resolve, reject) => {
        require([
            'esri/WebScene',
            'esri/webscene/Environment',
            'esri/views/SceneView',
            'esri/views/3d/environment/SunLighting',
            'esri/views/3d/environment/SunnyWeather',
            'esri/views/3d/environment/CloudyWeather',
            'esri/views/3d/environment/RainyWeather',
            'esri/views/3d/environment/SnowyWeather',
            'esri/views/3d/environment/FoggyWeather',
            'esri/layers/GraphicsLayer',
            'esri/widgets/Zoom',
            'esri/widgets/Compass',
            'esri/widgets/NavigationToggle',
            'esri/widgets/Home',
            'esri/geometry/Extent',
            'esri/core/reactiveUtils',
            'esri/widgets/Weather'
        ], (
            WebScene,
            Environment,
            SceneView,
            SunLighting,
            SunnyWeather,
            CloudyWeather,
            RainyWeather,
            SnowyWeather,
            FoggyWeather,
            GraphicsLayer,
            Zoom,
            Compass,
            NavigationToggle,
            Home,
            Extent,
            reactiveUtils,
            Weather
        ) => {
            (async () => {
                try {
                    state.esriSplit = {
                        WebScene,
                        SceneView,
                        GraphicsLayer,
                        Zoom,
                        Compass,
                        NavigationToggle,
                        Home
                    };
                    state.WebsceneEnvironmentClass = Environment;
                    state.SunLightingClass = SunLighting;
                    state.SunnyWeatherClass = SunnyWeather;
                    state.CloudyWeatherClass = CloudyWeather;
                    state.RainyWeatherClass = RainyWeather;
                    state.SnowyWeatherClass = SnowyWeather;
                    state.FoggyWeatherClass = FoggyWeather;
                    debugLog('Loading public WebScene…');

                    const portalItem = {
                        id: CONFIG.ARCGIS_WEBSCENE_ID
                    };
                    if (CONFIG.ARCGIS_PORTAL_URL) {
                        portalItem.portal = { url: CONFIG.ARCGIS_PORTAL_URL };
                    }

                    const map = new WebScene({
                        portalItem
                    });

                    map.when().catch((err) => {
                        console.error('WebScene load error:', err);
                        debugLog('✗ WebScene failed: ' + (err && err.message ? err.message : String(err)), true);
                    });

                    debugLog('Creating scene view...');

                    const camZ =
                        typeof CONFIG.SCENE_INITIAL_CAMERA_Z_METERS === 'number'
                            ? CONFIG.SCENE_INITIAL_CAMERA_Z_METERS
                            : 1200;

                    state.sceneView = new SceneView({
                        container: 'viewDiv',
                        map: map,
                        viewingMode: 'global',
                        qualityProfile: getSceneQualityProfile(),
                        camera: {
                            position: {
                                longitude: CONFIG.CORAL_GABLES_CENTER.longitude,
                                latitude: CONFIG.CORAL_GABLES_CENTER.latitude,
                                z: camZ
                            },
                            tilt: 45,
                            heading: 0
                        },
                        popup: {
                            dockEnabled: false,
                            dockOptions: {
                                buttonEnabled: false
                            },
                            alignment: 'auto',
                            collapseEnabled: false
                        }
                    });

                    state.layers.grid = new GraphicsLayer({
                        title: 'Weather Grid',
                        elevationInfo: { mode: 'absolute-height' }
                    });
                    state.layers.points = new GraphicsLayer({
                        title: 'Sampling Points',
                        elevationInfo: { mode: 'absolute-height' }
                    });
                    state.layers.wind = new GraphicsLayer({
                        title: 'Wind Vectors',
                        elevationInfo: { mode: 'absolute-height' },
                        visible: false
                    });

                    map.addMany([state.layers.grid, state.layers.points, state.layers.wind]);

                    await map.when();
                    if (typeof map.loadAll === 'function') {
                        try {
                            await map.loadAll();
                        } catch (e) {
                            console.warn('map.loadAll:', e);
                        }
                    }
                    await state.sceneView.when();

                    // Portal WebScenes often restore saved UI (e.g. zoom/compass on top-left) while we also
                    // add widgets — clear every corner once, then attach a single toolbar on top-right.
                    const uiSlots = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
                    for (const slot of uiSlots) {
                        try {
                            if (typeof state.sceneView.ui.empty === 'function') {
                                state.sceneView.ui.empty(slot);
                            }
                        } catch (e) {
                            console.warn('Could not clear UI slot:', slot, e);
                        }
                    }

                    const zoom = new Zoom({
                        view: state.sceneView
                    });

                    const compass = new Compass({
                        view: state.sceneView
                    });

                    const navigationToggle = new NavigationToggle({
                        view: state.sceneView
                    });

                    const home = new Home({
                        view: state.sceneView
                    });

                    state.sceneView.ui.add(zoom, 'top-right');
                    state.sceneView.ui.add(compass, 'top-right');
                    state.sceneView.ui.add(navigationToggle, 'top-right');
                    state.sceneView.ui.add(home, 'top-right');

                    debugLog('✓ Map controls added (single toolbar, portal UI cleared)');

                    if (CONFIG.SCENE_FRAME_FULL_EXTENT_ON_LOAD !== false) {
                        showLoading(true, 'Loading Coral Gables area…');
                        debugLog('Framing full Coral Gables extent & preloading scene…');
                        const g = CONFIG.GRID_EXTENT;
                        const ratio =
                            typeof CONFIG.SCENE_INITIAL_EXTENT_BUFFER_RATIO === 'number'
                                ? CONFIG.SCENE_INITIAL_EXTENT_BUFFER_RATIO
                                : 0.12;
                        const latSpan = g.north - g.south;
                        const lonSpan = g.east - g.west;
                        const dLat = latSpan * ratio * 0.5;
                        const dLon = lonSpan * ratio * 0.5;
                        const extent = new Extent({
                            xmin: Math.max(-180, g.west - dLon),
                            ymin: Math.max(-90, g.south - dLat),
                            xmax: Math.min(180, g.east + dLon),
                            ymax: Math.min(90, g.north + dLat),
                            spatialReference: { wkid: 4326 }
                        });
                        const pad = CONFIG.SCENE_INITIAL_VIEW_PADDING || {
                            top: 48,
                            bottom: 100,
                            left: 48,
                            right: 48
                        };
                        const frameTilt =
                            typeof CONFIG.SCENE_INITIAL_GO_TO_TILT === 'number'
                                ? CONFIG.SCENE_INITIAL_GO_TO_TILT
                                : 45;
                        try {
                            await state.sceneView.goTo(
                                {
                                    target: extent,
                                    tilt: frameTilt,
                                    heading: 0,
                                    padding: pad
                                },
                                { duration: 0 }
                            );
                        } catch (e) {
                            console.warn('Initial goTo(extent) failed:', e);
                            debugLog('⚠ Could not frame full extent; using default view', true);
                        }
                        const maxMs = CONFIG.SCENE_INITIAL_LOAD_MAX_WAIT_MS || 60000;
                        const t0 = Date.now();
                        while (state.sceneView.updating && Date.now() - t0 < maxMs) {
                            await new Promise((r) => setTimeout(r, 120));
                        }
                        try {
                            await reactiveUtils.whenOnce(() => !state.sceneView.updating);
                        } catch (e) {
                            /* still settling */
                        }
                        await new Promise((r) => setTimeout(r, 400));
                        const t1 = Date.now();
                        while (state.sceneView.updating && Date.now() - t1 < 10000) {
                            await new Promise((r) => setTimeout(r, 120));
                        }
                        debugLog('✓ Coral Gables extent framed; scene view idle');
                    }

                    // WebScene presentation can still inject saved UI after the first navigation; strip other corners only.
                    for (const slot of ['top-left', 'bottom-left', 'bottom-right']) {
                        try {
                            if (typeof state.sceneView.ui.empty === 'function') {
                                state.sceneView.ui.empty(slot);
                            }
                        } catch (e) {
                            /* ignore */
                        }
                    }

                    // Weather widget: must exist before applySceneEnvironment — ViewModel.setWeatherByType
                    // is the same API Esri uses for the on-map Weather UI (reliable vs manual env.weather).
                    let weatherHost = document.getElementById('esriWeatherWidgetHost');
                    if (!weatherHost) {
                        weatherHost = document.createElement('div');
                        weatherHost.id = 'esriWeatherWidgetHost';
                        document.body.appendChild(weatherHost);
                    }
                    weatherHost.setAttribute('aria-hidden', 'true');
                    weatherHost.classList.remove('esri-weather-widget-host--visible');
                    if (CONFIG.SCENE_ESRI_WEATHER_WIDGET) {
                        weatherHost.classList.add('esri-weather-widget-host');
                        weatherHost.classList.add('esri-weather-widget-host--visible');
                    } else {
                        weatherHost.classList.remove('esri-weather-widget-host');
                    }
                    state.weatherWidget = new Weather({
                        view: state.sceneView,
                        container: weatherHost
                    });

                    if (CONFIG.SCENE_FORCE_GLOBAL_FOR_WEATHER) {
                        try {
                            if (map.initialViewProperties) {
                                map.initialViewProperties.viewingMode = 'global';
                            }
                        } catch (e) {
                            console.warn('Could not set map.initialViewProperties.viewingMode:', e);
                        }
                        try {
                            state.sceneView.viewingMode = 'global';
                        } catch (e) {
                            console.warn('Could not set view.viewingMode global:', e);
                        }
                        state.sceneView.watch('viewingMode', (mode) => {
                            if (mode === 'local') {
                                try {
                                    state.sceneView.viewingMode = 'global';
                                } catch (e) {
                                    /* ignore */
                                }
                            }
                        });
                        debugLog(
                            '✓ viewingMode locked to global (Esri sky weather is disabled for local scenes)'
                        );
                    }

                    ensureSceneViewQuality(state.sceneView);
                    state.sceneView.watch('qualityProfile', (q) => {
                        const target = getSceneQualityProfile();
                        if (q !== target) {
                            ensureSceneViewQuality(state.sceneView);
                        }
                    });

                    if (CONFIG.SCENE_LIVE_LIGHTING_ENABLED) {
                        const applyWithLog = () => {
                            const beforeType = state.sceneView.environment?.lighting?.type;
                            applySceneEnvironment(state.sceneView);
                            const lit = state.sceneView.environment?.lighting;
                            const litDate = lit?.date;
                            const vm = state.sceneView.viewingMode;
                            debugLog(
                                `✓ Environment · was lighting=${beforeType} → now=${lit?.type} · mode=${vm}` +
                                    (litDate ? ` · sun ${litDate.toISOString()}` : '')
                            );
                        };
                        applyWithLog();
                        // WebScene sometimes reapplies portal environment after load — apply again shortly after
                        setTimeout(() => {
                            applySceneEnvironment(state.sceneView);
                            if (state.rightSceneView) {
                                applySceneEnvironment(state.rightSceneView);
                            }
                        }, 600);
                        setTimeout(() => {
                            applySceneEnvironment(state.sceneView);
                            if (state.rightSceneView) {
                                applySceneEnvironment(state.rightSceneView);
                            }
                        }, 2000);
                        if (state.timers.sceneLighting) {
                            clearInterval(state.timers.sceneLighting);
                        }
                        state.timers.sceneLighting = setInterval(() => {
                            applySceneEnvironment(state.sceneView);
                            if (state.rightSceneView) {
                                applySceneEnvironment(state.rightSceneView);
                            }
                        }, CONFIG.SCENE_LIGHTING_UPDATE_INTERVAL_MS);
                    }

                    debugLog('SceneView ready!');
                    resolve();
                } catch (error) {
                    console.error('Error in initArcGIS:', error);
                    debugLog('✗ ArcGIS init error: ' + error.message, true);
                    reject(error);
                }
            })();
        });
    });
}

/**
 * Refresh weather data from APIs
 */
async function refreshWeatherData() {
    try {
        showLoading(true, 'Fetching weather data...');
        debugLog('Fetching weather for ' + state.samplingPoints.length + ' points...');
        
        state.coralGablesLiveWeather = null;

        /** NWS-first merge at the official map center — matches local “live” Coral Gables conditions */
        let canonicalCoralGables = null;
        try {
            canonicalCoralGables = await WeatherService.fetchCurrentWeather(
                CONFIG.CORAL_GABLES_CENTER.latitude,
                CONFIG.CORAL_GABLES_CENTER.longitude,
                { mergePriority: WeatherService.MERGE_PRIORITY_NOAA_FIRST }
            );
            state.coralGablesLiveWeather = canonicalCoralGables;
        } catch (cgErr) {
            debugLog(
                '⚠ Coral Gables (NWS-priority) fetch failed: ' + (cgErr && cgErr.message ? cgErr.message : String(cgErr)),
                true
            );
        }

        // Fetch current weather
        let weatherResults = [];
        try {
            weatherResults = await WeatherService.fetchBatchWeather(
                state.samplingPoints,
                (current, total) => {
                    updateProgress(current, total);
                },
                {
                    mergePriority: WeatherService.MERGE_PRIORITY_DEFAULT,
                    centerWeather: canonicalCoralGables,
                    centerPointId: 'center'
                }
            );
        } catch (fetchError) {
            console.error('Weather fetch failed:', fetchError);
            debugLog('⚠ Weather API error: ' + fetchError.message, true);
            weatherResults = [];
        }
        
        if (!weatherResults || !Array.isArray(weatherResults)) {
            weatherResults = [];
        }
        
        const successful = weatherResults.filter(r => r && r.success).length;
        const failed = weatherResults.filter(r => r && !r.success).length;
        debugLog(`Weather fetch complete: ${successful} success, ${failed} failed`);
        
        // If all failed, use sample data for demonstration
        if (successful === 0) {
            debugLog('⚠ All APIs failed, using sample data for demonstration');
            state.coralGablesLiveWeather = null;
            weatherResults = state.samplingPoints.map((point, index) => ({
                pointId: point.id,
                success: true,
                temperature: 70 + Math.random() * 20, // Random temp 70-90°F
                humidity: 50 + Math.random() * 30,
                windSpeed: Math.random() * 15,
                pressure: 1013 + (Math.random() * 10 - 5),
                source: 'sample-data'
            }));
        }
        
        // Recount after potential sample data
        const finalSuccessful = weatherResults.filter(r => r && r.success).length;
        const finalFailed = state.samplingPoints.length - finalSuccessful;
        
        // Attach weather data to sampling points
        state.samplingPoints = state.samplingPoints.map(point => {
            const weatherData = weatherResults.find(w => w && w.pointId === point.id);
            return { ...point, weatherData };
        });

        if (!state.coralGablesLiveWeather) {
            const centerPt = state.samplingPoints.find((p) => p.id === 'center');
            if (centerPt?.weatherData && typeof centerPt.weatherData.temperature === 'number') {
                state.coralGablesLiveWeather = centerPt.weatherData;
            }
        }
        
        // Interpolate data across grid (only if we have successful data)
        if (finalSuccessful > 0) {
            const valueKeys = ['temperature', 'humidity', 'windSpeed', 'pressure'];
            state.gridCells = interpolateGrid(state.gridCells, state.samplingPoints, valueKeys);
            debugLog(`✓ Interpolated ${state.gridCells.length} cells with ${finalSuccessful} data points`);
        } else {
            debugLog('⚠ No data to interpolate, using defaults');
        }
        
        // Store snapshot
        try {
            if (weatherResults && Array.isArray(weatherResults) && weatherResults.length > 0) {
                await DB.storeWeatherSnapshot(weatherResults);
                // Reload historical snapshots
                state.historicalSnapshots = await TimeFeatures.getHistoricalSnapshots();
                updateSnapshotCount();
            }
        } catch (dbError) {
            console.warn('DB storage failed:', dbError);
        }
        
        // Update visualization with REAL data
        if (state.currentMode === 'split-screen') {
            await updateSplitVisualization();
        } else {
            updateVisualization(state.samplingPoints, state.gridCells);
        }

        syncSceneAtmosphereFromApiWeather();
        debugLog(`✓ Scene sky · live sun · Esri weather=${state.sceneWeatherMode} (from API)`);
        
        // Update UI
        updateDataSourceDisplay(finalSuccessful, finalFailed);
        updateLastUpdateTime();
        updateCoralGablesLiveDisplay();
        
        // Fetch forecasts if not already loaded
        try {
            if (!state.forecastData || state.forecastData.length === 0) {
                fetchForecastData();
            }
        } catch (forecastErr) {
            debugLog('⚠ Forecast fetch skipped: ' + forecastErr.message);
        }
        
        // Check alerts
        try {
            await checkWeatherAlerts();
        } catch (err) {
            debugLog('Alert check failed: ' + err.message);
        }
        
        showLoading(false);
        debugLog('✓ Refresh complete');
        
    } catch (error) {
        console.error('Failed to refresh weather data:', error);
        debugLog('✗ Refresh failed: ' + error.message, true);
        
        // Update UI with error state
        showError('Weather refresh failed. Displaying last known data.');
        updateDataSourceDisplay(0, state.samplingPoints.length);
        showLoading(false);
    }
}

/**
 * Fetch forecast data
 */
async function fetchForecastData() {
    try {
        debugLog('Fetching forecast data...');
        state.forecastData = await WeatherService.fetchBatchForecast(state.samplingPoints);
        debugLog(`✓ Forecast data loaded for ${state.forecastData.length} points`);
    } catch (error) {
        console.error('Forecast fetch failed:', error);
        debugLog('⚠ Forecast unavailable');
    }
}

/**
 * Map temperature to scene Z using min/max across the grid so tiny spreads (e.g. 0.1°F) use full relief.
 */
function tempToReliefElevation(temp, minT, maxT, range) {
    const base = CONFIG.GRID_BASE_ELEVATION_METERS;
    const amp = CONFIG.GRID_TEMP_RELIEF_METERS;
    const eps = CONFIG.GRID_TEMP_RANGE_EPSILON;
    if (temp == null || Number.isNaN(temp)) {
        return base + amp * 0.5;
    }
    if (range < eps) {
        return base + amp * 0.5;
    }
    const n = (temp - minT) / Math.max(range, eps);
    return base + n * amp;
}

/**
 * Per-corner temperatures (IDW) + global min/max for consistent relief scaling and crumpled quads.
 */
function buildGridReliefGeometry(gridCells, samplingPoints, idwPower = 2) {
    const cornerSpecs = gridCells.map((cell) => {
        const latlons = [
            [cell.bounds.south, cell.bounds.west],
            [cell.bounds.south, cell.bounds.east],
            [cell.bounds.north, cell.bounds.east],
            [cell.bounds.north, cell.bounds.west]
        ];
        const cornerTemps = latlons.map(([lat, lon]) =>
            interpolate(lat, lon, samplingPoints, 'temperature', idwPower)
        );
        return { cell, cornerTemps };
    });

    const allTemps = [];
    for (const { cell, cornerTemps } of cornerSpecs) {
        const c = cell.interpolatedData?.temperature;
        if (c != null && !Number.isNaN(c)) {
            allTemps.push(c);
        }
        for (const t of cornerTemps) {
            if (t != null && !Number.isNaN(t)) {
                allTemps.push(t);
            }
        }
    }

    if (allTemps.length === 0) {
        return null;
    }

    const minT = Math.min(...allTemps);
    const maxT = Math.max(...allTemps);
    const range = maxT - minT;

    return { cornerSpecs, minT, maxT, range };
}

/**
 * Update visualization (with real or default data)
 */
function updateVisualization(samplingPoints, gridCells, layersOverride = null) {
    // Safety checks
    if (!samplingPoints || !Array.isArray(samplingPoints)) {
        debugLog('⚠ Invalid samplingPoints in updateVisualization');
        samplingPoints = [];
    }
    if (!gridCells || !Array.isArray(gridCells)) {
        debugLog('⚠ Invalid gridCells in updateVisualization');
        gridCells = [];
    }
    
    require([
        'esri/Graphic',
        'esri/geometry/Point',
        'esri/geometry/Polygon',
        'esri/symbols/SimpleMarkerSymbol',
        'esri/symbols/SimpleFillSymbol',
        'esri/PopupTemplate'
    ], (Graphic, Point, Polygon, SimpleMarkerSymbol, SimpleFillSymbol, PopupTemplate) => {
        
        try {
            const layers = layersOverride || state.layers;
            if (!layers || !layers.grid || !layers.points) {
                debugLog('⚠ Layers not ready');
                return;
            }
            
            layers.grid.removeAll();
            layers.points.removeAll();
            
            let pointsAdded = 0;
            let cellsAdded = 0;
        
            // Add sampling points
            if (samplingPoints && samplingPoints.length > 0) {
                samplingPoints.forEach(point => {
                    if (!point || !point.weatherData || point.weatherData.error) return;
                    
                    try {
                        const graphic = new Graphic({
                geometry: new Point({
                    longitude: point.longitude,
                    latitude: point.latitude,
                    z: 50
                }),
                symbol: new SimpleMarkerSymbol({
                    color: [255, 255, 255],
                    size: 12,
                    outline: { color: [0, 0, 0], width: 2 }
                }),
                attributes: {
                    pointId: point.id,
                    temperature: (point.weatherData.temperature || 0).toFixed(1),
                    feelsLike: (point.weatherData.feelsLike || 0).toFixed(1),
                    humidity: (point.weatherData.humidity || 0).toFixed(0),
                    pressure: (point.weatherData.pressure || 0).toFixed(0),
                    windSpeed: (point.weatherData.windSpeed || 0).toFixed(1),
                    windDirection: (point.weatherData.windDirection || 0).toFixed(0),
                    windGust: point.weatherData.windGust ? point.weatherData.windGust.toFixed(1) : '--',
                    precipitation: (point.weatherData.precipitation || 0).toFixed(2),
                    cloudCover: (point.weatherData.cloudCover || 0).toFixed(0),
                    visibility: (point.weatherData.visibility || 0).toFixed(0),
                    weather: point.weatherData.weather || '--',
                    weatherDescription: point.weatherData.weatherDescription || '--',
                    source: point.weatherData.source || 'Unknown'
                },
                popupTemplate: new PopupTemplate({
                    title: `Sample: ${point.id}`,
                    content: `
                        <b>Temperature:</b> {temperature}°F<br>
                        <b>Feels Like:</b> {feelsLike}°F<br>
                        <b>Humidity:</b> {humidity}%<br>
                        <b>Pressure:</b> {pressure} mb<br>
                        <b>Wind Speed:</b> {windSpeed} mph<br>
                        <b>Wind Direction:</b> {windDirection}°<br>
                        <b>Wind Gust:</b> {windGust} mph<br>
                        <b>Precipitation:</b> {precipitation} mm<br>
                        <b>Cloud Cover:</b> {cloudCover}%<br>
                        <b>Visibility:</b> {visibility} m<br>
                        <b>Condition:</b> {weather} ({weatherDescription})<br>
                        <b>Source:</b> {source}
                    `
                })
            });
                        
                        layers.points.add(graphic);
                        pointsAdded++;
                    } catch (pointErr) {
                        console.error('Error adding point:', pointErr);
                    }
                });
            }
            
            // Add grid cells with interpolated data (min/max-normalized relief + per-corner Z for crumpling)
            if (gridCells && gridCells.length > 0) {
                const relief = buildGridReliefGeometry(gridCells, samplingPoints, 2);
                const flatZ =
                    CONFIG.GRID_BASE_ELEVATION_METERS + CONFIG.GRID_TEMP_RELIEF_METERS * 0.5;

                gridCells.forEach((cell, index) => {
                    if (!cell || !cell.bounds) return;
                    
                    try {
            let temp = 75; // Default
                    let meanCornerZ = flatZ;
                    let color = [0, 255, 0];
                    let hasData = false;
                    
                    if (cell.interpolatedData && cell.interpolatedData.temperature != null) {
                        temp = cell.interpolatedData.temperature;
                hasData = true;
            }

            let ring;
            if (hasData && relief) {
                const spec = relief.cornerSpecs[index];
                const cornerZs = spec.cornerTemps.map((t) =>
                    tempToReliefElevation(t, relief.minT, relief.maxT, relief.range)
                );
                meanCornerZ =
                    cornerZs.reduce((a, b) => a + b, 0) / Math.max(cornerZs.length, 1);
                ring = [
                    [cell.bounds.west, cell.bounds.south, cornerZs[0]],
                    [cell.bounds.east, cell.bounds.south, cornerZs[1]],
                    [cell.bounds.east, cell.bounds.north, cornerZs[2]],
                    [cell.bounds.west, cell.bounds.north, cornerZs[3]],
                    [cell.bounds.west, cell.bounds.south, cornerZs[0]]
                ];
            } else {
                const z = flatZ;
                ring = [
                    [cell.bounds.west, cell.bounds.south, z],
                    [cell.bounds.east, cell.bounds.south, z],
                    [cell.bounds.east, cell.bounds.north, z],
                    [cell.bounds.west, cell.bounds.north, z],
                    [cell.bounds.west, cell.bounds.south, z]
                ];
            }
            
            const polygon = new Polygon({
                rings: [ring],
                spatialReference: { wkid: 4326 }
            });
            
                    const graphic = new Graphic({
                        geometry: polygon,
                        symbol: new SimpleFillSymbol({
                            color: hasData ? [...color, 0] : [128, 128, 128, 0],
                            outline: { color: hasData ? [...color, 255] : [128, 128, 128, 255], width: 2 }
                        }),
                attributes: {
                    cellId: cell.id,
                    gridRow: cell.row,
                    gridCol: cell.col,
                    temperature: temp.toFixed(1),
                    humidity: cell.interpolatedData?.humidity?.toFixed(1) || '--',
                    windSpeed: cell.interpolatedData?.windSpeed?.toFixed(1) || '--',
                    pressure: cell.interpolatedData?.pressure?.toFixed(1) || '--',
                    elevation: meanCornerZ.toFixed(0),
                    hasData: hasData
                },
                popupTemplate: new PopupTemplate({
                    title: 'Grid Cell',
                    content: hasData ? 
                        `<b>Temperature:</b> {temperature}°F<br>
                         <b>Humidity:</b> {humidity}%<br>
                         <b>Wind Speed:</b> {windSpeed} mph<br>
                         <b>Pressure:</b> {pressure} mb<br>
                         <b>Elevation:</b> {elevation} m` 
                        : '<i>No data</i>'
                })
            });
                    
                        layers.grid.add(graphic);
                        cellsAdded++;
                    } catch (cellErr) {
                        console.error('Error adding cell:', cellErr);
                    }
                });
            }
            
            debugLog(`✓ Visualization: ${pointsAdded} points, ${cellsAdded} cells`);
            
            // Render wind vectors
            renderWindVectors(samplingPoints, layersOverride);
            
        } catch (vizError) {
            console.error('Visualization error:', vizError);
            debugLog('✗ Visualization failed: ' + vizError.message, true);
        }
    });
}

/**
 * Render wind vectors based on sampling points
 */
function renderWindVectors(samplingPoints, layersOverride = null) {
    if (!samplingPoints || !Array.isArray(samplingPoints)) return;
    const layers = layersOverride || state.layers;
    if (!layers || !layers.wind) return;
    
    require([
        'esri/Graphic',
        'esri/geometry/Polyline',
        'esri/symbols/SimpleLineSymbol'
    ], (Graphic, Polyline, SimpleLineSymbol) => {
        try {
            layers.wind.removeAll();
            let vectorsAdded = 0;
            
            samplingPoints.forEach(point => {
                if (!point || !point.weatherData || !point.weatherData.windSpeed) return;
                
                try {
                    const windSpeed = point.weatherData.windSpeed || 0;
                    const windDirection = point.weatherData.windDirection || 0;
                    
                    // Scale arrow length based on wind speed (0-40 mph → 0.0005-0.003 degrees)
                    const arrowLength = Math.min(0.003, (windSpeed / 40) * 0.003);
                    
                    // Convert wind direction to radians (0° = north, 90° = east)
                    const directionRad = (windDirection * Math.PI) / 180;
                    
                    // Calculate end point (wind blows FROM this direction, draw arrow pointing that way)
                    const endLat = point.latitude + arrowLength * Math.cos(directionRad);
                    const endLon = point.longitude + arrowLength * Math.sin(directionRad);
                    
                    // Wind speed color gradient (0-50 mph)
                    let windColor = [0, 255, 0]; // Green for light wind
                    if (windSpeed > 10) windColor = [255, 165, 0]; // Orange for moderate
                    if (windSpeed > 20) windColor = [255, 69, 0]; // Red-orange for strong
                    if (windSpeed > 30) windColor = [255, 0, 0]; // Red for very strong
                    
                    // Create polyline from point to end point
                    const polyline = new Polyline({
                        paths: [[
                            [point.longitude, point.latitude, 100],
                            [endLon, endLat, 100]
                        ]],
                        spatialReference: { wkid: 4326 }
                    });
                    
                    const lineSymbol = new SimpleLineSymbol({
                        color: windColor,
                        width: Math.max(1, windSpeed / 10), // Thicker for stronger winds
                        cap: 'round',
                        join: 'round'
                    });
                    
                    const graphic = new Graphic({
                        geometry: polyline,
                        symbol: lineSymbol,
                        attributes: {
                            windSpeed: windSpeed,
                            windDirection: windDirection,
                            pointId: point.id
                        }
                    });
                    
                    layers.wind.add(graphic);
                    vectorsAdded++;
                    
                } catch (err) {
                    console.error('Error adding wind vector:', err);
                }
            });
            
            if (vectorsAdded > 0) {
                debugLog(`💨 Wind vectors: ${vectorsAdded} arrows rendered`);
            }
            
        } catch (windErr) {
            console.error('Wind rendering error:', windErr);
        }
    });
}

/**
 * Temperature to color conversion
 */
function temperatureToColor(temp) {
    const gradient = CONFIG.TEMP_COLOR_GRADIENT;
    
    for (let i = 0; i < gradient.length - 1; i++) {
        if (temp >= gradient[i].temp && temp <= gradient[i + 1].temp) {
            const t = (temp - gradient[i].temp) / (gradient[i + 1].temp - gradient[i].temp);
            return [
                Math.round(gradient[i].color[0] + t * (gradient[i + 1].color[0] - gradient[i].color[0])),
                Math.round(gradient[i].color[1] + t * (gradient[i + 1].color[1] - gradient[i].color[1])),
                Math.round(gradient[i].color[2] + t * (gradient[i + 1].color[2] - gradient[i].color[2]))
            ];
        }
    }
    
    return temp < gradient[0].temp ? gradient[0].color : gradient[gradient.length - 1].color;
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
    const wireCollapsiblePanel = (panelId, btnId, titleWhenCollapsed, titleWhenExpanded) => {
        const panel = document.getElementById(panelId);
        const btn = document.getElementById(btnId);
        if (!panel || !btn) {
            return;
        }
        const sync = () => {
            const min = panel.classList.contains('panel--minimized');
            btn.setAttribute('aria-expanded', min ? 'false' : 'true');
            btn.textContent = min ? '+' : '−';
            btn.title = min ? titleWhenCollapsed : titleWhenExpanded;
        };
        btn.addEventListener('click', () => {
            panel.classList.toggle('panel--minimized');
            sync();
        });
        sync();
    };
    wireCollapsiblePanel(
        'controlPanel',
        'controlPanelMinBtn',
        'Show controls',
        'Hide controls'
    );
    wireCollapsiblePanel(
        'legendPanel',
        'legendPanelMinBtn',
        'Show temperature scale & legend',
        'Hide temperature scale & legend'
    );

    // Mode selector
    document.getElementById('modeSelector').addEventListener('change', (e) => {
        handleModeChange(e.target.value);
    });
    
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        refreshWeatherData();
    });
    
    // Layer toggles
    document.getElementById('toggleGrid').addEventListener('change', (e) => {
        const v = e.target.checked;
        if (state.layers.grid) state.layers.grid.visible = v;
        if (state.layers.splitGrid) state.layers.splitGrid.visible = v;
    });
    
    document.getElementById('togglePoints').addEventListener('change', (e) => {
        const v = e.target.checked;
        if (state.layers.points) state.layers.points.visible = v;
        if (state.layers.splitPoints) state.layers.splitPoints.visible = v;
    });
    
    document.getElementById('toggleWind').addEventListener('change', (e) => {
        const v = e.target.checked;
        if (state.layers.wind) {
            state.layers.wind.visible = v;
            debugLog(`💨 Wind vectors ${v ? 'enabled' : 'disabled'}`);
        }
        if (state.layers.splitWind) {
            state.layers.splitWind.visible = v;
        }
    });
    
    // Playback controls
    document.getElementById('playBtn').addEventListener('click', startPlayback);
    document.getElementById('pauseBtn').addEventListener('click', pausePlayback);
    document.getElementById('speedSelector').addEventListener('change', (e) => {
        changePlaybackSpeed(parseInt(e.target.value));
    });
    document.getElementById('timelineSlider').addEventListener('input', (e) => {
        seekPlayback(parseInt(e.target.value));
    });
    
    // Split-screen controls
    const swapBtn = document.getElementById('swapViews');
    if (swapBtn) {
        swapBtn.addEventListener('click', swapSplitViews);
    }
    const leftViewModeEl = document.getElementById('leftViewMode');
    const rightViewModeEl = document.getElementById('rightViewMode');
    const onSplitModeSelectChange = () => {
        if (state.currentMode === 'split-screen') {
            void updateSplitVisualization();
        }
    };
    if (leftViewModeEl) {
        leftViewModeEl.addEventListener('change', onSplitModeSelectChange);
    }
    if (rightViewModeEl) {
        rightViewModeEl.addEventListener('change', onSplitModeSelectChange);
    }
    
    // Alert dismiss
    document.getElementById('dismissAlert').addEventListener('click', () => {
        document.getElementById('alertBanner').classList.add('hidden');
    });
    
    debugLog('Event listeners registered');
}

/**
 * Handle mode change
 */
function handleModeChange(mode) {
    if (state.currentMode === 'split-screen' && mode !== 'split-screen') {
        teardownSplitScreen();
    }

    state.currentMode = mode;
    
    document.getElementById('playbackControls').classList.add('hidden');
    document.getElementById('splitScreenControls').classList.toggle('hidden', mode !== 'split-screen');
    document.getElementById('viewDiv').classList.remove('hidden');
    document.getElementById('splitViewContainer').classList.toggle('hidden', mode !== 'split-screen');

    document.getElementById('currentModeText').textContent = mode.replace('-', ' ').toUpperCase();

    if (mode === 'historical') {
        document.getElementById('playbackControls').classList.remove('hidden');
        initializePlayback();
    } else if (mode === 'split-screen') {
        initializeSplitScreen();
    } else if (mode === 'forecast-3h') {
        showForecast(3);
    } else if (mode === 'forecast-24h') {
        showForecast(24);
    } else {
        // Current mode
        updateVisualization(state.samplingPoints, state.gridCells);
    }
    
    debugLog(`Mode changed to: ${mode}`);
}

/**
 * Initialize playback mode
 */
function initializePlayback() {
    if (state.historicalSnapshots.length === 0) {
        showError('No historical data available yet. Data collection starts now.');
        return;
    }
    
    if (state.playbackController) {
        state.playbackController.destroy();
    }
    
    state.playbackController = new TimeFeatures.PlaybackController(
        state.historicalSnapshots,
        (snapshot, index, total) => {
            updatePlaybackUI(snapshot, index, total);
            applySnapshotToVisualization(snapshot);
        }
    );
    
    // Start at most recent
    state.playbackController.seek(state.historicalSnapshots.length - 1);
    
    debugLog('Playback initialized');
}

/**
 * Show forecast mode
 */
function showForecast(hoursAhead) {
    if (!state.forecastData || state.forecastData.length === 0) {
        showError('Forecast data not available. Fetching...');
        fetchForecastData();
        return;
    }
    
    const forecastPoints = TimeFeatures.getForecastData(state.forecastData, hoursAhead);
    
    // Update sampling points with forecast data
    const forecastSamplingPoints = state.samplingPoints.map(point => {
        const forecastData = forecastPoints.find(f => f.pointId === point.id);
        return { ...point, weatherData: forecastData };
    });
    
    // Interpolate
    const valueKeys = ['temperature', 'humidity', 'windSpeed', 'pressure'];
    const forecastGridCells = interpolateGrid(state.gridCells, forecastSamplingPoints, valueKeys);
    
    // Update visualization
    updateVisualization(forecastSamplingPoints, forecastGridCells);
    
    debugLog(`Showing ${hoursAhead}h forecast`);
}

/**
 * Build sampling points + interpolated grid for one split-pane mode.
 * Modes match #leftViewMode / #rightViewMode values.
 */
function getSamplingPointsAndGridForSplitMode(mode) {
    const valueKeys = ['temperature', 'humidity', 'windSpeed', 'pressure'];
    if (mode === 'current') {
        return { samplingPoints: state.samplingPoints, gridCells: state.gridCells };
    }
    if (mode === 'forecast-3h' || mode === 'forecast-24h') {
        if (!state.forecastData || state.forecastData.length === 0) {
            return null;
        }
        const hours = mode === 'forecast-3h' ? 3 : 24;
        const forecastPoints = TimeFeatures.getForecastData(state.forecastData, hours);
        if (!forecastPoints || forecastPoints.length === 0) {
            return null;
        }
        const forecastSamplingPoints = state.samplingPoints.map((point) => {
            const forecastData = forecastPoints.find((f) => f.pointId === point.id);
            return { ...point, weatherData: forecastData };
        });
        const forecastGridCells = interpolateGrid(
            state.gridCells,
            forecastSamplingPoints,
            valueKeys
        );
        return { samplingPoints: forecastSamplingPoints, gridCells: forecastGridCells };
    }
    if (mode === 'historical') {
        if (!state.historicalSnapshots || state.historicalSnapshots.length === 0) {
            return null;
        }
        const target = Date.now() - 24 * 60 * 60 * 1000;
        const snap = TimeFeatures.getSnapshotAtTime(state.historicalSnapshots, target);
        if (!snap) {
            return null;
        }
        const snapshotPoints = state.samplingPoints.map((point) => {
            const data = snap.data.find((d) => d.pointId === point.id);
            return { ...point, weatherData: data };
        });
        const snapshotGridCells = interpolateGrid(state.gridCells, snapshotPoints, valueKeys);
        return { samplingPoints: snapshotPoints, gridCells: snapshotGridCells };
    }
    return null;
}

function updateSplitViewLabels() {
    const leftSel = document.getElementById('leftViewMode');
    const rightSel = document.getElementById('rightViewMode');
    const leftEl = document.getElementById('leftView');
    const rightEl = document.getElementById('rightView');
    if (leftSel && leftEl && leftSel.selectedOptions[0]) {
        leftEl.setAttribute('data-label', leftSel.selectedOptions[0].textContent.trim());
    }
    if (rightSel && rightEl && rightSel.selectedOptions[0]) {
        rightEl.setAttribute('data-label', rightSel.selectedOptions[0].textContent.trim());
    }
}

async function updateSplitVisualization() {
    clearSplitLinkedSelectionVisual();

    const leftMode = document.getElementById('leftViewMode')?.value || 'current';
    const rightMode = document.getElementById('rightViewMode')?.value || 'forecast-3h';

    const needsForecast =
        leftMode === 'forecast-3h' ||
        leftMode === 'forecast-24h' ||
        rightMode === 'forecast-3h' ||
        rightMode === 'forecast-24h';
    if (needsForecast && (!state.forecastData || state.forecastData.length === 0)) {
        await fetchForecastData();
    }

    const leftData = getSamplingPointsAndGridForSplitMode(leftMode);
    const rightData = getSamplingPointsAndGridForSplitMode(rightMode);

    if (!leftData || !rightData) {
        showError(
            'Split compare needs data for both sides. Try Refresh, choose Current where needed, or wait for forecast/history.'
        );
        return;
    }

    const rightLayers = {
        grid: state.layers.splitGrid,
        points: state.layers.splitPoints,
        wind: state.layers.splitWind
    };
    if (!rightLayers.grid || !rightLayers.points) {
        debugLog('⚠ Split layers not ready yet');
        return;
    }

    updateVisualization(leftData.samplingPoints, leftData.gridCells);
    updateVisualization(rightData.samplingPoints, rightData.gridCells, rightLayers);
    updateSplitViewLabels();
}

function findGraphicByAttribute(layer, attrKey, attrVal) {
    if (!layer?.graphics || attrVal === undefined || attrVal === null) {
        return null;
    }
    for (const g of layer.graphics) {
        if (g.attributes && g.attributes[attrKey] === attrVal) {
            return g;
        }
    }
    return null;
}

function clearSplitLinkedSelectionVisual() {
    const pairs = state.splitSelectionRestore || [];
    for (const { graphic, symbol } of pairs) {
        try {
            if (graphic && symbol) {
                graphic.symbol = symbol;
            }
        } catch (e) {
            /* graphic may have been removed from layer */
        }
    }
    state.splitSelectionRestore = [];
}

function applySplitLinkedHighlight(graphic) {
    if (!graphic?.symbol || typeof graphic.symbol.clone !== 'function') {
        return;
    }
    try {
        const prev = graphic.symbol.clone();
        state.splitSelectionRestore.push({ graphic, symbol: prev });
        const h = graphic.symbol.clone();
        const accent = [255, 193, 7, 255];
        if (h.type === 'simple-marker') {
            h.size = Math.max(Number(h.size) || 12, 16) + 2;
            h.outline = { color: accent, width: 3 };
        } else if (h.type === 'simple-fill') {
            const w = h.outline?.width != null ? Number(h.outline.width) : 1;
            h.outline = {
                color: accent,
                width: Math.max(w + 2, 4)
            };
        }
        graphic.symbol = h;
    } catch (e) {
        console.warn('applySplitLinkedHighlight:', e);
    }
}

function unwireSplitLinkedSelection() {
    for (const h of state.splitInteractionHandles || []) {
        try {
            if (typeof h?.remove === 'function') {
                h.remove();
            }
        } catch (e) {
            /* ignore */
        }
    }
    state.splitInteractionHandles = [];
    clearSplitLinkedSelectionVisual();
    try {
        state.sceneView?.popup?.close();
    } catch (e) {
        /* ignore */
    }
    try {
        state.rightSceneView?.popup?.close();
    } catch (e) {
        /* ignore */
    }
    try {
        if (state.sceneView?.popup && 'autoOpenEnabled' in state.sceneView.popup) {
            state.sceneView.popup.autoOpenEnabled = true;
        }
    } catch (e) {
        /* ignore */
    }
    try {
        if (state.rightSceneView?.popup && 'autoOpenEnabled' in state.rightSceneView.popup) {
            state.rightSceneView.popup.autoOpenEnabled = true;
        }
    } catch (e) {
        /* ignore */
    }
}

async function handleSplitLinkedClick(clickedView, isLeftPane, event) {
    if (state.splitClickHandling) {
        return;
    }
    if (state.currentMode !== 'split-screen' || !state.rightSceneView) {
        return;
    }

    const otherView = isLeftPane ? state.rightSceneView : state.sceneView;
    const ptLayer = isLeftPane ? state.layers.points : state.layers.splitPoints;
    const gridLayer = isLeftPane ? state.layers.grid : state.layers.splitGrid;
    const otherPtLayer = isLeftPane ? state.layers.splitPoints : state.layers.points;
    const otherGridLayer = isLeftPane ? state.layers.splitGrid : state.layers.grid;

    state.splitClickHandling = true;
    state.splitSuppressCameraSync = true;
    try {
        let response;
        try {
            response = await clickedView.hitTest(event, { include: [ptLayer, gridLayer] });
        } catch (e) {
            return;
        }
        const results = response?.results || [];
        const hit = results.find((r) => {
            if (!r?.graphic) {
                return false;
            }
            const lyr = r.graphic.layer || r.layer;
            return lyr === ptLayer || lyr === gridLayer;
        });
        const hitGraphic = hit?.graphic;

        if (!hitGraphic) {
            clearSplitLinkedSelectionVisual();
            try {
                clickedView.popup?.close();
            } catch (e) {
                /* ignore */
            }
            try {
                otherView?.popup?.close();
            } catch (e) {
                /* ignore */
            }
            return;
        }

        const attrs = hitGraphic.attributes || {};
        let matchOther = null;
        if (attrs.pointId) {
            matchOther = findGraphicByAttribute(otherPtLayer, 'pointId', attrs.pointId);
        } else if (attrs.cellId) {
            matchOther = findGraphicByAttribute(otherGridLayer, 'cellId', attrs.cellId);
        }

        clearSplitLinkedSelectionVisual();
        applySplitLinkedHighlight(hitGraphic);
        if (matchOther) {
            applySplitLinkedHighlight(matchOther);
        }

        try {
            otherView?.popup?.close();
        } catch (e) {
            /* ignore */
        }

        /** SceneView hit results carry mapPoint on the hit; event.mapPoint is often missing for 3D graphics. */
        const hitMapPoint = hit && hit.mapPoint != null ? hit.mapPoint : null;
        let loc = hitMapPoint || event.mapPoint;
        if (!loc && hitGraphic.geometry) {
            try {
                const geom = hitGraphic.geometry;
                if (geom.type === 'point') {
                    loc = geom;
                } else if (geom.extent && typeof geom.extent.center !== 'undefined') {
                    loc = geom.extent.center;
                } else if (geom.centroid) {
                    loc = geom.centroid;
                }
            } catch (e) {
                /* ignore */
            }
        }
        if (!loc) {
            return;
        }
        try {
            await clickedView.popup.open({
                features: [hitGraphic],
                location: loc
            });
        } catch (e) {
            console.warn('split popup:', e);
        }

        if (matchOther && otherView) {
            let otherLoc = null;
            try {
                const g = matchOther.geometry;
                if (g) {
                    if (g.type === 'point') {
                        otherLoc = g;
                    } else if (g.extent && g.extent.center) {
                        otherLoc = g.extent.center;
                    } else if (g.centroid) {
                        otherLoc = g.centroid;
                    }
                }
            } catch (e) {
                /* ignore */
            }
            if (otherLoc) {
                try {
                    await otherView.popup.open({
                        features: [matchOther],
                        location: otherLoc
                    });
                } catch (e) {
                    console.warn('split linked-pane popup:', e);
                }
            }
        }
    } finally {
        state.splitSuppressCameraSync = false;
        state.splitClickHandling = false;
    }
}

function wireSplitLinkedSelection() {
    unwireSplitLinkedSelection();
    if (!state.sceneView || !state.rightSceneView) {
        return;
    }
    try {
        if (state.sceneView.popup && 'autoOpenEnabled' in state.sceneView.popup) {
            state.sceneView.popup.autoOpenEnabled = false;
        }
        if (state.rightSceneView.popup && 'autoOpenEnabled' in state.rightSceneView.popup) {
            state.rightSceneView.popup.autoOpenEnabled = false;
        }
    } catch (e) {
        /* ignore */
    }
    const h1 = state.sceneView.on('immediate-click', (e) => {
        void handleSplitLinkedClick(state.sceneView, true, e);
    });
    const h2 = state.rightSceneView.on('immediate-click', (e) => {
        void handleSplitLinkedClick(state.rightSceneView, false, e);
    });
    state.splitInteractionHandles = [h1, h2];
}

function restoreMainViewDivToApp() {
    const app = document.getElementById('app');
    const splitEl = document.getElementById('splitViewContainer');
    const viewDiv = document.getElementById('viewDiv');
    if (!app || !splitEl || !viewDiv) {
        return;
    }
    if (viewDiv.parentNode !== app) {
        app.insertBefore(viewDiv, splitEl);
    }
    viewDiv.classList.remove('hidden');
}

/** Move #viewDiv into the left split cell — keeps SceneView’s original container (reliable vs reassigning .container). */
function reparentMainViewIntoSplitLeft() {
    const left = document.getElementById('leftView');
    const viewDiv = document.getElementById('viewDiv');
    if (!left || !viewDiv) {
        return;
    }
    viewDiv.classList.remove('hidden');
    left.appendChild(viewDiv);
}

function clearSplitCameraWatches() {
    if (state.splitCameraWatchHandle) {
        try {
            if (typeof state.splitCameraWatchHandle.remove === 'function') {
                state.splitCameraWatchHandle.remove();
            }
        } catch (e) {
            /* ignore */
        }
        state.splitCameraWatchHandle = null;
    }
    if (state.splitCameraWatchHandleRight) {
        try {
            if (typeof state.splitCameraWatchHandleRight.remove === 'function') {
                state.splitCameraWatchHandleRight.remove();
            }
        } catch (e) {
            /* ignore */
        }
        state.splitCameraWatchHandleRight = null;
    }
}

/** True when follower view already matches leader (avoids ping-pong without timers). */
function splitSceneCamerasMatch(leaderView, followerView) {
    const a = leaderView?.camera;
    const b = followerView?.camera;
    if (!a?.position || !b?.position) {
        return false;
    }
    const pa = a.position;
    const pb = b.position;
    const elon = 1e-7;
    const elat = 1e-7;
    const ez = 0.25;
    const eang = 0.015;
    const sameLon =
        typeof pa.longitude === 'number' &&
        typeof pb.longitude === 'number' &&
        Math.abs(pa.longitude - pb.longitude) < elon;
    const sameLat =
        typeof pa.latitude === 'number' &&
        typeof pb.latitude === 'number' &&
        Math.abs(pa.latitude - pb.latitude) < elat;
    const sameZ =
        (pa.z == null && pb.z == null) ||
        (typeof pa.z === 'number' &&
            typeof pb.z === 'number' &&
            Math.abs(pa.z - pb.z) < ez);
    const sameTilt =
        Math.abs((a.tilt ?? 0) - (b.tilt ?? 0)) < eang;
    const sameHead =
        Math.abs((a.heading ?? 0) - (b.heading ?? 0)) < eang;
    return sameLon && sameLat && sameZ && sameTilt && sameHead;
}

function wireSplitCameraBidirectional() {
    clearSplitCameraWatches();
    if (!state.sceneView || !state.rightSceneView) {
        return;
    }

    const syncViewpoint = (fromView, toView) => {
        if (state.splitSuppressCameraSync || state.splitCameraSyncing) {
            return;
        }
        if (state.currentMode !== 'split-screen' || !fromView || !toView) {
            return;
        }
        if (splitSceneCamerasMatch(fromView, toView)) {
            return;
        }
        const vp = fromView.viewpoint;
        if (!vp) {
            return;
        }
        state.splitCameraSyncing = true;
        const done = () => {
            state.splitCameraSyncing = false;
        };
        toView
            .goTo(vp.clone(), { duration: 0 })
            .catch(() => {})
            .then(done, done);
    };

    state.splitCameraWatchHandle = state.sceneView.watch('viewpoint', () => {
        syncViewpoint(state.sceneView, state.rightSceneView);
    });
    state.splitCameraWatchHandleRight = state.rightSceneView.watch('viewpoint', () => {
        syncViewpoint(state.rightSceneView, state.sceneView);
    });
}

function clearSplitRightInternalWatches() {
    for (const h of state.splitRightInternalWatchHandles || []) {
        try {
            if (typeof h?.remove === 'function') {
                h.remove();
            }
        } catch (e) {
            /* ignore */
        }
    }
    state.splitRightInternalWatchHandles = [];
}

function teardownSplitScreen() {
    state.splitScreenEpoch += 1;
    state.splitCameraSyncing = false;
    unwireSplitLinkedSelection();
    clearSplitCameraWatches();
    clearSplitRightInternalWatches();
    if (state.rightSceneView) {
        try {
            state.rightSceneView.destroy();
        } catch (e) {
            console.warn('rightSceneView.destroy:', e);
        }
        state.rightSceneView = null;
    }
    restoreMainViewDivToApp();
    if (state.sceneView && typeof state.sceneView.resize === 'function') {
        try {
            requestAnimationFrame(() => state.sceneView.resize());
        } catch (e) {
            /* ignore */
        }
    }
}

/**
 * Initialize split-screen mode
 */
function initializeSplitScreen() {
    const initEpoch = (state.splitScreenEpoch += 1);
    const splitEl = document.getElementById('splitViewContainer');
    splitEl.classList.remove('hidden');
    reparentMainViewIntoSplitLeft();

    const splitStillValid = () =>
        initEpoch === state.splitScreenEpoch && state.currentMode === 'split-screen';

    const E = state.esriSplit;
    if (!E?.WebScene || !E?.SceneView || !E?.GraphicsLayer) {
        showError('Map is still loading. Wait for the scene to finish, then try Split-Screen again.');
        state.splitScreenEpoch += 1;
        splitEl.classList.add('hidden');
        document.getElementById('splitScreenControls').classList.add('hidden');
        state.currentMode = 'current';
        const selEarly = document.getElementById('modeSelector');
        if (selEarly) {
            selEarly.value = 'current';
        }
        restoreMainViewDivToApp();
        try {
            if (state.sceneView && typeof state.sceneView.resize === 'function') {
                requestAnimationFrame(() => state.sceneView.resize());
            }
        } catch (e) {
            /* ignore */
        }
        return;
    }

    const { WebScene, SceneView, GraphicsLayer, Zoom, Compass, NavigationToggle, Home } = E;

    void (async () => {
            try {
                if (!splitStillValid()) {
                    return;
                }
                if (!state.splitMap) {
                    const portalItem = { id: CONFIG.ARCGIS_WEBSCENE_ID };
                    if (CONFIG.ARCGIS_PORTAL_URL) {
                        portalItem.portal = { url: CONFIG.ARCGIS_PORTAL_URL };
                    }
                    state.splitMap = new WebScene({ portalItem });
                    state.layers.splitGrid = new GraphicsLayer({
                        title: 'Weather Grid (compare)',
                        elevationInfo: { mode: 'absolute-height' }
                    });
                    state.layers.splitPoints = new GraphicsLayer({
                        title: 'Sampling Points (compare)',
                        elevationInfo: { mode: 'absolute-height' }
                    });
                    state.layers.splitWind = new GraphicsLayer({
                        title: 'Wind (compare)',
                        elevationInfo: { mode: 'absolute-height' },
                        visible: state.layers.wind ? state.layers.wind.visible : false
                    });
                    state.splitMap.addMany([
                        state.layers.splitGrid,
                        state.layers.splitPoints,
                        state.layers.splitWind
                    ]);
                } else if (state.layers.splitWind && state.layers.wind) {
                    state.layers.splitWind.visible = state.layers.wind.visible;
                }

                const leftEl = document.getElementById('leftView');
                if (!leftEl) {
                    throw new Error('leftView missing');
                }
                if (!leftEl.contains(document.getElementById('viewDiv'))) {
                    reparentMainViewIntoSplitLeft();
                }

                const rightContainer = document.getElementById('rightView');
                if (!rightContainer) {
                    throw new Error('rightView container missing');
                }

                if (!state.rightSceneView) {
                    state.rightSceneView = new SceneView({
                        container: rightContainer,
                        map: state.splitMap,
                        viewingMode: 'global',
                        qualityProfile: getSceneQualityProfile(),
                        camera: state.sceneView.camera.clone(),
                        popup: {
                            dockEnabled: false,
                            dockOptions: {
                                buttonEnabled: false
                            },
                            alignment: 'auto',
                            collapseEnabled: false
                        }
                    });

                    await state.splitMap.when();
                    if (!splitStillValid() || !state.rightSceneView) {
                        return;
                    }
                    if (typeof state.splitMap.loadAll === 'function') {
                        try {
                            await state.splitMap.loadAll();
                        } catch (e) {
                            console.warn('splitMap.loadAll:', e);
                        }
                    }
                    if (!splitStillValid() || !state.rightSceneView) {
                        return;
                    }
                    await state.rightSceneView.when();
                    if (!splitStillValid() || !state.rightSceneView) {
                        return;
                    }

                    if (CONFIG.SCENE_FORCE_GLOBAL_FOR_WEATHER) {
                        try {
                            if (state.splitMap.initialViewProperties) {
                                state.splitMap.initialViewProperties.viewingMode = 'global';
                            }
                        } catch (e) {
                            /* ignore */
                        }
                        try {
                            state.rightSceneView.viewingMode = 'global';
                        } catch (e) {
                            /* ignore */
                        }
                        const vmWatch = state.rightSceneView.watch('viewingMode', (mode) => {
                            if (mode === 'local') {
                                try {
                                    state.rightSceneView.viewingMode = 'global';
                                } catch (e) {
                                    /* ignore */
                                }
                            }
                        });
                        state.splitRightInternalWatchHandles.push(vmWatch);
                    }

                    ensureSceneViewQuality(state.rightSceneView);
                    const qWatch = state.rightSceneView.watch('qualityProfile', (q) => {
                        const target = getSceneQualityProfile();
                        if (q !== target) {
                            ensureSceneViewQuality(state.rightSceneView);
                        }
                    });
                    state.splitRightInternalWatchHandles.push(qWatch);

                    const uiSlots = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
                    for (const slot of uiSlots) {
                        try {
                            if (typeof state.rightSceneView.ui.empty === 'function') {
                                state.rightSceneView.ui.empty(slot);
                            }
                        } catch (e) {
                            /* ignore */
                        }
                    }

                    const splitZoom = new Zoom({ view: state.rightSceneView });
                    const splitCompass = new Compass({ view: state.rightSceneView });
                    const splitNav = new NavigationToggle({ view: state.rightSceneView });
                    const splitHome = new Home({ view: state.rightSceneView });
                    state.rightSceneView.ui.add(splitZoom, 'top-right');
                    state.rightSceneView.ui.add(splitCompass, 'top-right');
                    state.rightSceneView.ui.add(splitNav, 'top-right');
                    state.rightSceneView.ui.add(splitHome, 'top-right');
                }

                if (!splitStillValid() || !state.rightSceneView || !state.sceneView) {
                    return;
                }

                try {
                    if (typeof state.sceneView.resize === 'function') {
                        state.sceneView.resize();
                    }
                    if (state.rightSceneView && typeof state.rightSceneView.resize === 'function') {
                        state.rightSceneView.resize();
                    }
                } catch (resizeErr) {
                    console.warn('Split view resize:', resizeErr);
                }

                state.splitSuppressCameraSync = true;
                state.splitCameraSyncing = true;
                try {
                    await state.rightSceneView.goTo(state.sceneView.viewpoint.clone(), {
                        duration: 0
                    });
                } finally {
                    state.splitCameraSyncing = false;
                    state.splitSuppressCameraSync = false;
                }

                if (!splitStillValid() || !state.rightSceneView || !state.sceneView) {
                    return;
                }

                wireSplitCameraBidirectional();

                applySceneEnvironment(state.rightSceneView);

                await updateSplitVisualization();
                if (!splitStillValid()) {
                    return;
                }
                updateSplitViewLabels();

                wireSplitLinkedSelection();

                debugLog('✓ Split-screen views ready');
            } catch (e) {
                console.error(e);
                showError(
                    'Split-screen failed: ' + (e && e.message ? e.message : String(e))
                );
                teardownSplitScreen();
                document.getElementById('splitViewContainer').classList.add('hidden');
                document.getElementById('splitScreenControls').classList.add('hidden');
                state.currentMode = 'current';
                const sel = document.getElementById('modeSelector');
                if (sel) {
                    sel.value = 'current';
                }
            }
        })();
}

/**
 * Playback control functions
 */
function startPlayback() {
    if (!state.playbackController) return;
    
    state.playbackController.play();
    document.getElementById('playBtn').classList.add('hidden');
    document.getElementById('pauseBtn').classList.remove('hidden');
}

function pausePlayback() {
    if (!state.playbackController) return;
    
    state.playbackController.pause();
    document.getElementById('playBtn').classList.remove('hidden');
    document.getElementById('pauseBtn').classList.add('hidden');
}

function changePlaybackSpeed(speed) {
    if (!state.playbackController) return;
    state.playbackController.setSpeed(speed);
    debugLog(`Playback speed: ${speed}x`);
}

function seekPlayback(value) {
    if (!state.playbackController) return;
    
    const index = Math.floor((value / 100) * (state.historicalSnapshots.length - 1));
    state.playbackController.seek(index);
}

/**
 * Update playback UI
 */
function updatePlaybackUI(snapshot, index, total) {
    document.getElementById('currentTimestamp').textContent = TimeFeatures.formatTimestamp(snapshot.timestamp);
    document.getElementById('timelineSlider').value = (index / (total - 1)) * 100;
}

/**
 * Apply snapshot to visualization
 */
function applySnapshotToVisualization(snapshot) {
    const snapshotPoints = state.samplingPoints.map(point => {
        const data = snapshot.data.find(d => d.pointId === point.id);
        return { ...point, weatherData: data };
    });
    
    const valueKeys = ['temperature', 'humidity', 'windSpeed', 'pressure'];
    const snapshotGridCells = interpolateGrid(state.gridCells, snapshotPoints, valueKeys);
    
    updateVisualization(snapshotPoints, snapshotGridCells);
}

/**
 * Start auto-refresh timers
 */
function startAutoRefresh() {
    state.nextRefreshTime = Date.now() + CONFIG.WEATHER_REFRESH_INTERVAL;
    
    state.timers.weatherRefresh = setInterval(() => {
        refreshWeatherData();
        state.nextRefreshTime = Date.now() + CONFIG.WEATHER_REFRESH_INTERVAL;
    }, CONFIG.WEATHER_REFRESH_INTERVAL);
    
    state.timers.alertRefresh = setInterval(() => {
        checkWeatherAlerts();
    }, CONFIG.ALERT_REFRESH_INTERVAL);
    
    // Countdown timer
    state.timers.countdownTimer = setInterval(() => {
        updateCountdown();
    }, 1000);
}

/**
 * Update countdown display
 */
function updateCountdown() {
    if (!state.nextRefreshTime) return;
    
    const remaining = state.nextRefreshTime - Date.now();
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    const nextUpdateEl = document.getElementById('nextUpdateTime');
    if (nextUpdateEl) {
        nextUpdateEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}

/**
 * Check weather alerts
 */
async function checkWeatherAlerts() {
    try {
        const alerts = await WeatherService.fetchWeatherAlerts(
            CONFIG.CORAL_GABLES_CENTER.latitude,
            CONFIG.CORAL_GABLES_CENTER.longitude
        );
        
        if (alerts && alerts.length > 0) {
            showAlert(alerts[0]);
        }
    } catch (error) {
        // Silent fail for alerts
    }
}

/**
 * UI Helper Functions
 */
function showLoading(show, message = 'Loading...') {
    const loader = document.getElementById('loadingIndicator');
    const messageEl = document.getElementById('loadingMessage');
    
    if (show) {
        if (messageEl) messageEl.textContent = message;
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

function updateProgress(current, total) {
    showLoading(true, `Loading weather: ${current}/${total}`);
}

function updateDataSourceDisplay(successful, failed) {
    const isSampleData = state.samplingPoints.some(p => p.weatherData?.source === 'sample-data');
    document.getElementById('sourceStatus').textContent = isSampleData ? 'Sample Data' : 'Active';
    document.getElementById('successCount').textContent = successful;
    document.getElementById('failedCount').textContent = failed;
    
    if (isSampleData) {
        debugLog('ℹ️ Using sample data - real APIs unavailable');
    }
}

function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = `Last: ${now.toLocaleTimeString()}`;
}

/**
 * Legend + scene use NWS-prioritized Coral Gables reading (see refreshWeatherData).
 */
function updateCoralGablesLiveDisplay() {
    const w = state.coralGablesLiveWeather;
    const tempEl = document.getElementById('cgLiveTemp');
    const condEl = document.getElementById('cgLiveCondition');
    const srcEl = document.getElementById('cgLiveSource');
    if (!tempEl || !condEl) {
        return;
    }
    if (!w || typeof w.temperature !== 'number') {
        tempEl.textContent = '--°F';
        condEl.textContent = '—';
        if (srcEl) {
            srcEl.textContent = '';
        }
        return;
    }
    tempEl.textContent = `${Math.round(w.temperature)}°F`;
    const cond =
        (typeof w.weatherDescription === 'string' && w.weatherDescription.trim()) ||
        (typeof w.weather === 'string' && w.weather.trim()) ||
        '—';
    condEl.textContent = cond;
    if (srcEl) {
        const raw = w.sources || w.source || '';
        srcEl.textContent = raw ? `Sources: ${raw}` : '';
    }
}

function updateSnapshotCount() {
    const countEl = document.getElementById('snapshotCount');
    if (countEl) {
        countEl.textContent = state.historicalSnapshots.length;
    }
}

function showAlert(alert) {
    const banner = document.getElementById('alertBanner');
    const content = document.getElementById('alertContent');
    
    content.textContent = alert.headline || alert.event;
    banner.className = 'alert-banner';
    
    if (alert.severity === 'Moderate') banner.classList.add('warning');
    else if (alert.severity === 'Minor') banner.classList.add('advisory');
    
    banner.classList.remove('hidden');
}

function showError(message) {
    console.error(message);
    debugLog('✗ ' + message, true);
}

function swapSplitViews() {
    const left = document.getElementById('leftViewMode').value;
    const right = document.getElementById('rightViewMode').value;
    
    document.getElementById('leftViewMode').value = right;
    document.getElementById('rightViewMode').value = left;
    if (state.currentMode === 'split-screen') {
        void updateSplitVisualization();
    }
}

/**
 * Debug logging
 */
function debugLog(message, isError = false) {
    console.log(message);
    
    const debugOutput = document.getElementById('debugOutput');
    if (debugOutput) {
        const div = document.createElement('div');
        div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        div.style.color = isError ? '#ff6b6b' : '#ffffff';
        div.style.fontSize = '11px';
        div.style.margin = '2px 0';
        debugOutput.appendChild(div);
        debugOutput.scrollTop = debugOutput.scrollHeight;
    }
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Debug keyboard shortcut (press 'd' to toggle debug console)
document.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
        const debugConsole = document.getElementById('debugConsole');
        if (debugConsole) {
            debugConsole.classList.toggle('hidden');
        }
    }
});
