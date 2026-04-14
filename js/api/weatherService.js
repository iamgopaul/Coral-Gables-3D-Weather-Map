import { CONFIG } from '../config.js';
import * as OpenWeatherMap from './openweathermap.js';
import * as NOAA from './noaa.js';
import * as OpenMeteo from './openmeteo.js';

/**
 * @file Unified weather service: multi-API fetch, field merge, batching, and forecast enrichment.
 * Pulls from OpenWeatherMap, Open-Meteo, and NOAA (`noaa.js`, `openmeteo.js`, `openweathermap.js`).
 *
 * **Units (after parse):** temperature °F, wind speed mph, wind gust mph, pressure ~mb,
 * wind direction ° **meteorological** (direction the wind blows *from*, 0–360 clockwise from N).
 * Open-Meteo requests `temperature_unit=fahrenheit&wind_speed_unit=mph`; OpenWeatherMap uses `units=imperial`;
 * NOAA observations convert °C→°F and NWS wind `QuantitativeValue` (e.g. km/h)→mph in `noaa.js`.
 */

let warnedMissingOpenWeatherMapKey = false;

function isOpenWeatherMapConfigured() {
    const k = CONFIG.OPENWEATHERMAP_API_KEY;
    return typeof k === 'string' && k.trim().length > 0;
}

function warnOpenWeatherMapDisabled() {
    if (warnedMissingOpenWeatherMapKey) {
        return;
    }
    warnedMissingOpenWeatherMapKey = true;
    console.warn(
        '[weather] OpenWeatherMap is skipped: no API key. Set VITE_OPENWEATHERMAP_API_KEY in a root `.env` file ' +
            '(see `.env.example` — the name must start with VITE_), then run `./run.sh` or `npm run dev` so Vite injects it.'
    );
}

/** Lower number = wins when merging field-by-field (default: global models first). */
export const MERGE_PRIORITY_DEFAULT = {
    OpenWeatherMap: 1,
    'Open-Meteo': 2,
    NOAA: 3
};

/**
 * Prefer NOAA/NWS station observations first — best match for “live” US local conditions
 * (e.g. Coral Gables vs Weather.gov). Use for the canonical city location only.
 */
export const MERGE_PRIORITY_NOAA_FIRST = {
    NOAA: 1,
    OpenWeatherMap: 2,
    'Open-Meteo': 3
};

/**
 * Merge weather data from multiple sources prioritizing completeness and accuracy.
 * @param {object[]} sources Parsed objects with a `source` field
 * @param {Record<string, number>} mergePriority Lower number = higher priority per field
 */
export function mergeWeatherData(sources, mergePriority = MERGE_PRIORITY_DEFAULT) {
    const merged = {};

    // Collect all fields from all sources with priority scoring
    const fieldScores = {};

    sources.forEach((source) => {
        if (!source) return;

        const priority = mergePriority[source.source] ?? 999;

        Object.keys(source).forEach((key) => {
            const value = source[key];

            // Skip invalid/default/placeholder values
            if (
                value === null ||
                value === undefined ||
                value === 'Unknown' ||
                value === 'smoke' ||
                value === 'unknown'
            ) {
                return;
            }

            // Special handling for weather description - avoid generic/placeholder values
            if (key === 'weatherDescription' && typeof value === 'string') {
                if (value.toLowerCase().includes('smoke') || value.toLowerCase() === 'unknown') {
                    return;
                }
            }

            // If we haven't seen this field or this source has better priority
            if (!(key in fieldScores) || priority < fieldScores[key].priority) {
                fieldScores[key] = {
                    value: value,
                    priority: priority,
                    source: source.source
                };
            }
        });
    });

    // Extract just the values and log sources
    Object.keys(fieldScores).forEach((key) => {
        merged[key] = fieldScores[key].value;
    });

    return merged;
}

/**
 * Fetch current weather from multiple sources with intelligent merging.
 * @param {number} latitude
 * @param {number} longitude
 * @param {{ mergePriority?: Record<string, number> }} [options] — defaults to {@link MERGE_PRIORITY_DEFAULT}
 * @returns {Promise<object>} Merged fields plus `source` / `sources` strings
 */
export async function fetchCurrentWeather(latitude, longitude, options = {}) {
    const mergePriority = options.mergePriority || MERGE_PRIORITY_DEFAULT;
    const useOwm = isOpenWeatherMapConfigured();
    if (!useOwm) {
        warnOpenWeatherMapDisabled();
    }

    const promises = [];
    const apiNames = [];
    if (useOwm) {
        promises.push(OpenWeatherMap.fetchCurrentWeather(latitude, longitude));
        apiNames.push('OpenWeatherMap');
    }
    promises.push(OpenMeteo.fetchCurrentWeather(latitude, longitude));
    apiNames.push('Open-Meteo');
    promises.push(NOAA.fetchCurrentWeather(latitude, longitude));
    apiNames.push('NOAA');

    const results = await Promise.allSettled(promises);

    const sources = [];

    // Log what each API returned
    results.forEach((result, index) => {
        const api = apiNames[index];
        if (result.status === 'fulfilled' && result.value) {
            sources.push(result.value);
        } else if (result.status === 'rejected') {
            console.warn(`✗ ${api} failed:`, result.reason?.message);
        }
    });

    if (sources.length === 0) {
        throw new Error('All weather APIs failed');
    }

    // Merge data from all successful sources
    const merged = mergeWeatherData(sources, mergePriority);

    // Add source info
    merged.sources = sources.map((s) => s.source).join(', ');
    merged.source = sources.map((s) => s.source).join(', ');

    return merged;
}

/**
 * Pick the forecast period with timestamp closest to `targetMs`.
 * @param {{ timestamp?: number }[]} periods
 * @param {number} targetMs
 * @returns {{ timestamp?: number, pressure?: number|null, windGust?: number|null }|null}
 */
export function findClosestForecastPeriodByTime(periods, targetMs) {
    if (!Array.isArray(periods) || periods.length === 0) {
        return null;
    }
    const t = Number(targetMs);
    if (!Number.isFinite(t)) {
        return null;
    }
    let closest = null;
    let minDiff = Infinity;
    for (const f of periods) {
        const ts = Number(f.timestamp);
        if (!Number.isFinite(ts)) {
            continue;
        }
        const d = Math.abs(ts - t);
        if (d < minDiff) {
            minDiff = d;
            closest = f;
        }
    }
    return closest;
}

/**
 * When the chosen forecast source (often NOAA) omits a numeric field, copy from Open-Meteo
 * then OpenWeatherMap using the closest period by `timestamp`.
 * @param {{ forecasts?: object[] }} best
 * @param {object[]} sources
 * @param {'pressure'|'windGust'} field
 * @param {(n: number) => number} transform
 */
function enrichForecastFieldFromDonors(best, sources, field, transform) {
    if (!best?.forecasts?.length || !sources?.length) {
        return;
    }
    const donors = ['Open-Meteo', 'OpenWeatherMap']
        .map((name) => sources.find((s) => s && s.source === name))
        .filter((s) => s && Array.isArray(s.forecasts) && s.forecasts.length > 0);

    for (const period of best.forecasts) {
        const cur = period[field];
        if (cur != null && Number.isFinite(Number(cur))) {
            continue;
        }
        const t = Number(period.timestamp);
        if (!Number.isFinite(t)) {
            continue;
        }
        for (const donor of donors) {
            const match = findClosestForecastPeriodByTime(donor.forecasts, t);
            const v = match?.[field];
            if (v != null && Number.isFinite(Number(v))) {
                period[field] = transform(Number(v));
                break;
            }
        }
    }
}

/**
 * NOAA hourly often wins on period count but omits pressure. Fill `pressure` (mb) from
 * Open-Meteo / OpenWeatherMap by closest timestamp.
 * @param {{ forecasts?: object[] }} best
 * @param {object[]} sources
 */
export function enrichForecastPressureFromSources(best, sources) {
    enrichForecastFieldFromDonors(best, sources, 'pressure', (n) => Math.round(n));
}

/**
 * Same pattern as pressure: NOAA periods omit gusts; fill `windGust` (mph) from donors.
 * @param {{ forecasts?: object[] }} best
 * @param {object[]} sources
 */
export function enrichForecastWindGustFromSources(best, sources) {
    enrichForecastFieldFromDonors(best, sources, 'windGust', (n) => Math.round(n * 10) / 10);
}

/**
 * Parallel forecast from OWM (if configured), Open-Meteo, and NOAA; keeps the response with the
 * **most** `forecasts` periods, then enriches missing **pressure** and **windGust** from other sources.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{ forecasts: object[], source: string, sources: string }>}
 */
export async function fetchForecast(latitude, longitude) {
    const useOwm = isOpenWeatherMapConfigured();
    if (!useOwm) {
        warnOpenWeatherMapDisabled();
    }
    const promises = [];
    if (useOwm) {
        promises.push(OpenWeatherMap.fetchForecast(latitude, longitude));
    }
    promises.push(OpenMeteo.fetchForecast(latitude, longitude));
    promises.push(NOAA.fetchForecast(latitude, longitude));

    const results = await Promise.allSettled(promises);

    const sources = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter(Boolean);

    if (sources.length === 0) {
        throw new Error('All forecast APIs failed');
    }

    // Combine forecasts from all successful sources
    // Prioritize more recent/detailed forecasts
    let best = sources[0];

    // Prefer source with more forecast periods
    for (const source of sources) {
        if (source.forecasts && source.forecasts.length > (best.forecasts?.length || 0)) {
            best = source;
        }
    }

    best.sources = sources.map((s) => s.source).join(', ');
    try {
        enrichForecastPressureFromSources(best, sources);
        enrichForecastWindGustFromSources(best, sources);
    } catch (enrichErr) {
        console.error('Forecast field enrichment (pressure/gust) failed:', enrichErr);
    }

    return best;
}

/**
 * Fetch weather alerts (NOAA only). Resolves to `{ ok, alerts, error? }` — use `ok` to detect HTTP / parse failures vs. no active alerts.
 */
export async function fetchWeatherAlerts(latitude, longitude) {
    return await NOAA.fetchWeatherAlerts(latitude, longitude);
}

/**
 * Batch fetch current weather for all sampling points with fallback
 * @param {object} [options]
 * @param {Record<string, number>} [options.mergePriority] Per-field merge order for each point fetch
 * @param {object} [options.centerWeather] Pre-fetched merged weather for {@link options.centerPointId} (avoids duplicate API round-trip)
 * @param {string} [options.centerPointId]
 */
export async function fetchBatchWeather(samplingPoints, onProgress = null, options = {}) {
    const mergePriority = options.mergePriority || MERGE_PRIORITY_DEFAULT;
    const centerWeather = options.centerWeather;
    const centerPointId = options.centerPointId || 'center';
    const n = samplingPoints.length;
    if (n === 0) {
        return [];
    }

    const concurrency = Math.max(1, Math.min(Number(CONFIG.WEATHER_BATCH_CONCURRENCY) || 6, n));
    const waveGap = Number(CONFIG.WEATHER_BATCH_WAVE_GAP_MS) || 0;
    const results = new Array(n);
    let completed = 0;

    const bump = () => {
        completed++;
        if (onProgress) {
            onProgress(completed, n);
        }
    };

    async function fetchIndex(i) {
        const point = samplingPoints[i];
        if (centerWeather && point.id === centerPointId) {
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                ...centerWeather,
                success: true
            };
            bump();
            return;
        }
        try {
            const weatherData = await fetchCurrentWeather(point.latitude, point.longitude, {
                mergePriority
            });
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                ...weatherData,
                success: true
            };
        } catch (error) {
            console.error(`Failed to fetch weather for point ${point.id}:`, error);
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                error: error.message,
                success: false
            };
        }
        bump();
    }

    for (let start = 0; start < n; start += concurrency) {
        const end = Math.min(start + concurrency, n);
        const wave = [];
        for (let i = start; i < end; i++) {
            wave.push(fetchIndex(i));
        }
        await Promise.all(wave);
        if (waveGap > 0 && end < n) {
            await new Promise((r) => setTimeout(r, waveGap));
        }
    }

    return results;
}

/**
 * Parallel batch of {@link fetchForecast} per point (concurrency from `CONFIG`).
 * @param {object[]} samplingPoints — `{ id, latitude, longitude }`
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ pointId: string, success: boolean, forecasts?: object[], error?: string, ... }[]>}
 */
export async function fetchBatchForecast(samplingPoints, onProgress = null) {
    const n = samplingPoints.length;
    if (n === 0) {
        return [];
    }

    const concurrency = Math.max(1, Math.min(Number(CONFIG.WEATHER_BATCH_CONCURRENCY) || 6, n));
    const waveGap = Number(CONFIG.WEATHER_BATCH_WAVE_GAP_MS) || 0;
    const results = new Array(n);
    let completed = 0;

    const bump = () => {
        completed++;
        if (onProgress) {
            onProgress(completed, n);
        }
    };

    async function fetchIndex(i) {
        const point = samplingPoints[i];
        try {
            const forecastData = await fetchForecast(point.latitude, point.longitude);
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                ...forecastData,
                success: true
            };
        } catch (error) {
            console.error(`Failed to fetch forecast for point ${point.id}:`, error);
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                error: error.message,
                success: false
            };
        }
        bump();
    }

    for (let start = 0; start < n; start += concurrency) {
        const end = Math.min(start + concurrency, n);
        const wave = [];
        for (let i = start; i < end; i++) {
            wave.push(fetchIndex(i));
        }
        await Promise.all(wave);
        if (waveGap > 0 && end < n) {
            await new Promise((r) => setTimeout(r, waveGap));
        }
    }

    return results;
}

/**
 * Per-station hourly series (UTC) for the last ~48h from Open-Meteo, for historical playback.
 * @param {object[]} samplingPoints — `{ id, latitude, longitude }`
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{ pointId: string, success: boolean, hourly?: object[], latitude?: number, longitude?: number, error?: string }[]>}
 */
export async function fetchBatchHistoricalHourly(samplingPoints, onProgress = null) {
    const n = samplingPoints.length;
    if (n === 0) {
        return [];
    }

    const concurrency = Math.max(
        1,
        Math.min(Number(CONFIG.HISTORICAL_HOURLY_CONCURRENCY) || 2, n)
    );
    const waveGap = Number(CONFIG.HISTORICAL_HOURLY_WAVE_GAP_MS) || 0;
    const results = new Array(n);
    let completed = 0;

    const bump = () => {
        completed++;
        if (onProgress) {
            onProgress(completed, n);
        }
    };

    async function fetchIndex(i) {
        const point = samplingPoints[i];
        try {
            const { hourly } = await OpenMeteo.fetchHourlyPastWindow(point.latitude, point.longitude);
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                hourly: hourly || [],
                success: true
            };
        } catch (error) {
            console.error(`Failed to fetch historical hourly for point ${point.id}:`, error);
            results[i] = {
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                error: error.message,
                success: false
            };
        }
        bump();
    }

    for (let start = 0; start < n; start += concurrency) {
        const end = Math.min(start + concurrency, n);
        const wave = [];
        for (let i = start; i < end; i++) {
            wave.push(fetchIndex(i));
        }
        await Promise.all(wave);
        if (waveGap > 0 && end < n) {
            await new Promise((r) => setTimeout(r, waveGap));
        }
    }

    return results;
}

/**
 * Get forecast at specific time offset
 */
export function getForecastAtOffset(forecastData, hoursAhead) {
    return OpenWeatherMap.getForecastAtOffset(forecastData, hoursAhead);
}
