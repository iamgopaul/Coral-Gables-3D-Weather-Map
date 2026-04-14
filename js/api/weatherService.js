import * as OpenWeatherMap from './openweathermap.js';
import * as NOAA from './noaa.js';
import * as OpenMeteo from './openmeteo.js';

/**
 * Unified weather service with intelligent multi-API merging
 * Pulls from OpenWeatherMap, Open-Meteo, and NOAA to get the best available data
 */

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
    Object.keys(fieldScores).forEach(key => {
        merged[key] = fieldScores[key].value;
        if (key === 'weather' || key === 'weatherDescription' || key === 'visibility') {
            console.log(`🔄 Using ${key}: "${merged[key]}" from ${fieldScores[key].source}`);
        }
    });
    
    return merged;
}

/**
 * Fetch current weather from multiple sources with intelligent merging
 */
export async function fetchCurrentWeather(latitude, longitude, options = {}) {
    const mergePriority = options.mergePriority || MERGE_PRIORITY_DEFAULT;
    const results = await Promise.allSettled([
        OpenWeatherMap.fetchCurrentWeather(latitude, longitude),
        OpenMeteo.fetchCurrentWeather(latitude, longitude),
        NOAA.fetchCurrentWeather(latitude, longitude)
    ]);
    
    const sources = [];
    
    // Log what each API returned
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            sources.push(result.value);
            const api = ['OpenWeatherMap', 'Open-Meteo', 'NOAA'][index];
            console.log(`✓ ${api} returned:`, result.value);
        } else if (result.status === 'rejected') {
            const api = ['OpenWeatherMap', 'Open-Meteo', 'NOAA'][index];
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
    
    console.log(`📊 Merged weather data:`, merged);
    
    return merged;
}

/**
 * Fetch forecast data from multiple sources with intelligent merging
 */
export async function fetchForecast(latitude, longitude) {
    const results = await Promise.allSettled([
        OpenWeatherMap.fetchForecast(latitude, longitude),
        OpenMeteo.fetchForecast(latitude, longitude),
        NOAA.fetchForecast(latitude, longitude)
    ]);
    
    const sources = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
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
 * Fetch weather alerts (NOAA only)
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
