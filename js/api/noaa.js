import { CONFIG } from '../config.js';

/** WGS84 precision for api.weather.gov `point` and `/points/{lat},{lon}` (5 decimals ≈ 1.1 m). */
const NWS_COORD_DECIMALS = 5;

function formatNwsLatLon(latitude, longitude) {
    return `${Number(latitude).toFixed(NWS_COORD_DECIMALS)},${Number(longitude).toFixed(NWS_COORD_DECIMALS)}`;
}

function nwsHeaders() {
    return {
        'User-Agent': CONFIG.NWS_USER_AGENT || 'CoralGablesWeatherGrid/1.0',
        Accept: 'application/geo+json, application/json;q=0.9, */*;q=0.1'
    };
}

/**
 * Fetch current weather from NOAA Weather.gov API
 */
export async function fetchCurrentWeather(latitude, longitude) {
    try {
        // Step 1: Get grid point metadata
        const pointsUrl = `${CONFIG.NOAA_POINTS}/${formatNwsLatLon(latitude, longitude)}`;
        const pointsResponse = await fetch(pointsUrl, {
            headers: nwsHeaders()
        });
        
        if (!pointsResponse.ok) {
            throw new Error(`NOAA Points API error: ${pointsResponse.status}`);
        }
        
        const pointsData = await pointsResponse.json();
        
        // Step 2: Get observation stations
        const stationsUrl = pointsData.properties.observationStations;
        const stationsResponse = await fetch(stationsUrl, {
            headers: nwsHeaders()
        });
        
        if (!stationsResponse.ok) {
            throw new Error(`NOAA Stations API error: ${stationsResponse.status}`);
        }
        
        const stationsData = await stationsResponse.json();
        
        // Step 3: Get latest observation from nearest station
        if (!stationsData.features || stationsData.features.length === 0) {
            throw new Error('No observation stations found');
        }
        
        const nearestStation = stationsData.features[0].id;
        const observationUrl = `${nearestStation}/observations/latest`;
        const observationResponse = await fetch(observationUrl, {
            headers: nwsHeaders()
        });
        
        if (!observationResponse.ok) {
            throw new Error(`NOAA Observation API error: ${observationResponse.status}`);
        }
        
        const observationData = await observationResponse.json();
        return parseNOAAObservation(observationData);
    } catch (error) {
        console.error('NOAA fetch error:', error);
        throw error;
    }
}

/**
 * Fetch forecast data from NOAA
 */
export async function fetchForecast(latitude, longitude) {
    try {
        // Get grid point metadata
        const pointsUrl = `${CONFIG.NOAA_POINTS}/${formatNwsLatLon(latitude, longitude)}`;
        const pointsResponse = await fetch(pointsUrl, {
            headers: nwsHeaders()
        });
        
        if (!pointsResponse.ok) {
            throw new Error(`NOAA Points API error: ${pointsResponse.status}`);
        }
        
        const pointsData = await pointsResponse.json();
        
        // Get hourly forecast
        const forecastUrl = pointsData.properties.forecastHourly;
        const forecastResponse = await fetch(forecastUrl, {
            headers: nwsHeaders()
        });
        
        if (!forecastResponse.ok) {
            throw new Error(`NOAA Forecast API error: ${forecastResponse.status}`);
        }
        
        const forecastData = await forecastResponse.json();
        return parseNOAAForecast(forecastData);
    } catch (error) {
        console.error('NOAA forecast error:', error);
        throw error;
    }
}

/**
 * Fetch active weather alerts for a WGS84 point (returns structured result so callers can tell errors from “none active”).
 */
export async function fetchWeatherAlerts(latitude, longitude) {
    try {
        const url = `${CONFIG.NOAA_ALERTS}?point=${formatNwsLatLon(latitude, longitude)}`;
        const response = await fetch(url, {
            headers: nwsHeaders()
        });

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            throw new Error(`NOAA Alerts API error: ${response.status}${errBody ? ` — ${errBody.slice(0, 160)}` : ''}`);
        }

        const data = await response.json();
        const alerts = parseNOAAAlerts(data);
        return { ok: true, alerts };
    } catch (error) {
        console.error('NOAA alerts fetch error:', error);
        return {
            ok: false,
            alerts: [],
            error: error && error.message ? error.message : String(error)
        };
    }
}

/** NWS observation wind is m/s; app uses mph everywhere for display and merge. */
const METERS_PER_SECOND_TO_MPH = 2.2369362920544;

function celsiusToFahrenheitNullable(c) {
    if (c === null || c === undefined || Number.isNaN(Number(c))) {
        return null;
    }
    return (Number(c) * 9) / 5 + 32;
}

function metersPerSecondToMphNullable(ms) {
    if (ms === null || ms === undefined || Number.isNaN(Number(ms))) {
        return null;
    }
    return Number(ms) * METERS_PER_SECOND_TO_MPH;
}

function pickNoaaFeelsLikeF(props) {
    const wc = props.windChill?.value;
    const hi = props.heatIndex?.value;
    if (wc !== null && wc !== undefined && !Number.isNaN(Number(wc))) {
        return celsiusToFahrenheitNullable(wc);
    }
    if (hi !== null && hi !== undefined && !Number.isNaN(Number(hi))) {
        return celsiusToFahrenheitNullable(hi);
    }
    return null;
}

/**
 * Parse NOAA observation (api.weather.gov) — temps in °C and wind in m/s from API; output matches other providers: °F, mph, wind direction ° meteorological (from).
 */
function parseNOAAObservation(data) {
    const props = data.properties;

    const humidityRaw = props.relativeHumidity?.value;
    const pressurePa = props.barometricPressure?.value;

    return {
        temperature: celsiusToFahrenheitNullable(props.temperature?.value),
        feelsLike: pickNoaaFeelsLikeF(props),
        humidity: humidityRaw !== null && humidityRaw !== undefined ? humidityRaw : null,
        pressure: pressurePa != null && !Number.isNaN(Number(pressurePa)) ? Number(pressurePa) / 100 : null,
        windSpeed: metersPerSecondToMphNullable(props.windSpeed?.value),
        /** Degrees clockwise from true N, 0–360: direction wind blows *from* (same as Open-Meteo / OpenWeatherMap). */
        windDirection:
            props.windDirection?.value !== null && props.windDirection?.value !== undefined
                ? Number(props.windDirection.value)
                : null,
        windGust: metersPerSecondToMphNullable(props.windGust?.value),
        precipitation: 0,
        cloudCover:
            props.cloudLayers && props.cloudLayers.length > 0
                ? Math.max(
                      ...props.cloudLayers.map((l) =>
                          l.amount === 'OVC' ? 100 : l.amount === 'BKN' ? 75 : l.amount === 'SCT' ? 50 : 25
                      )
                  )
                : 0,
        visibility:
            props.visibility?.value != null && !Number.isNaN(Number(props.visibility.value))
                ? Math.round(Number(props.visibility.value))
                : null,
        weather: props.textDescription ? props.textDescription.toLowerCase() : 'unknown',
        weatherDescription: props.textDescription || 'Unknown',
        timestamp: new Date(props.timestamp).getTime(),
        source: 'NOAA'
    };
}

/**
 * Parse NOAA forecast data
 */
function parseNOAAForecast(data) {
    const periods = data.properties.periods;
    
    return {
        forecasts: periods.map(period => ({
            temperature: period.temperature,
            feelsLike: period.temperature, // NOAA doesn't provide feels-like in forecast
            humidity: period.relativeHumidity?.value || null,
            windSpeed: parseWindSpeed(period.windSpeed),
            windDirection: parseWindDirection(period.windDirection),
            precipitation: period.probabilityOfPrecipitation?.value || 0,
            weather: period.shortForecast.toLowerCase(),
            weatherDescription: period.detailedForecast,
            timestamp: new Date(period.startTime).getTime(),
            probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value || 0
        })),
        source: 'NOAA'
    };
}

function nwsSeverityRank(sev) {
    const order = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
    return order[sev] ?? 5;
}

function nwsUrgencyRank(u) {
    const order = { Immediate: 0, Expected: 1, Future: 2, Past: 3, Unknown: 4 };
    return order[u] ?? 5;
}

/**
 * Parse NOAA weather alerts: drop expired, dedupe by id, sort by severity / urgency / onset.
 */
function parseNOAAAlerts(data) {
    if (!data?.features?.length) {
        return [];
    }

    const now = Date.now();
    const seen = new Set();
    const rows = [];

    for (const feature of data.features) {
        const p = feature.properties;
        if (!p) {
            continue;
        }
        const id = p.id;
        const expMs = p.expires ? new Date(p.expires).getTime() : NaN;
        if (Number.isFinite(expMs) && expMs <= now) {
            continue;
        }
        if (id) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
        }

        const onsetMs = p.onset ? new Date(p.onset).getTime() : 0;
        rows.push({
            id,
            event: p.event,
            severity: p.severity,
            certainty: p.certainty,
            urgency: p.urgency,
            headline: p.headline,
            description: p.description,
            instruction: p.instruction,
            onset: onsetMs,
            expires: Number.isFinite(expMs) ? expMs : null,
            source: 'NOAA'
        });
    }

    rows.sort((a, b) => {
        const ds = nwsSeverityRank(a.severity) - nwsSeverityRank(b.severity);
        if (ds !== 0) {
            return ds;
        }
        const du = nwsUrgencyRank(a.urgency) - nwsUrgencyRank(b.urgency);
        if (du !== 0) {
            return du;
        }
        return (b.onset || 0) - (a.onset || 0);
    });

    return rows;
}

/**
 * Parse wind speed string (e.g., "10 to 15 mph")
 */
function parseWindSpeed(speedStr) {
    if (!speedStr) return 0;
    const match = speedStr.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

/**
 * Parse wind direction string to degrees
 */
function parseWindDirection(dirStr) {
    const directions = {
        'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
        'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
        'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
        'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
    };
    return directions[dirStr] || 0;
}

/**
 * Batch fetch current weather with rate limiting
 */
export async function fetchBatchWeather(samplingPoints) {
    const results = [];
    const delayBetweenRequests = 200; // NOAA doesn't specify rate limits, be conservative
    
    for (const point of samplingPoints) {
        try {
            const weatherData = await fetchCurrentWeather(point.latitude, point.longitude);
            results.push({
                pointId: point.id,
                ...weatherData
            });
            
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
        } catch (error) {
            console.error(`Failed to fetch NOAA weather for point ${point.id}:`, error);
            results.push({
                pointId: point.id,
                error: error.message
            });
        }
    }
    
    return results;
}
