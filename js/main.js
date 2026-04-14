import { CONFIG } from './config.js';
import { generateSamplingPoints } from './samplingPoints.js';
import * as WeatherService from './api/weatherService.js';
import * as DB from './storage/db.js';
import { generateGridCells } from './utils/gridGenerator.js';
import { renderWindVectors, windDirectionToCompass16 } from './viz/wind.js';
import { collectActiveApiSourcesForFrame, updateDataSourceDisplay } from './ui/dataStatus.js';
import {
    classicReliefTempRgb,
    temperatureToColor,
    tempGradientCssLinear
} from './utils/tempColors.js';
import { interpolateGrid, interpolate } from './utils/interpolation.js';
import * as TimeFeatures from './features/timeFeatures.js';
import {
    setTidefieldModules,
    registerTidefieldContext,
    unregisterTidefieldContext,
    afterGridRebuild,
    triggerMembranePulse
} from './features/tidefieldMembrane.js';
import {
    getMapVisualStyle,
    setMapVisualStyle,
    isTidefieldMembraneActive,
    isBasicGridActive
} from './features/mapVisualStyle.js';

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
        membrane: null,
        tether: null,
        points: null,
        wind: null,
        splitGrid: null,
        splitMembrane: null,
        splitTether: null,
        splitPoints: null,
        splitWind: null
    },
    timers: {
        weatherRefresh: null,
        alertRefresh: null,
        countdownTimer: null,
        sceneLighting: null,
        lightingHudClock: null,
        weatherMenuClock: null
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
    esriSplit: null,
    /** Layer toggle: show NWS alert toasts over the map */
    alertsUiEnabled: true,
    /** WatchHandle from `wireSceneCameraDebugToTerminal` — removed on teardown if we add cleanup */
    cameraDebugWatchHandle: null,
    /** One friendly welcome toast per page load (after first weather refresh). */
    welcomeWeatherToastShown: false,
    /** Throttle “drastic spread” microclimate toasts */
    lastMicroclimateToastAt: 0,
    /** Last NWS alerts API call: true = HTTP OK + parsed; false = error; null = not yet run */
    lastNwsAlertsFetchOk: null,
    /** Startup viewpoint to return to when clicking the title overlay */
    startViewpoint: null
};

/** Dedupe alert toasts per session / user dismiss */
const alertToastRuntime = {
    shownIds: new Set(),
    dismissedIds: new Set(),
    autoHideTimers: new Map()
};

// Make state accessible for debugging
window.debugState = state;

/** `performance.now()` when the current CSS refresh sweep animation started (one iteration = one leg). */
let refreshScanAnimStartMs = 0;
let refreshScanStopTimerId = null;

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
        
        // Fetch initial weather data — no fullscreen weather loader; CSS sweep is the load cue (same as periodic refresh)
        try {
            showLoading(false);
            await refreshWeatherData();
            debugLog('✓ Initial weather data loaded');
            scheduleWelcomeWeatherToast();
        } catch (refreshErr) {
            debugLog('⚠ Initial weather fetch failed, grid showing with defaults', true);
            scheduleWelcomeWeatherToast();
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

                let minT = Infinity;
                let maxT = -Infinity;
                for (const c of state.gridCells) {
                    const t = c.interpolatedData?.temperature;
                    if (t != null && !Number.isNaN(t)) {
                        minT = Math.min(minT, t);
                        maxT = Math.max(maxT, t);
                    }
                }
                const range = maxT > minT ? maxT - minT : 0;
                const hasFrameTemps = range > 0;
                
                let added = 0;
                let failed = 0;
                
                state.gridCells.forEach((cell, index) => {
                    try {
                        const row = cell.row || 0;
                        const col = cell.col || 0;
                        const elevation = (row * 100) + (col * 80) + 500; // Much higher!
                        const tCell = cell.interpolatedData?.temperature;
                        const color =
                            hasFrameTemps && tCell != null && !Number.isNaN(tCell)
                                ? classicReliefTempRgb(tCell, minT, maxT, range)
                                : temperatureToColor(
                                      tCell != null && !Number.isNaN(tCell) ? tCell : 72
                                  );
                        
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
                                    color: [...color, CONFIG.BASIC_GRID_OUTLINE_ALPHA ?? 118],
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
                if (isTidefieldMembraneActive()) {
                    afterGridRebuild('main', state.samplingPoints);
                }
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
            'esri/widgets/Weather',
            'esri/Graphic',
            'esri/geometry/Polygon',
            'esri/geometry/Polyline',
            'esri/symbols/SimpleFillSymbol',
            'esri/symbols/SimpleLineSymbol'
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
            Weather,
            EsriGraphic,
            EsriPolygon,
            EsriPolyline,
            EsriSimpleFillSymbol,
            EsriSimpleLineSymbol
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
                    setTidefieldModules(
                        EsriGraphic,
                        EsriPolygon,
                        EsriPolyline,
                        EsriSimpleFillSymbol,
                        EsriSimpleLineSymbol
                    );
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

                    const ic = CONFIG.SCENE_INITIAL_CAMERA;
                    const useInitialCameraPreset =
                        ic &&
                        typeof ic.longitude === 'number' &&
                        Number.isFinite(ic.longitude) &&
                        typeof ic.latitude === 'number' &&
                        Number.isFinite(ic.latitude) &&
                        typeof ic.z === 'number' &&
                        Number.isFinite(ic.z);

                    const initialCamera = useInitialCameraPreset
                        ? {
                              position: {
                                  longitude: ic.longitude,
                                  latitude: ic.latitude,
                                  z: ic.z
                              },
                              heading: typeof ic.heading === 'number' && Number.isFinite(ic.heading) ? ic.heading : 0,
                              tilt: typeof ic.tilt === 'number' && Number.isFinite(ic.tilt) ? ic.tilt : 45
                          }
                        : {
                              position: {
                                  longitude: CONFIG.CORAL_GABLES_CENTER.longitude,
                                  latitude: CONFIG.CORAL_GABLES_CENTER.latitude,
                                  z: camZ
                              },
                              tilt: 45,
                              heading: 0
                          };

                    state.sceneView = new SceneView({
                        container: 'viewDiv',
                        map: map,
                        viewingMode: 'global',
                        qualityProfile: getSceneQualityProfile(),
                        camera: initialCamera,
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
                        title: 'Weather Points',
                        elevationInfo: { mode: 'absolute-height' },
                        visible: false
                    });
                    state.layers.wind = new GraphicsLayer({
                        title: 'Wind Vectors',
                        elevationInfo: { mode: 'absolute-height' },
                        visible: false
                    });

                    state.layers.membrane = new GraphicsLayer({
                        title: 'Tidefield Membrane',
                        elevationInfo: { mode: 'absolute-height' },
                        listMode: 'hide'
                    });
                    state.layers.tether = new GraphicsLayer({
                        title: 'Tidefield Tethers',
                        elevationInfo: { mode: 'absolute-height' },
                        listMode: 'hide'
                    });
                    const tideOn = isTidefieldMembraneActive();
                    state.layers.membrane.visible = tideOn;
                    state.layers.tether.visible = tideOn;
                    map.addMany([
                        state.layers.grid,
                        state.layers.membrane,
                        state.layers.tether,
                        state.layers.points,
                        state.layers.wind
                    ]);
                    // Tidefield RAF + requestRender must NOT start until after initial
                    // `whenOnce(!updating)` — register only at end of init when that preset is on.

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

                    if (CONFIG.SCENE_FRAME_FULL_EXTENT_ON_LOAD !== false && !useInitialCameraPreset) {
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
                            await Promise.race([
                                reactiveUtils.whenOnce(() => !state.sceneView.updating),
                                new Promise((r) => setTimeout(r, 8000))
                            ]);
                        } catch (e) {
                            /* still settling */
                        }
                        await new Promise((r) => setTimeout(r, 400));
                        const t1 = Date.now();
                        while (state.sceneView.updating && Date.now() - t1 < 10000) {
                            await new Promise((r) => setTimeout(r, 120));
                        }
                        debugLog('✓ Coral Gables extent framed; scene view idle');
                    } else if (useInitialCameraPreset) {
                        debugLog('✓ Opening view: SCENE_INITIAL_CAMERA (extent framing skipped)');
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

                    if (
                        isTidefieldMembraneActive() &&
                        state.layers.membrane &&
                        state.layers.tether &&
                        state.layers.grid &&
                        state.sceneView
                    ) {
                        registerTidefieldContext('main', {
                            gridLayer: state.layers.grid,
                            membraneLayer: state.layers.membrane,
                            tetherLayer: state.layers.tether,
                            views: [state.sceneView]
                        });
                    }

                    debugLog('SceneView ready!');
                    wireSceneCameraDebugToTerminal(state.sceneView);
                    try {
                        if (state.sceneView?.viewpoint && typeof state.sceneView.viewpoint.clone === 'function') {
                            state.startViewpoint = state.sceneView.viewpoint.clone();
                        }
                    } catch (e) {
                        /* ignore */
                    }
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
 * Slow looping CSS sweep over the map while weather fetch runs (all grid looks).
 * Stop is deferred until the current animation *leg* finishes so the band does not vanish mid-screen.
 */
function startGlobalRefreshScanWhileLoading() {
    const el = document.getElementById('refreshScanOverlay');
    if (!el) {
        return;
    }
    if (refreshScanStopTimerId != null) {
        clearTimeout(refreshScanStopTimerId);
        refreshScanStopTimerId = null;
    }
    const c = CONFIG.TIDEfield_SCAN_COLOR || [34, 190, 96, 82];
    const a = (typeof c[3] === 'number' ? c[3] : 82) / 255;
    el.style.setProperty('--rs-r', String(Math.round(c[0])));
    el.style.setProperty('--rs-g', String(Math.round(c[1])));
    el.style.setProperty('--rs-b', String(Math.round(c[2])));
    el.style.setProperty('--rs-a', String(a));
    const leg = CONFIG.WEATHER_LOADING_SCAN_LEG_DURATION_MS ?? 6800;
    el.style.setProperty('--refresh-scan-leg-dur', `${leg}ms`);
    el.classList.remove('hidden');
    el.classList.remove('refresh-scan-overlay--loading');
    void el.offsetWidth;
    refreshScanAnimStartMs = performance.now();
    el.classList.add('refresh-scan-overlay--loading');
}

function stopGlobalRefreshScanWhileLoading() {
    const el = document.getElementById('refreshScanOverlay');
    if (!el) {
        return;
    }
    if (!el.classList.contains('refresh-scan-overlay--loading')) {
        return;
    }
    if (refreshScanStopTimerId != null) {
        clearTimeout(refreshScanStopTimerId);
        refreshScanStopTimerId = null;
    }
    const leg = Math.max(400, CONFIG.WEATHER_LOADING_SCAN_LEG_DURATION_MS ?? 6800);
    const elapsed = performance.now() - refreshScanAnimStartMs;
    let remaining = leg - (elapsed % leg);
    if (remaining < 48) {
        remaining += leg;
    }
    refreshScanStopTimerId = setTimeout(() => {
        refreshScanStopTimerId = null;
        el.classList.remove('refresh-scan-overlay--loading');
        el.classList.add('hidden');
    }, remaining);
}

/**
 * Refresh weather data from APIs
 */
async function refreshWeatherData() {
    try {
        debugLog('Fetching weather for ' + state.samplingPoints.length + ' points...');

        startGlobalRefreshScanWhileLoading();

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
                windDirection: Math.random() * 360,
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
        
        // Update visualization with REAL data (loading scans stop in `finally`)
        if (state.currentMode === 'split-screen') {
            await updateSplitVisualization({ membranePulse: true });
        } else {
            updateVisualization(state.samplingPoints, state.gridCells, null, { membranePulse: true });
        }

        syncSceneAtmosphereFromApiWeather();
        debugLog(`✓ Scene sky · live sun · Esri weather=${state.sceneWeatherMode} (from API)`);
        
        // Update UI
        const activeApiSources = collectActiveApiSourcesForFrame(weatherResults, canonicalCoralGables);
        updateDataSourceDisplay({
            state,
            debugLog,
            successful: finalSuccessful,
            failed: finalFailed,
            activeApiSources
        });
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

        try {
            maybeScheduleMicroclimateToast();
        } catch (mcErr) {
            console.warn('Microclimate toast schedule:', mcErr);
        }
        
        debugLog('✓ Refresh complete');
    } catch (error) {
        console.error('Failed to refresh weather data:', error);
        debugLog('✗ Refresh failed: ' + error.message, true);

        // Update UI with error state
        showError('Weather refresh failed. Displaying last known data.');
        updateDataSourceDisplay({
            state,
            debugLog,
            successful: 0,
            failed: state.samplingPoints.length,
            activeApiSources: []
        });
    } finally {
        stopGlobalRefreshScanWhileLoading();
        scheduleNextWeatherRefreshFromNow();
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
 * Min/max °F for the same field used to tint the grid (relief corners + cell centers, else point/cell fallbacks).
 */
function getLegendTempBounds(samplingPoints, gridCells) {
    if (gridCells?.length && samplingPoints?.length) {
        const relief = buildGridReliefGeometry(gridCells, samplingPoints, 2);
        if (relief) {
            return { minT: relief.minT, maxT: relief.maxT };
        }
    }
    const ts = [];
    for (const p of samplingPoints || []) {
        const t = p?.weatherData?.temperature;
        if (typeof t === 'number' && !Number.isNaN(t)) {
            ts.push(t);
        }
    }
    for (const c of gridCells || []) {
        const t = c?.interpolatedData?.temperature;
        if (typeof t === 'number' && !Number.isNaN(t)) {
            ts.push(t);
        }
    }
    if (!ts.length) {
        return null;
    }
    return { minT: Math.min(...ts), maxT: Math.max(...ts) };
}

/**
 * Sea-glass cell outline: lerp temp RGB toward a pale mint highlight (less “rainbow wire”).
 * Used for Gulf Glass and Tidefield Membrane grid fills (`GULF_GLASS_OUTLINE_BLEND` / `GULF_GLASS_OUTLINE_HIGHLIGHT_RGB`).
 * @param {number[]} cellRgb
 * @returns {number[]}
 */
function gulfGlassOutlineRgb(cellRgb) {
    const blend = CONFIG.GULF_GLASS_OUTLINE_BLEND ?? 0;
    const hi = CONFIG.GULF_GLASS_OUTLINE_HIGHLIGHT_RGB;
    if (
        !Array.isArray(cellRgb) ||
        cellRgb.length < 3 ||
        !(blend > 0) ||
        !Array.isArray(hi) ||
        hi.length < 3
    ) {
        return cellRgb;
    }
    return [
        Math.round(cellRgb[0] * (1 - blend) + hi[0] * blend),
        Math.round(cellRgb[1] * (1 - blend) + hi[1] * blend),
        Math.round(cellRgb[2] * (1 - blend) + hi[2] * blend)
    ];
}

/**
 * Grid cell whose bounds contain the sampling point (same cell the mesh uses for that spot).
 */
function findGridCellUnderPoint(lon, lat, gridCells) {
    if (!gridCells || !gridCells.length) {
        return null;
    }
    for (let i = 0; i < gridCells.length; i++) {
        const cell = gridCells[i];
        const b = cell?.bounds;
        if (!b) {
            continue;
        }
        if (lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north) {
            return cell;
        }
    }
    return null;
}

/**
 * Update visualization (with real or default data)
 */
function updateVisualization(samplingPoints, gridCells, layersOverride = null, vizOptions = null) {
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

            const tide = isTidefieldMembraneActive();
            const basic = isBasicGridActive();
            const gulfGlass = !basic && !tide;
            const fillAlpha = tide
                ? (CONFIG.TIDEfield_GRID_FILL_ALPHA ?? 55)
                : basic
                  ? 0
                  : (CONFIG.GULF_GLASS_GRID_FILL_ALPHA ?? 38);
            const outlineAlpha = tide
                ? (CONFIG.TIDEfield_GRID_OUTLINE_ALPHA ?? 200)
                : basic
                  ? (CONFIG.BASIC_GRID_OUTLINE_ALPHA ?? 118)
                  : (CONFIG.GULF_GLASS_GRID_OUTLINE_ALPHA ?? 150);
            const reliefForPalette =
                gridCells && gridCells.length > 0 && samplingPoints && samplingPoints.length > 0
                    ? buildGridReliefGeometry(gridCells, samplingPoints, 2)
                    : null;

            /** All grid looks use the same legend scale (`TEMP_COLOR_GRADIENT` via relief normalization). */
            const tempToRgb = (temp, minT, maxT, range) =>
                classicReliefTempRgb(temp, minT, maxT, range);
        
            // Add sampling points
            if (samplingPoints && samplingPoints.length > 0) {
                samplingPoints.forEach(point => {
                    if (!point || !point.weatherData || point.weatherData.error) return;
                    
                    try {
                        const t = point.weatherData.temperature;
                        let rgb = [255, 255, 255];
                        const hostCell = findGridCellUnderPoint(
                            point.longitude,
                            point.latitude,
                            gridCells
                        );
                        let tForPalette = t;
                        if (
                            hostCell &&
                            hostCell.interpolatedData &&
                            hostCell.interpolatedData.temperature != null &&
                            !Number.isNaN(hostCell.interpolatedData.temperature)
                        ) {
                            tForPalette = hostCell.interpolatedData.temperature;
                        }
                        if (reliefForPalette && tForPalette != null && !Number.isNaN(tForPalette)) {
                            rgb = tempToRgb(
                                tForPalette,
                                reliefForPalette.minT,
                                reliefForPalette.maxT,
                                reliefForPalette.range
                            );
                        }
                        const zBeacon = basic ? 50 : tide
                            ? (CONFIG.TIDEfield_BEACON_Z_METERS ?? 52)
                            : (CONFIG.GULF_GLASS_BEACON_Z_METERS ?? 48);
                        const basicOutlineA = CONFIG.BASIC_GRID_OUTLINE_ALPHA ?? 118;
                        const pointFillAlpha = basic
                            ? 250
                            : CONFIG.GULF_GLASS_BEACON_FILL_ALPHA ?? 232;
                        const graphic = new Graphic({
                geometry: new Point({
                    longitude: point.longitude,
                    latitude: point.latitude,
                    z: zBeacon
                }),
                symbol: new SimpleMarkerSymbol({
                    color: basic ? [...rgb, 250] : [...rgb, pointFillAlpha],
                    size: basic
                        ? 12
                        : tide
                          ? CONFIG.TIDEfield_BEACON_SIZE ?? CONFIG.GULF_GLASS_BEACON_SIZE ?? 12
                          : CONFIG.GULF_GLASS_BEACON_SIZE ?? 12,
                    outline: {
                        color: basic
                            ? [...rgb, basicOutlineA]
                            : CONFIG.GULF_GLASS_BEACON_OUTLINE || [52, 198, 118, 232],
                        width: basic ? 2 : 2
                    }
                }),
                attributes: {
                    pointId: point.id,
                    locationLabel: getCoralGablesAreaLabel(point.id),
                    locationCoords: `${Number(point.latitude).toFixed(5)}° N, ${Math.abs(Number(point.longitude)).toFixed(5)}° W`,
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
                    title: `Weather: ${point.id}`,
                    content: `
                        <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(148,163,184,0.35);font-size:12px;line-height:1.45">
                        <b>Location:</b> {locationLabel}<br>
                        <b>Coordinates:</b> {locationCoords}
                        </div>
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
                const relief = reliefForPalette || buildGridReliefGeometry(gridCells, samplingPoints, 2);
                const flatZ =
                    CONFIG.GRID_BASE_ELEVATION_METERS + CONFIG.GRID_TEMP_RELIEF_METERS * 0.5;

                gridCells.forEach((cell, index) => {
                    if (!cell || !cell.bounds) return;
                    
                    try {
            let temp = 75; // Default
                    let meanCornerZ = flatZ;
                    let color = [46, 188, 108];
                    let hasData = false;
                    
                    if (cell.interpolatedData && cell.interpolatedData.temperature != null) {
                        temp = cell.interpolatedData.temperature;
                hasData = true;
            }

                    if (hasData) {
                        if (relief) {
                            color = tempToRgb(temp, relief.minT, relief.maxT, relief.range);
                        } else {
                            color = tempToRgb(temp, temp - 15, temp + 15, 30);
                        }
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

                    const outlineRgb =
                        hasData && (gulfGlass || tide) ? gulfGlassOutlineRgb(color) : color;
                    const outlineW = tide
                        ? CONFIG.TIDEfield_GRID_OUTLINE_WIDTH ?? CONFIG.GULF_GLASS_GRID_OUTLINE_WIDTH ?? 1.35
                        : basic
                          ? 2
                          : gulfGlass
                            ? CONFIG.GULF_GLASS_GRID_OUTLINE_WIDTH ?? 1.35
                            : 2;
            
                    const graphic = new Graphic({
                        geometry: polygon,
                        symbol: new SimpleFillSymbol({
                            color: hasData ? [...color, fillAlpha] : [128, 128, 128, 0],
                            outline: {
                                color: hasData ? [...outlineRgb, outlineAlpha] : [40, 85, 62, 210],
                                width: outlineW
                            }
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
            renderWindVectors({ samplingPoints, layersOverride, state, debugLog });

            if (isTidefieldMembraneActive()) {
                const membraneCtxId =
                    layersOverride && layersOverride.grid === state.layers.splitGrid ? 'split' : 'main';
                afterGridRebuild(membraneCtxId, samplingPoints);
                if (vizOptions && vizOptions.membranePulse) {
                    triggerMembranePulse();
                }
            }

            const isSplitRightPane =
                layersOverride &&
                state.layers.splitGrid &&
                layersOverride.grid === state.layers.splitGrid;
            if (!isSplitRightPane) {
                syncTempLegendGradient(getLegendTempBounds(samplingPoints, gridCells));
            }
            
        } catch (vizError) {
            console.error('Visualization error:', vizError);
            debugLog('✗ Visualization failed: ' + vizError.message, true);
        }
    });
}

/**
 * Legend gradient + live min/max labels for the frame that was just drawn (main / split-left only).
 * @param {{ minT: number, maxT: number } | null} bounds
 */
function syncTempLegendGradient(bounds) {
    const el = document.getElementById('tempGradient');
    if (el) {
        el.style.background = tempGradientCssLinear();
    }
    const minEl = document.getElementById('minTemp');
    const maxEl = document.getElementById('maxTemp');
    const fmt = (v) =>
        typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}°F` : '--°F';
    const lo = bounds?.minT;
    const hi = bounds?.maxT;
    if (minEl) {
        minEl.textContent = fmt(lo);
    }
    if (maxEl) {
        maxEl.textContent = fmt(hi);
    }
}

/**
 * Apply grid look (Gulf Glass / Basic Grid / Tidefield Membrane — layers, tidefield registration, redraw).
 */
function applyMapVisualStyle() {
    const tide = isTidefieldMembraneActive();
    try {
        if (state.layers.membrane) {
            state.layers.membrane.visible = tide;
        }
        if (state.layers.tether) {
            state.layers.tether.visible = tide;
        }
        if (state.layers.splitMembrane) {
            state.layers.splitMembrane.visible = tide;
        }
        if (state.layers.splitTether) {
            state.layers.splitTether.visible = tide;
        }
    } catch (e) {
        console.warn('applyMapVisualStyle visibility:', e);
    }

    if (tide) {
        if (state.layers.grid && state.layers.membrane && state.layers.tether && state.sceneView) {
            registerTidefieldContext('main', {
                gridLayer: state.layers.grid,
                membraneLayer: state.layers.membrane,
                tetherLayer: state.layers.tether,
                views: [state.sceneView]
            });
        }
        if (
            state.currentMode === 'split-screen' &&
            state.layers.splitGrid &&
            state.layers.splitMembrane &&
            state.layers.splitTether &&
            state.rightSceneView
        ) {
            registerTidefieldContext('split', {
                gridLayer: state.layers.splitGrid,
                membraneLayer: state.layers.splitMembrane,
                tetherLayer: state.layers.splitTether,
                views: [state.rightSceneView]
            });
        }
    } else {
        unregisterTidefieldContext('main');
        unregisterTidefieldContext('split');
    }

    if (state.currentMode === 'split-screen') {
        void updateSplitVisualization();
    } else if (state.samplingPoints && state.gridCells) {
        updateVisualization(state.samplingPoints, state.gridCells);
    }
}

// wind helpers moved to `js/viz/wind.js`

function updateWeatherMenuClock() {
    const dateEl = document.getElementById('weatherMenuClockDate');
    const timeEl = document.getElementById('weatherMenuClockTime');
    const dowEl = document.getElementById('weatherMenuClockDow');
    const mdEl = document.getElementById('weatherMenuClockMd');
    const yrEl = document.getElementById('weatherMenuClockYr');
    if (!timeEl) {
        return;
    }
    const now = new Date();
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
    if (dowEl && mdEl && yrEl) {
        dowEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short' });
        mdEl.textContent = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        yrEl.textContent = now.toLocaleDateString(undefined, { year: 'numeric' });
    }
    timeEl.textContent = now.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
    });
}

function startWeatherMenuClock() {
    updateWeatherMenuClock();
    if (state.timers.weatherMenuClock) {
        clearInterval(state.timers.weatherMenuClock);
    }
    state.timers.weatherMenuClock = setInterval(updateWeatherMenuClock, 1000);
}

/**
 * Setup UI event listeners
 */
function setupEventListeners() {
    /** Weather Menu: − / + button and clicking the header bar both minimize / expand */
    (function wireWeatherMenuMinimize() {
        const panel = document.getElementById('mapTaskbar');
        const btn = document.getElementById('mapTaskbarMinBtn');
        const header = panel?.querySelector('.map-taskbar__header');
        if (!panel || !btn || !header) {
            return;
        }
        const sync = () => {
            const min = panel.classList.contains('panel--minimized');
            btn.setAttribute('aria-expanded', min ? 'false' : 'true');
            btn.textContent = min ? '+' : '−';
            btn.title = min ? 'Show Weather Menu' : 'Hide Weather Menu';
            panel.classList.toggle('map-taskbar--collapsed', min);
            panel.setAttribute('aria-expanded', (!min).toString());
            updateWeatherMenuClock();
        };
        const toggle = () => {
            panel.classList.toggle('panel--minimized');
            sync();
            requestAnimationFrame(() => {
                try {
                    if (state.sceneView && typeof state.sceneView.resize === 'function') {
                        state.sceneView.resize();
                    }
                    if (state.rightSceneView && typeof state.rightSceneView.resize === 'function') {
                        state.rightSceneView.resize();
                    }
                } catch (_) {
                    /* ignore */
                }
            });
        };
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });
        header.addEventListener('click', (e) => {
            if (e.target === btn || btn.contains(e.target)) {
                return;
            }
            toggle();
        });
        sync();
    })();

    (function wireTitleOverlayHome() {
        const btn = document.getElementById('appPageHeader');
        if (!btn) {
            return;
        }
        btn.addEventListener('click', () => {
            const view = state.sceneView;
            const vp = state.startViewpoint;
            if (!view || !vp) {
                return;
            }
            try {
                view.goTo(vp.clone(), { duration: 650 }).catch(() => {});
            } catch (e) {
                /* ignore */
            }
        });
    })();

    startWeatherMenuClock();

    // Mode selector
    document.getElementById('modeSelector').addEventListener('change', (e) => {
        handleModeChange(e.target.value);
    });

    const mapStyleEl = document.getElementById('mapVisualStyleSelect');
    if (mapStyleEl) {
        mapStyleEl.value = getMapVisualStyle();
        mapStyleEl.addEventListener('change', (e) => {
            setMapVisualStyle(e.target.value);
            applyMapVisualStyle();
            debugLog(`Grid Look: ${getMapVisualStyle()}`);
        });
    }
    
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
        debugLog(`📍 Weather points ${v ? 'shown' : 'hidden'}`);
    });

    const toggleWindEl = document.getElementById('toggleWind');
    if (toggleWindEl) {
        toggleWindEl.addEventListener('change', (e) => {
            const v = e.target.checked;
            if (state.layers.wind) state.layers.wind.visible = v;
            if (state.layers.splitWind) state.layers.splitWind.visible = v;
            debugLog(`💨 Wind vectors ${v ? 'shown' : 'hidden'}`);
        });
    }

    const toggleAlertsEl = document.getElementById('toggleAlerts');
    if (toggleAlertsEl) {
        state.alertsUiEnabled = toggleAlertsEl.checked;
        toggleAlertsEl.addEventListener('change', (e) => {
            state.alertsUiEnabled = e.target.checked;
            if (!state.alertsUiEnabled) {
                clearAllAlertToasts();
            } else {
                void checkWeatherAlerts();
            }
        });
    }
    
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
    
    syncTempLegendGradient(getLegendTempBounds(state.samplingPoints, state.gridCells));
    
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

async function updateSplitVisualization(splitVizOptions = null) {
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

    const pulse = splitVizOptions && splitVizOptions.membranePulse;
    updateVisualization(leftData.samplingPoints, leftData.gridCells);
    updateVisualization(
        rightData.samplingPoints,
        rightData.gridCells,
        rightLayers,
        pulse ? { membranePulse: true } : null
    );
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
        const accent = [46, 188, 108, 255];
        if (h.type === 'simple-marker') {
            h.size = Math.max(Number(h.size) || 12, 16) + 2;
            h.outline = { color: accent, width: 3 };
        } else if (h.type === 'simple-fill') {
            const w = h.outline?.width != null ? Number(h.outline.width) : 1;
            h.outline = {
                color: accent,
                width: Math.max(w + 2, 4)
            };
        } else if (h.type === 'line-3d') {
            const symLayers = h.symbolLayers;
            if (symLayers && typeof symLayers.getItemAt === 'function') {
                const sl0 = symLayers.getItemAt(0);
                if (sl0) {
                    const prevSize = Number(sl0.size);
                    if (Number.isFinite(prevSize)) {
                        sl0.size = Math.min(prevSize + 2.5, 16);
                    }
                    sl0.material = { color: accent };
                }
            }
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
    const windLayer = isLeftPane ? state.layers.wind : state.layers.splitWind;
    const otherPtLayer = isLeftPane ? state.layers.splitPoints : state.layers.points;
    const otherGridLayer = isLeftPane ? state.layers.splitGrid : state.layers.grid;
    const otherWindLayer = isLeftPane ? state.layers.splitWind : state.layers.wind;

    state.splitClickHandling = true;
    state.splitSuppressCameraSync = true;
    try {
        let response;
        try {
            const include = [ptLayer, gridLayer, windLayer].filter(Boolean);
            response = await clickedView.hitTest(event, { include });
        } catch (e) {
            return;
        }
        const results = response?.results || [];
        const hit = results.find((r) => {
            if (!r?.graphic) {
                return false;
            }
            const lyr = r.graphic.layer || r.layer;
            return lyr === ptLayer || lyr === gridLayer || lyr === windLayer;
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
        const hitLyr = hitGraphic.layer;
        let matchOther = null;
        if (hitLyr === windLayer && otherWindLayer) {
            if (attrs.kind === 'coral-gables-wind') {
                matchOther = findGraphicByAttribute(otherWindLayer, 'kind', 'coral-gables-wind');
            } else if (attrs.pointId != null && attrs.pointId !== '') {
                matchOther = findGraphicByAttribute(otherWindLayer, 'pointId', attrs.pointId);
            }
        } else if (hitLyr === ptLayer && attrs.pointId) {
            matchOther = findGraphicByAttribute(otherPtLayer, 'pointId', attrs.pointId);
        } else if (hitLyr === gridLayer && attrs.cellId) {
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
    unregisterTidefieldContext('split');
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
                        title: 'Weather Points (compare)',
                        elevationInfo: { mode: 'absolute-height' },
                        visible: state.layers.points ? state.layers.points.visible : false
                    });
                    state.layers.splitWind = new GraphicsLayer({
                        title: 'Wind (compare)',
                        elevationInfo: { mode: 'absolute-height' },
                        visible: state.layers.wind ? state.layers.wind.visible : false
                    });
                    state.layers.splitMembrane = new GraphicsLayer({
                        title: 'Tidefield Membrane (compare)',
                        elevationInfo: { mode: 'absolute-height' },
                        listMode: 'hide'
                    });
                    state.layers.splitTether = new GraphicsLayer({
                        title: 'Tidefield Tethers (compare)',
                        elevationInfo: { mode: 'absolute-height' },
                        listMode: 'hide'
                    });
                    const splitTide = isTidefieldMembraneActive();
                    state.layers.splitMembrane.visible = splitTide;
                    state.layers.splitTether.visible = splitTide;
                    state.splitMap.addMany([
                        state.layers.splitGrid,
                        state.layers.splitMembrane,
                        state.layers.splitTether,
                        state.layers.splitPoints,
                        state.layers.splitWind
                    ]);
                } else if (state.layers.splitWind && state.layers.wind) {
                    state.layers.splitWind.visible = state.layers.wind.visible;
                    if (state.layers.splitMembrane && state.layers.splitTether) {
                        const v = isTidefieldMembraneActive();
                        state.layers.splitMembrane.visible = v;
                        state.layers.splitTether.visible = v;
                    }
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

                if (
                    isTidefieldMembraneActive() &&
                    state.layers.splitGrid &&
                    state.layers.splitMembrane &&
                    state.layers.splitTether &&
                    state.rightSceneView
                ) {
                    registerTidefieldContext('split', {
                        gridLayer: state.layers.splitGrid,
                        membraneLayer: state.layers.splitMembrane,
                        tetherLayer: state.layers.splitTether,
                        views: [state.rightSceneView]
                    });
                }

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

/** Countdown target + static “every N min” copy in the control panel (uses CONFIG). */
function scheduleNextWeatherRefreshFromNow() {
    state.nextRefreshTime = Date.now() + CONFIG.WEATHER_REFRESH_INTERVAL;
    const note = document.getElementById('refreshIntervalNote');
    if (note) {
        const minutes = Math.max(1, Math.round(CONFIG.WEATHER_REFRESH_INTERVAL / 60000));
        note.textContent = `Every ${minutes} min · `;
    }
}

/**
 * Start auto-refresh timers
 */
function startAutoRefresh() {
    scheduleNextWeatherRefreshFromNow();
    
    state.timers.weatherRefresh = setInterval(() => {
        refreshWeatherData();
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
    if (!state.alertsUiEnabled) {
        return;
    }
    try {
        const result = await WeatherService.fetchWeatherAlerts(
            CONFIG.CORAL_GABLES_CENTER.latitude,
            CONFIG.CORAL_GABLES_CENTER.longitude
        );
        const ok = result && result.ok === true;
        state.lastNwsAlertsFetchOk = ok;
        const list = ok && Array.isArray(result.alerts) ? result.alerts : [];
        if (!ok && result && result.error) {
            debugLog('⚠ NWS alerts unavailable: ' + result.error, true);
        }
        showWeatherAlertToasts(list);
        showLiveWeatherSupplementToasts(list);
    } catch (error) {
        state.lastNwsAlertsFetchOk = false;
        debugLog('⚠ NWS alerts check failed: ' + (error && error.message ? error.message : String(error)), true);
    }
}

function alertStableKey(alert) {
    return String(alert.id || `${alert.event}|${alert.onset}`);
}

function pruneAlertToastTracking(currentAlerts) {
    const active = new Set(currentAlerts.map(alertStableKey));
    for (const id of alertToastRuntime.shownIds) {
        if (!active.has(id)) {
            alertToastRuntime.shownIds.delete(id);
        }
    }
    for (const id of alertToastRuntime.dismissedIds) {
        if (!active.has(id)) {
            alertToastRuntime.dismissedIds.delete(id);
        }
    }
}

function clearAllAlertToasts() {
    const host = document.getElementById('alertToastHost');
    if (host) {
        host.replaceChildren();
    }
    for (const t of alertToastRuntime.autoHideTimers.values()) {
        clearTimeout(t);
    }
    alertToastRuntime.autoHideTimers.clear();
    alertToastRuntime.shownIds.clear();
    alertToastRuntime.dismissedIds.clear();
}

function dismissAlertToast(toastEl, key, userInitiated) {
    const pending = alertToastRuntime.autoHideTimers.get(key);
    if (pending) {
        clearTimeout(pending);
        alertToastRuntime.autoHideTimers.delete(key);
    }
    if (userInitiated) {
        alertToastRuntime.dismissedIds.add(key);
    }
    if (!toastEl.isConnected) {
        return;
    }
    const exitMs = CONFIG.ALERT_TOAST_EXIT_MS ?? 420;
    toastEl.style.transitionDuration = `${exitMs}ms`;
    toastEl.classList.add('alert-toast--leaving');
    let finished = false;
    const finish = () => {
        if (finished) {
            return;
        }
        finished = true;
        toastEl.remove();
    };
    toastEl.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, exitMs + 80);
}

function pickRandomString(arr) {
    if (!arr || arr.length === 0) {
        return '';
    }
    return arr[Math.floor(Math.random() * arr.length)];
}

function getWelcomeWeatherSnapshot() {
    const w = state.coralGablesLiveWeather;
    if (w && typeof w.temperature === 'number' && Number.isFinite(w.temperature)) {
        return {
            tempF: w.temperature,
            windMph: typeof w.windSpeed === 'number' && Number.isFinite(w.windSpeed) ? w.windSpeed : null
        };
    }
    const center = state.samplingPoints?.find((p) => p.id === 'center');
    const wd = center?.weatherData;
    if (wd && typeof wd.temperature === 'number' && Number.isFinite(wd.temperature)) {
        return {
            tempF: wd.temperature,
            windMph: typeof wd.windSpeed === 'number' && Number.isFinite(wd.windSpeed) ? wd.windSpeed : null
        };
    }
    return { tempF: null, windMph: null };
}

function getWelcomeTimeGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) {
        return pickRandomString([
            'Good morning!',
            'Good morning, Coral Gables.',
            'Rise and shine—good morning!',
            'Morning! The grid is awake and so are we.',
            'Top of the morning to you.',
            'Hello, sunshine—good morning!',
            'Morning vibes only.',
            'Good morning—grab coffee, then clouds.'
        ]);
    }
    if (h >= 12 && h < 17) {
        return pickRandomString([
            'Good afternoon!',
            'Happy afternoon!',
            'Good afternoon—hope lunch was kind.',
            'Afternoon check-in: you look ready.',
            'Good afternoon, neighbor.',
            'Afternoon! Still daylight; still dramatic.',
            'Hey there—good afternoon!',
            'Afternoon status: partly awesome.'
        ]);
    }
    if (h >= 17 && h < 22) {
        return pickRandomString([
            'Good evening!',
            'Good evening—golden hour energy.',
            'Evening! The map cooled down; you can too.',
            'Good evening, Coral Gables.',
            'Evening vibes—stay cozy.',
            'Hello—good evening!',
            'Evening check-in: dress like you mean it.',
            'Good evening—streetlights are warming up.'
        ]);
    }
    return pickRandomString([
        'Good evening—or good night if you should be asleep.',
        'Burning the midnight oil? Good evening anyway.',
        'Late hours? Good evening, night owl.',
        'Good night… or good evening with extra espresso.',
        'Evening (or night—we do not judge).',
        'Hello, night shift of weather enthusiasts.',
        'Good evening—the breeze wrote this message.',
        'Still up? Good evening, legend.'
    ]);
}

function buildWelcomeWeatherBody() {
    const { tempF, windMph } = getWelcomeWeatherSnapshot();
    const greeting = getWelcomeTimeGreeting();
    const w = windMph != null ? windMph : null;
    const t = tempF != null ? tempF : null;

    const windy = w != null && w >= 12;
    const blustery = w != null && w >= 18;

    let tip = '';
    if (t == null) {
        tip = pickRandomString([
            'Our thermometer is shy today—layer up, stay hydrated, and blame the APIs if needed.',
            'No live temp yet—dress in layers and walk like you planned it.',
            'Weather data is loading its personality—until then, be kind to yourself and bring a jacket just in case.',
            'If the sky looks undecided, your outfit can be decisive: layers win.',
            'Forecast: mysterious. Strategy: comfy shoes and a backup hoodie.',
            'We will nag you about a scarf later—today, trust your instincts and a light layer.'
        ]);
    } else if (t < 55 && blustery) {
        tip = pickRandomString([
            'It is brisk and the wind is auditioning for a storm commercial—bundle up, secure the hat, stay warm.',
            'Cold plus windy equals “invented wind chill.” Fleece up, channel penguin energy, stay cozy.',
            'The breeze wants your warmth—deny it with layers, a smug smile, and hot beverage diplomacy.',
            'Dress like you are meeting winter halfway: coat, scarf, and mild indignation at gusts.',
            'Think onion layers, not fashion layers—stay warm and slightly unstoppable.',
            'Stay warm: the wind is just trying to steal your heat; do not negotiate.',
            'Hot drink in hand, hood optional but recommended—this is not a drill.',
            'Polar bear cosplay is optional; dignity and insulation are not.'
        ]);
    } else if (t < 58) {
        tip = pickRandomString([
            'Chilly out—layer like a cake: more is more, frosting optional.',
            'Stay warm: flannel is a love language.',
            'Dress for cold like you mean business—mittens are not a weakness.',
            'It is sweater weather with attitude—bring the cozy.',
            'Keep your core happy: jacket, smug grin, maybe soup later.',
            'Cold enough to justify that scarf you bought “just in case.”',
            'Thermal optimism: you have got this; add one more layer anyway.',
            'Stay warm—your future self is rooting for sleeves.'
        ]);
    } else if (t < 65 && windy) {
        tip = pickRandomString([
            'Cool and breezy—wind wants to rearrange your hair; dress smart and anchor your coffee.',
            'A little crisp with wind—light jacket, firm grip on your umbrella ego.',
            'Layers plus wind awareness: hold onto your receipts and your hat.',
            'Not freezing, but the wind has opinions—dress accordingly and walk with intent.',
            'Think light coat, good vibes, and mild suspicion of gusts.',
            'Breezy cool: channel stylish sailboat, not loose patio furniture.'
        ]);
    } else if (t >= 65 && t <= 79 && (w == null || w <= 12)) {
        tip = pickRandomString([
            'This is genuinely perfect weather—mild air, light breeze or calm, no notes. Go touch grass (or a palm).',
            'Chef’s kiss: today is a “screenshot the sky” day. Temps and wind are in the sweet spot.',
            'Weather report: 10/10, would recommend going outside and acting smug about it.',
            'Basically ideal—comfortable, not dramatic. Savor it before the atmosphere gets ideas.',
            'Perfect patio weather: you could host a brunch or a nap; both are valid.',
            'If weather had Yelp, this would be five stars and a “will return.”',
            'Goldilocks certified: not too hot, not too cold, wind behaving. Rare; enjoy the rerun.',
            'Nature turned down the difficulty—dress comfy, skip the jacket debate, win the day.',
            'This is the kind of day people describe as “room temperature outside”—and they mean it as a compliment.',
            'Ideal conditions: tell someone you love them, or at least your barista.',
            'Meteorological unicorn: pleasant, stable, and unlikely to humble you—get out there.',
            'Perfect for a walk, a window down, or pretending you always dress this appropriately.'
        ]);
    } else if (t >= 88) {
        tip = pickRandomString([
            'Hot one—light clothes, water bottle, and pretend you enjoy sweating a little.',
            'Dress for heat: breathable fabrics, sunscreen, and occasional shade diplomacy.',
            'It is toasty—think linen, hydration, and not challenging the sun to a duel.',
            'Warm enough to melt resolve—stay cool, drink water, avoid dark car seats.',
            'Heat advisory from your wardrobe: fewer layers, more ice in beverages.',
            'Dress light—your shadow is tired of working overtime.',
            'Sunscreen is a friend; denial is not.',
            'Hydrate like you are sponsored by water—because you are.'
        ]);
    } else if (t >= 75) {
        tip = pickRandomString([
            'Warm out—dress light, hydrate, and forgive the humidity.',
            'Nice and warm—breathable clothes, sunscreen, and smug sunglasses.',
            'Think summer-lite: comfy, breezy, slightly smug about your outfit.',
            'Dress well for warmth—linen wants to be your friend.',
            'Warm weather uniform: light shirt, water, and pretending you planned the sweat.',
            'Stay cool literally: shade, sips, and no wool unless you are a sheep.',
            'Perfect excuse for sandals—socks optional, dignity negotiable.'
        ]);
    } else if (blustery && t < 80) {
        tip = pickRandomString([
            'Windy enough to steal napkins—secure loose items and dress in snug layers.',
            'Breezy day—hold your hat, your coffee, and mildly unreasonable optimism.',
            'Gusty out—tie down your umbrella ego and enjoy the drama.',
            'Wind is doing cardio—match it with a jacket that does not flap like a flag.',
            'Blustery vibes: dress snug, walk purposeful, ignore hair physics.'
        ]);
    } else {
        tip = pickRandomString([
            'Pretty pleasant—dress comfortably and pretend you planned the weather.',
            'Goldilocks zone: not too hot, not too cold—outfit flex allowed.',
            'Nice out—dress well, stroll confidently, blame the grid if anything looks off.',
            'Comfortable temps—layer lightly and enjoy being smug about your forecast read.',
            'Balanced weather: jacket in backpack, optimism in front pocket.',
            'You can probably survive with one good decision and decent shoes.',
            'Mild and manageable—dress like you have your life together (we will not check).',
            'Lovely conditions—sunscreen optional, good mood recommended.'
        ]);
    }

    const stats =
        t != null
            ? ` Around ${Math.round(t)}°F${w != null ? `, wind ~${Math.round(w)} mph` : ''}.`
            : '';

    return `${greeting}${stats} ${tip}`;
}

function scheduleWelcomeWeatherToast() {
    if (state.welcomeWeatherToastShown) {
        return;
    }
    state.welcomeWeatherToastShown = true;
    setTimeout(() => {
        try {
            showWelcomeWeatherToast();
        } catch (e) {
            console.warn('Welcome weather toast:', e);
        }
    }, 500);
}

/**
 * One-time friendly toast after load (not tied to NWS toggle).
 */
function showWelcomeWeatherToast() {
    const host = document.getElementById('alertToastHost');
    if (!host) {
        return;
    }
    const key = '__welcome_weather__';
    const existing = alertToastRuntime.autoHideTimers.get(key);
    if (existing) {
        clearTimeout(existing);
        alertToastRuntime.autoHideTimers.delete(key);
    }

    const toast = document.createElement('div');
    toast.className = 'alert-toast alert-toast--welcome';
    toast.setAttribute('role', 'status');

    const text = document.createElement('div');
    text.className = 'alert-toast__text';
    text.textContent = buildWelcomeWeatherBody();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'alert-toast__dismiss';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.textContent = '✕';
    btn.addEventListener('click', () => dismissAlertToast(toast, key, true));

    toast.appendChild(text);
    toast.appendChild(btn);
    host.appendChild(toast);

    const autoMs = CONFIG.WELCOME_TOAST_AUTO_DISMISS_MS ?? 14000;
    const timerId = setTimeout(() => {
        alertToastRuntime.autoHideTimers.delete(key);
        dismissAlertToast(toast, key, false);
    }, autoMs);
    alertToastRuntime.autoHideTimers.set(key, timerId);
}

function getCoralGablesAreaLabel(pointId) {
    if (!pointId) {
        return 'that part of the map';
    }
    if (pointId === 'center') {
        return 'central Coral Gables';
    }
    const north = pointId.match(/^north_(\d)$/);
    if (north) {
        const i = Number(north[1]);
        const ew = i <= 1 ? 'Northwest' : i === 2 ? 'North (center)' : i >= 3 ? 'Northeast' : 'North';
        return `${ew} Coral Gables`;
    }
    const south = pointId.match(/^south_(\d)$/);
    if (south) {
        const i = Number(south[1]);
        const ew = i <= 1 ? 'Southwest' : i === 2 ? 'South (center)' : i >= 3 ? 'Southeast' : 'South';
        return `${ew} Coral Gables`;
    }
    if (pointId.startsWith('middle_')) {
        const i = Number(pointId.split('_')[1]);
        const ew = i <= 1 ? 'West midtown' : i >= 3 ? 'East midtown' : 'Midtown';
        return `${ew} Coral Gables`;
    }
    if (pointId === 'mid_layer_north') {
        return 'upper midtown Coral Gables';
    }
    if (pointId === 'mid_layer_south') {
        return 'lower midtown Coral Gables';
    }
    return 'a station on the grid';
}

/** Short tag for how a temperature “feels” (hot / cold / perfect-ish). */
function describeTempFeelTag(tempF) {
    const t = Number(tempF);
    if (!Number.isFinite(t)) {
        return 'mixed';
    }
    if (t >= 90) {
        return 'really hot';
    }
    if (t >= 82) {
        return 'quite hot';
    }
    if (t >= 75) {
        return 'warm';
    }
    if (t >= 68 && t <= 78) {
        return 'pretty perfect';
    }
    if (t >= 62) {
        return 'mild';
    }
    if (t >= 52) {
        return 'cool';
    }
    if (t >= 40) {
        return 'cold';
    }
    return 'really cold';
}

function computeSamplingTemperatureExtremes(samplingPoints) {
    const pts = (samplingPoints || []).filter(
        (p) =>
            p &&
            p.weatherData &&
            typeof p.weatherData.temperature === 'number' &&
            Number.isFinite(p.weatherData.temperature) &&
            !p.weatherData.error
    );
    if (pts.length < 5) {
        return null;
    }
    let maxP = pts[0];
    let minP = pts[0];
    for (const p of pts) {
        const v = p.weatherData.temperature;
        if (v > maxP.weatherData.temperature) {
            maxP = p;
        }
        if (v < minP.weatherData.temperature) {
            minP = p;
        }
    }
    const maxT = maxP.weatherData.temperature;
    const minT = minP.weatherData.temperature;
    const spread = maxT - minT;
    if (spread <= 0) {
        return null;
    }
    return { maxP, minP, maxT, minT, spread, n: pts.length };
}

function buildMicroclimateToastBody(ext) {
    const hotName = getCoralGablesAreaLabel(ext.maxP.id);
    const coolName = getCoralGablesAreaLabel(ext.minP.id);
    const hotTag = describeTempFeelTag(ext.maxT);
    const coolTag = describeTempFeelTag(ext.minT);
    const spreadR = Math.round(ext.spread);

    const sameSpot = ext.maxP.id === ext.minP.id;
    if (sameSpot) {
        return null;
    }

    return pickRandomString([
        `Across Coral Gables the grid is split about ${spreadR}°F: ${hotName} is running ${hotTag} (~${Math.round(
            ext.maxT
        )}°F) while ${coolName} is ${coolTag} (~${Math.round(ext.minT)}°F). Same city, different thermostat.`,
        `Microclimate alert (friendly): ${hotName} is the hot pocket today—${hotTag} at ~${Math.round(
            ext.maxT
        )}°F—while ${coolName} stays ${coolTag} (~${Math.round(ext.minT)}°F). That is a ~${spreadR}°F swing.`,
        `Heads up: ~${spreadR}°F separates the warmest and coolest corners. ${hotName} feels ${hotTag} (~${Math.round(
            ext.maxT
        )}°F); ${coolName} is ${coolTag} (~${Math.round(ext.minT)}°F). Plan layers if you are crossing the grid.`,
        `Plot twist: ${coolName} is the relative cool zone (${coolTag}, ~${Math.round(
            ext.minT
        )}°F) and ${hotName} is baking (${hotTag}, ~${Math.round(ext.maxT)}°F)—roughly ${spreadR}°F apart.`,
        `The map is not shy today: ${hotName} ~${Math.round(ext.maxT)}°F (${hotTag}) vs ${coolName} ~${Math.round(
            ext.minT
        )}°F (${coolTag}). Coral Gables is doing several seasons at once.`,
        `Drastic spread (~${spreadR}°F): ${hotName} reads ${hotTag} (~${Math.round(
            ext.maxT
        )}°F); ${coolName} feels ${coolTag} (~${Math.round(ext.minT)}°F). Dress for the neighborhood, not just the average.`
    ]);
}

function maybeScheduleMicroclimateToast() {
    if (!CONFIG.MICROCLIMATE_TOAST_ENABLED) {
        return;
    }
    const delay = Math.max(500, Number(CONFIG.MICROCLIMATE_TOAST_DELAY_MS) || 3600);
    setTimeout(() => {
        try {
            attemptMicroclimateToast();
        } catch (e) {
            console.warn('Microclimate toast:', e);
        }
    }, delay);
}

function attemptMicroclimateToast() {
    if (!CONFIG.MICROCLIMATE_TOAST_ENABLED) {
        return;
    }
    const isSample = state.samplingPoints.some((p) => p.weatherData?.source === 'sample-data');
    if (isSample) {
        return;
    }

    const minSpread = Math.max(4, Number(CONFIG.MICROCLIMATE_MIN_SPREAD_F) || 10);
    const chance = Math.min(1, Math.max(0, Number(CONFIG.MICROCLIMATE_TOAST_CHANCE) ?? 0.38));
    const minGap = Math.max(60 * 1000, Number(CONFIG.MICROCLIMATE_TOAST_MIN_INTERVAL_MS) || 8 * 60 * 1000);

    if (Math.random() > chance) {
        return;
    }
    if (Date.now() - state.lastMicroclimateToastAt < minGap) {
        return;
    }

    const ext = computeSamplingTemperatureExtremes(state.samplingPoints);
    if (!ext || ext.spread < minSpread) {
        return;
    }

    const body = buildMicroclimateToastBody(ext);
    if (!body) {
        return;
    }

    showMicroclimateToast(body);
    state.lastMicroclimateToastAt = Date.now();
}

function showMicroclimateToast(message) {
    const host = document.getElementById('alertToastHost');
    if (!host) {
        return;
    }
    const key = '__microclimate__';
    const existingTimer = alertToastRuntime.autoHideTimers.get(key);
    if (existingTimer) {
        clearTimeout(existingTimer);
        alertToastRuntime.autoHideTimers.delete(key);
    }
    for (const el of host.querySelectorAll('.alert-toast--microclimate')) {
        el.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'alert-toast alert-toast--microclimate';
    toast.setAttribute('role', 'status');

    const text = document.createElement('div');
    text.className = 'alert-toast__text';
    text.textContent = message;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'alert-toast__dismiss';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.textContent = '✕';
    btn.addEventListener('click', () => dismissAlertToast(toast, key, true));

    toast.appendChild(text);
    toast.appendChild(btn);
    host.appendChild(toast);

    const autoMs = CONFIG.MICROCLIMATE_TOAST_AUTO_DISMISS_MS ?? 12000;
    const timerId = setTimeout(() => {
        alertToastRuntime.autoHideTimers.delete(key);
        dismissAlertToast(toast, key, false);
    }, autoMs);
    alertToastRuntime.autoHideTimers.set(key, timerId);
}

/**
 * Remove NWS toasts that are no longer in the active feed (expired / cancelled alerts).
 */
function reconcileNwsAlertToastsInDom(host, activeAlerts) {
    const activeKeys = new Set(activeAlerts.map(alertStableKey));
    for (const el of [...host.querySelectorAll('.alert-toast--nws')]) {
        const k = el.dataset.nwsKey;
        if (!k || !activeKeys.has(k)) {
            const pending = alertToastRuntime.autoHideTimers.get(k);
            if (pending) {
                clearTimeout(pending);
            }
            if (k) {
                alertToastRuntime.autoHideTimers.delete(k);
                alertToastRuntime.shownIds.delete(k);
            }
            el.remove();
        }
    }
}

/**
 * Visual bucket for NWS headline/event (storm, rain, fog, flood, etc.).
 */
function classifyNwsAlertVisualClass(alert) {
    const s = `${alert.event || ''} ${alert.headline || ''}`.toLowerCase();
    if (/tornado|hurricane|typhoon|extreme wind|extreme cold/.test(s)) {
        return 'alert-toast--nws-severe';
    }
    if (/severe thunderstorm|thunderstorm warning|thunderstorm watch|lightning|hail|squall|waterspout/.test(s)) {
        return 'alert-toast--nws-storm';
    }
    if (/flash flood|river flood|coastal flood|flood warning|flood advisory|areal flood|hydrologic/.test(s)) {
        return 'alert-toast--nws-flood';
    }
    if (/blizzard|winter storm|ice storm|freeze|frost|snow|sleet|freezing rain|winter weather|wind chill/.test(s)) {
        return 'alert-toast--nws-winter';
    }
    if (/excessive heat|heat advisory|heat warning|heat watch|red flag|fire weather/.test(s)) {
        return 'alert-toast--nws-heat';
    }
    if (/dense fog|fog advisory|fog|mist|dense smoke|low visibility/.test(s)) {
        return 'alert-toast--nws-fog';
    }
    if (/rain|shower|drizzle|precipitation|flood watch|hydrologic outlook/.test(s)) {
        return 'alert-toast--nws-rain';
    }
    if (/high wind|wind advisory|wind warning|gale|tropical storm|coastal hazard|rip current|surf|marine|beach|small craft/.test(s)) {
        return 'alert-toast--nws-wind';
    }
    const sev = alert.severity || '';
    if (sev === 'Extreme' || sev === 'Severe') {
        return 'alert-toast--nws-severe';
    }
    if (sev === 'Moderate') {
        return 'alert-toast--nws-warning';
    }
    if (sev === 'Minor') {
        return 'alert-toast--nws-advisory';
    }
    return 'alert-toast--nws-default';
}

function nwsAlertsCoverHazard(nwsAlerts, hazard) {
    const t = (nwsAlerts || []).map((a) => `${a.event || ''} ${a.headline || ''}`).join(' ').toLowerCase();
    if (hazard === 'storm') {
        return /thunder|tornado|severe|hurricane|tropical|wind advisory|wind warning|gale|waterspout|lightning|hail|marine|surf|rip|coastal|storm|squall/.test(
            t
        );
    }
    if (hazard === 'rain') {
        return /rain|shower|flood|thunder|storm|precipitation|drizzle|hydrologic/.test(t);
    }
    if (hazard === 'fog') {
        return /fog|mist|dense smoke|visibility/.test(t);
    }
    if (hazard === 'snow') {
        return /snow|ice|winter|freeze|blizzard|sleet|frost/.test(t);
    }
    return false;
}

/**
 * One “live conditions” toast when API/scene suggests storm, rain, fog, or snow but NWS list does not spell it out.
 */
function showLiveWeatherSupplementToasts(nwsAlerts) {
    if (!CONFIG.LIVE_CONDITION_SUPPLEMENT_ENABLED || !state.alertsUiEnabled) {
        return;
    }
    if (state.lastNwsAlertsFetchOk !== true) {
        return;
    }
    const host = document.getElementById('alertToastHost');
    if (!host) {
        return;
    }
    if (state.samplingPoints.some((p) => p.weatherData?.source === 'sample-data')) {
        return;
    }

    const supKey = '__live_condition_supplement__';
    for (const el of host.querySelectorAll('.alert-toast--live-supplement')) {
        el.remove();
    }
    const oldT = alertToastRuntime.autoHideTimers.get(supKey);
    if (oldT) {
        clearTimeout(oldT);
        alertToastRuntime.autoHideTimers.delete(supKey);
    }

    const w = pickRepresentativeWeatherSampleFromPoints(state.samplingPoints);
    if (!w) {
        return;
    }

    const mode = deriveSceneWeatherModeFromApiData(w);
    const desc = String(w.weatherDescription || w.weather || '').toLowerCase();
    const gust = typeof w.windGust === 'number' && Number.isFinite(w.windGust) ? w.windGust : 0;
    const wind = typeof w.windSpeed === 'number' && Number.isFinite(w.windSpeed) ? w.windSpeed : 0;

    let message = null;
    let variant = 'alert-toast--live-supplement alert-toast--live-default';

    if (!nwsAlertsCoverHazard(nwsAlerts, 'storm') && (desc.includes('thunder') || gust >= 38 || wind >= 32)) {
        variant = 'alert-toast--live-supplement alert-toast--live-storm';
        message = pickRandomString([
            `Live conditions: merged stations show strong wind (~${Math.round(wind)} mph${
                gust ? `, gusts ~${Math.round(gust)}` : ''
            }). No storm-class alert is active for this map point in the NWS feed—use radar and caution.`,
            'Live: wind is flexing today. Sky may be cooking up drama—check radar and shelter if it gets loud.',
            'Live snapshot: breezy to rowdy winds. If thunder crashes the party, head indoors—common sense, uncommon wind.'
        ]);
    } else if (!nwsAlertsCoverHazard(nwsAlerts, 'snow') && mode === 'snowy') {
        variant = 'alert-toast--live-supplement alert-toast--live-winter';
        message = pickRandomString([
            'Live conditions: snow/ice showing in station data. Roads may disagree with your tires—take it slow.',
            'Live: wintry mix energy detected. Warm socks, gentle braking, hot cocoa diplomacy.'
        ]);
    } else if (!nwsAlertsCoverHazard(nwsAlerts, 'fog') && mode === 'foggy') {
        variant = 'alert-toast--live-supplement alert-toast--live-fog';
        message = pickRandomString([
            'Live conditions: fog/mist in the readings—visibility might be doing impressions of a ghost.',
            'Live: pea-soup vibes. Low beams on, speed down, drama optional.',
            'Live snapshot: fog on the sensors. Treat intersections like plot twists—slow and attentive.'
        ]);
    } else if (!nwsAlertsCoverHazard(nwsAlerts, 'rain') && (mode === 'rainy' || /rain|shower|drizzle/.test(desc))) {
        variant = 'alert-toast--live-supplement alert-toast--live-rain';
        message = pickRandomString([
            'Live conditions: rain or drizzle in the merged station feed—grab cover; puddles are social hubs.',
            'Live: wet pavement arc. Umbrella up, cornering gentle, playlist appropriately melancholic.',
            'Live snapshot: precipitation detected. Good day to be waterproof and smug about your jacket choice.'
        ]);
    }

    if (!message) {
        return;
    }

    const toast = document.createElement('div');
    toast.className = `alert-toast ${variant}`;
    toast.setAttribute('role', 'status');

    const text = document.createElement('div');
    text.className = 'alert-toast__text';
    text.textContent = message;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'alert-toast__dismiss';
    btn.setAttribute('aria-label', 'Dismiss live conditions notice');
    btn.textContent = '✕';
    btn.addEventListener('click', () => dismissAlertToast(toast, supKey, true));

    toast.appendChild(text);
    toast.appendChild(btn);
    host.appendChild(toast);

    const autoMs = Number(CONFIG.LIVE_CONDITION_SUPPLEMENT_AUTO_DISMISS_MS);
    if (autoMs > 0) {
        const timerId = setTimeout(() => {
            alertToastRuntime.autoHideTimers.delete(supKey);
            dismissAlertToast(toast, supKey, false);
        }, autoMs);
        alertToastRuntime.autoHideTimers.set(supKey, timerId);
    }
}

/**
 * Small top-center toasts; dismissible; optional auto fade-out (0 = keep until dismissed or API removes).
 */
function showWeatherAlertToasts(alerts) {
    if (!state.alertsUiEnabled) {
        return;
    }
    const host = document.getElementById('alertToastHost');
    if (!host) {
        return;
    }
    const list = Array.isArray(alerts) ? alerts : [];
    reconcileNwsAlertToastsInDom(host, list);
    pruneAlertToastTracking(list);

    const max = CONFIG.ALERT_TOAST_MAX_VISIBLE;
    const capped = !max || max <= 0 ? list : list.slice(0, max);

    for (const alert of capped) {
        const key = alertStableKey(alert);
        if (alertToastRuntime.dismissedIds.has(key)) {
            continue;
        }
        if (alertToastRuntime.shownIds.has(key)) {
            continue;
        }
        alertToastRuntime.shownIds.add(key);

        const toast = document.createElement('div');
        const visual = classifyNwsAlertVisualClass(alert);
        toast.className = `alert-toast alert-toast--nws ${visual}`;
        toast.setAttribute('role', 'alert');
        toast.dataset.nwsKey = key;

        const text = document.createElement('div');
        text.className = 'alert-toast__text';
        text.textContent = alert.headline || alert.event || 'Weather alert';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'alert-toast__dismiss';
        btn.setAttribute('aria-label', 'Dismiss alert');
        btn.textContent = '✕';
        btn.addEventListener('click', () => dismissAlertToast(toast, key, true));

        toast.appendChild(text);
        toast.appendChild(btn);
        host.appendChild(toast);

        const autoMs = Number(CONFIG.ALERT_TOAST_AUTO_DISMISS_MS);
        if (autoMs > 0) {
            const timerId = setTimeout(() => {
                alertToastRuntime.autoHideTimers.delete(key);
                dismissAlertToast(toast, key, false);
            }, autoMs);
            alertToastRuntime.autoHideTimers.set(key, timerId);
        }
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

function updateProgress() {}
// data status helpers moved to `js/ui/dataStatus.js`

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
    const tempHeaderEl = document.getElementById('cgLiveTempHeader');
    const condEl = document.getElementById('cgLiveCondition');
    const windEl = document.getElementById('cgLiveWind');
    const srcEl = document.getElementById('cgLiveSource');
    if (!tempEl || !condEl) {
        return;
    }
    if (!w || typeof w.temperature !== 'number') {
        tempEl.textContent = '--°F';
        if (tempHeaderEl) {
            tempHeaderEl.textContent = '--°F';
        }
        condEl.textContent = '—';
        if (windEl) {
            windEl.textContent = 'Wind: —';
        }
        if (srcEl) {
            srcEl.textContent = '';
        }
        return;
    }
    const tempStr = `${Math.round(w.temperature)}°F`;
    tempEl.textContent = tempStr;
    if (tempHeaderEl) {
        tempHeaderEl.textContent = tempStr;
    }
    const cond =
        (typeof w.weatherDescription === 'string' && w.weatherDescription.trim()) ||
        (typeof w.weather === 'string' && w.weather.trim()) ||
        '—';
    condEl.textContent = cond;
    if (windEl) {
        if (
            typeof w.windSpeed === 'number' &&
            Number.isFinite(w.windSpeed) &&
            typeof w.windDirection === 'number' &&
            Number.isFinite(w.windDirection)
        ) {
            const comp = windDirectionToCompass16(w.windDirection);
            const deg = Math.round(((w.windDirection % 360) + 360) % 360);
            let line = `Wind: ${w.windSpeed.toFixed(1)} mph from ${comp} (${deg}°)`;
            if (
                typeof w.windGust === 'number' &&
                Number.isFinite(w.windGust) &&
                w.windGust > w.windSpeed + 0.5
            ) {
                line += ` · gusts ${w.windGust.toFixed(1)} mph`;
            }
            windEl.textContent = line;
        } else {
            windEl.textContent = 'Wind: —';
        }
    }
    if (srcEl) {
        const raw = w.sources || w.source || '';
        const parts = [];
        if (raw) {
            parts.push(`Sources: ${raw}`);
        }
        if (typeof w.timestamp === 'number' && Number.isFinite(w.timestamp)) {
            const age = Date.now() - w.timestamp;
            const obs = new Date(w.timestamp);
            const obsStr = obs.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            if (age >= 0 && age < 2 * 60 * 60 * 1000) {
                parts.push(`Observation ${obsStr} (${Math.round(age / 60000)} min ago)`);
            } else if (age >= 0) {
                parts.push(`Observation ${obsStr}`);
            }
        }
        srcEl.textContent = parts.join(' · ');
    }
}

function updateSnapshotCount() {
    const countEl = document.getElementById('snapshotCount');
    if (countEl) {
        countEl.textContent = state.historicalSnapshots.length;
    }
}

function showError(message) {
    debugLog(message, true);
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
 * Camera pose for terminal debug. Global scenes: x = longitude (°), y = latitude (°), z = eye altitude (m).
 * Local/projected views fall back to map x/y/z.
 */
function formatSceneCameraPositionLine(camera) {
    if (!camera || !camera.position) {
        return null;
    }
    const p = camera.position;
    const h = typeof camera.heading === 'number' && Number.isFinite(camera.heading) ? camera.heading : null;
    const t = typeof camera.tilt === 'number' && Number.isFinite(camera.tilt) ? camera.tilt : null;
    const ht = (h != null ? ` h=${h.toFixed(1)}°` : '') + (t != null ? ` t=${t.toFixed(1)}°` : '');
    if (p.longitude != null && p.latitude != null) {
        const x = Number(p.longitude);
        const y = Number(p.latitude);
        const z = typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : 0;
        return `camera x=${x.toFixed(6)}° y=${y.toFixed(6)}° z=${z.toFixed(1)}m${ht}`;
    }
    const x = typeof p.x === 'number' ? p.x : 0;
    const y = typeof p.y === 'number' ? p.y : 0;
    const z = typeof p.z === 'number' && Number.isFinite(p.z) ? p.z : 0;
    return `camera x=${x.toFixed(2)} y=${y.toFixed(2)} z=${z.toFixed(2)} (map units)${ht}`;
}

/**
 * Throttled logging of SceneView camera to the dev server terminal (`POST /__debug_log`, see vite.config.js).
 */
function wireSceneCameraDebugToTerminal(sceneView) {
    if (!CONFIG.CAMERA_DEBUG_LOG_ENABLED || !sceneView || typeof sceneView.watch !== 'function') {
        return;
    }
    try {
        if (state.cameraDebugWatchHandle && typeof state.cameraDebugWatchHandle.remove === 'function') {
            state.cameraDebugWatchHandle.remove();
            state.cameraDebugWatchHandle = null;
        }
    } catch (e) {
        /* ignore */
    }
    const interval = Math.max(50, Number(CONFIG.CAMERA_DEBUG_LOG_INTERVAL_MS) || 200);
    let lastEmit = 0;
    state.cameraDebugWatchHandle = sceneView.watch('camera', () => {
        const cam = sceneView.camera;
        const now = Date.now();
        if (now - lastEmit < interval) {
            return;
        }
        lastEmit = now;
        const line = formatSceneCameraPositionLine(cam);
        if (line) {
            debugLog(line);
        }
    });
}

/**
 * Debug logging — browser console + terminal when using Vite dev or preview (`run.sh` uses preview).
 */
function debugLog(message, isError = false) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (isError) {
        console.error(line);
    } else {
        console.log(line);
    }
    if (typeof fetch === 'undefined') {
        return;
    }
    fetch('/__debug_log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line, isError }),
        keepalive: true
    }).catch(() => {
        /* no local server or static host — ignore */
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
