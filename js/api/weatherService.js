import { CONFIG } from '../config.js';
import * as OpenWeatherMap from './openweathermap.js';
import * as NOAA from './noaa.js';
import * as OpenMeteo from './openmeteo.js';

/**
 * Unified weather service with intelligent multi-API merging
 * Pulls from OpenWeatherMap, Open-Meteo, and NOAA to get the best available data.
 *
 * **Units (after parse):** temperature °F, wind speed mph, wind gust mph, pressure ~mb,
 * wind direction ° **meteorological** (direction the wind blows *from*, 0–360 clockwise from N).
 * Open-Meteo requests `temperature_unit=fahrenheit&wind_speed_unit=mph`; OpenWeatherMap uses `units=imperial`;
 * NOAA observations convert °C→°F and m/s→mph in `noaa.js`.
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
function mergeWeatherData(sources, mergePriority = MERGE_PRIORITY_DEFAULT) {
    const merged = {};
    
    // Collect all fields from all sources with priority scoring
    const fieldScores = {};
    
    sources.forEach(source => {
        if (!source) return;
        
        const priority = mergePriority[source.source] ?? 999;
        
        Object.keys(source).forEach(key => {
            const value = source[key];
            
            // Skip invalid/default/placeholder values
            if (value === null || value === undefined || value === 'Unknown' || value === 'smoke' || value === 'unknown') {
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
 * Fetch current weather from multiple sources with intelligent merging
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
    merged.sources = sources.map(s => s.source).join(', ');
    merged.source = sources.map(s => s.source).join(', ');
    
    return merged;
}

/**
 * Fetch forecast data from multiple sources with intelligent merging
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
    
    best.sources = sources.map(s => s.source).join(', ');
    
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
    const results = [];
    const total = samplingPoints.length;
    
    for (let i = 0; i < samplingPoints.length; i++) {
        const point = samplingPoints[i];
        
        if (centerWeather && point.id === centerPointId) {
            results.push({
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                ...centerWeather,
                success: true
            });
            if (onProgress) {
                onProgress(i + 1, total);
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
            continue;
        }
        
        try {
            const weatherData = await fetchCurrentWeather(point.latitude, point.longitude, {
                mergePriority
            });
            results.push({
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                ...weatherData,
                success: true
            });
        } catch (error) {
            console.error(`Failed to fetch weather for point ${point.id}:`, error);
            results.push({
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                error: error.message,
                success: false
            });
        }
        
        // Call progress callback
        if (onProgress) {
            onProgress(i + 1, total);
        }
        
        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    
    return results;
}

/**
 * Batch fetch forecast for all sampling points
 */
export async function fetchBatchForecast(samplingPoints, onProgress = null) {
    const results = [];
    const total = samplingPoints.length;
    
    for (let i = 0; i < samplingPoints.length; i++) {
        const point = samplingPoints[i];
        
        try {
            const forecastData = await fetchForecast(point.latitude, point.longitude);
            results.push({
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                ...forecastData,
                success: true
            });
        } catch (error) {
            console.error(`Failed to fetch forecast for point ${point.id}:`, error);
            results.push({
                pointId: point.id,
                latitude: point.latitude,
                longitude: point.longitude,
                error: error.message,
                success: false
            });
        }
        
        if (onProgress) {
            onProgress(i + 1, total);
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    return results;
}

/**
 * Get forecast at specific time offset
 */
export function getForecastAtOffset(forecastData, hoursAhead) {
    return OpenWeatherMap.getForecastAtOffset(forecastData, hoursAhead);
}
