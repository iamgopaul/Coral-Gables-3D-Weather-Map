/**
 * Open-Meteo API module - Free weather data with excellent coverage
 * No API key required, rate limit friendly
 */

const OPEN_METEO_MAX_ATTEMPTS = 6;

/** `current=` variables — shared by single- and multi-location requests */
const OPEN_METEO_CURRENT_VARS =
    'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,visibility';

const OPEN_METEO_UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';

/**
 * Fair-use: retry on HTTP 429 with backoff (and optional Retry-After seconds).
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function openMeteoFetch(url) {
    for (let attempt = 0; attempt < OPEN_METEO_MAX_ATTEMPTS; attempt++) {
        const response = await fetch(url);
        if (response.status === 429 && attempt < OPEN_METEO_MAX_ATTEMPTS - 1) {
            let delayMs = Math.min(22_000, 1800 * 2 ** attempt);
            const ra = response.headers.get('Retry-After');
            if (ra && /^\d+$/.test(ra.trim())) {
                delayMs = Math.max(delayMs, parseInt(ra.trim(), 10) * 1000);
            }
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
        }
        return response;
    }
    throw new Error('Open-Meteo fetch: exhausted retries');
}

/**
 * Fetch current weather from Open-Meteo
 */
export async function fetchCurrentWeather(latitude, longitude) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=${OPEN_METEO_CURRENT_VARS}&${OPEN_METEO_UNITS}`;

    try {
        const response = await openMeteoFetch(url);

        if (!response.ok) {
            throw new Error(`Open-Meteo API error: ${response.status}`);
        }

        const data = await response.json();
        return parseOpenMeteoData(data);
    } catch (error) {
        console.error('Open-Meteo fetch error:', error);
        throw error;
    }
}

/**
 * One HTTP round-trip for many coordinates (Open-Meteo returns a JSON array in request order).
 * @param {{ latitude: number, longitude: number }[]} points
 * @returns {Promise<object[]>} Parsed current conditions per point (same length as `points`)
 */
export async function fetchCurrentWeatherMany(points) {
    const n = points.length;
    if (n === 0) {
        return [];
    }
    if (n === 1) {
        const p = points[0];
        return [await fetchCurrentWeather(p.latitude, p.longitude)];
    }

    const lats = points.map((p) => p.latitude).join(',');
    const lons = points.map((p) => p.longitude).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=${OPEN_METEO_CURRENT_VARS}&${OPEN_METEO_UNITS}`;

    const response = await openMeteoFetch(url);
    if (!response.ok) {
        throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
        throw new Error('Open-Meteo batch: expected JSON array');
    }
    if (data.length !== n) {
        throw new Error(`Open-Meteo batch: expected ${n} location(s), got ${data.length}`);
    }

    return data.map((block) => parseOpenMeteoData(block));
}

/**
 * Weather code to description mapping (WMO Weather interpretation codes)
 */
function getWeatherDescription(code) {
    const weatherMap = {
        0: { weather: 'clear', description: 'Clear sky' },
        1: { weather: 'cloudy', description: 'Mainly clear' },
        2: { weather: 'cloudy', description: 'Partly cloudy' },
        3: { weather: 'cloudy', description: 'Overcast' },
        45: { weather: 'foggy', description: 'Foggy' },
        48: { weather: 'foggy', description: 'Depositing rime fog' },
        51: { weather: 'rain', description: 'Light drizzle' },
        53: { weather: 'rain', description: 'Moderate drizzle' },
        55: { weather: 'rain', description: 'Dense drizzle' },
        61: { weather: 'rain', description: 'Slight rain' },
        63: { weather: 'rain', description: 'Moderate rain' },
        65: { weather: 'rain', description: 'Heavy rain' },
        71: { weather: 'snow', description: 'Slight snow' },
        73: { weather: 'snow', description: 'Moderate snow' },
        75: { weather: 'snow', description: 'Heavy snow' },
        77: { weather: 'snow', description: 'Snow grains' },
        80: { weather: 'rain', description: 'Slight rain showers' },
        81: { weather: 'rain', description: 'Moderate rain showers' },
        82: { weather: 'rain', description: 'Violent rain showers' },
        85: { weather: 'snow', description: 'Slight snow showers' },
        86: { weather: 'snow', description: 'Heavy snow showers' },
        95: { weather: 'thunderstorm', description: 'Thunderstorm' },
        96: { weather: 'thunderstorm', description: 'Thunderstorm with slight hail' },
        99: { weather: 'thunderstorm', description: 'Thunderstorm with heavy hail' }
    };

    return weatherMap[code] || { weather: 'unknown', description: 'Unknown conditions' };
}

/**
 * Parse Open-Meteo current weather response
 */
function parseOpenMeteoData(data) {
    const current = data.current;
    const weatherInfo = getWeatherDescription(current.weather_code);

    return {
        temperature: current.temperature_2m,
        feelsLike: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        pressure: Math.round(current.pressure_msl), // Convert to mb approximation
        windSpeed: current.wind_speed_10m,
        windDirection: current.wind_direction_10m,
        windGust: current.wind_gusts_10m,
        precipitation: current.precipitation,
        cloudCover: current.cloud_cover,
        visibility: current.visibility && current.visibility > 0 ? current.visibility : null,
        weather: weatherInfo.weather,
        weatherDescription: weatherInfo.description,
        timestamp: Date.now(),
        source: 'Open-Meteo'
    };
}

/**
 * Fetch forecast data from Open-Meteo
 */
export async function fetchForecast(latitude, longitude) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=3`;

    try {
        const response = await openMeteoFetch(url);

        if (!response.ok) {
            throw new Error(`Open-Meteo Forecast API error: ${response.status}`);
        }

        const data = await response.json();
        return parseForecastData(data);
    } catch (error) {
        console.error('Open-Meteo forecast error:', error);
        throw error;
    }
}

/**
 * Parse Open-Meteo forecast response
 */
function parseForecastData(data) {
    const hourly = data.hourly;
    const forecasts = [];

    // Create 3-hour forecast intervals from hourly data
    for (let i = 0; i < hourly.time.length; i += 3) {
        const weatherInfo = getWeatherDescription(hourly.weather_code[i]);

        const pMsl = hourly.pressure_msl?.[i];
        forecasts.push({
            temperature: hourly.temperature_2m[i],
            feelsLike: hourly.temperature_2m[i], // Open-Meteo doesn't provide feels_like in forecast
            humidity: hourly.relative_humidity_2m[i],
            pressure:
                pMsl != null && pMsl !== undefined && !Number.isNaN(Number(pMsl))
                    ? Math.round(Number(pMsl))
                    : null,
            windSpeed: hourly.wind_speed_10m[i],
            windDirection: hourly.wind_direction_10m[i],
            windGust: hourly.wind_gusts_10m[i],
            precipitation: hourly.precipitation[i],
            weather: weatherInfo.weather,
            weatherDescription: weatherInfo.description,
            timestamp: new Date(hourly.time[i]).getTime()
        });
    }

    return {
        forecasts: forecasts,
        source: 'Open-Meteo'
    };
}

/**
 * Hourly time series for the recent past (and optional near future), for historical playback.
 * Uses `timezone=UTC` so every grid station gets identical `hourly.time` keys for alignment.
 * @returns {Promise<{ hourly: object[], source: string }>}
 */
export async function fetchHourlyPastWindow(latitude, longitude) {
    const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&hourly=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&past_days=2&forecast_days=0`;

    const response = await openMeteoFetch(url);

    if (!response.ok) {
        throw new Error(`Open-Meteo hourly API error: ${response.status}`);
    }

    const data = await response.json();
    return parseHourlyWindowData(data);
}

/**
 * @param {object} data — Open-Meteo forecast JSON with `hourly`
 * @returns {{ hourly: object[], source: string }}
 */
function parseHourlyWindowData(data) {
    const hourly = data.hourly;
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) {
        return { hourly: [], source: 'Open-Meteo' };
    }

    const rows = [];
    for (let i = 0; i < hourly.time.length; i++) {
        const weatherInfo = getWeatherDescription(hourly.weather_code[i]);
        const pMsl = hourly.pressure_msl?.[i];
        rows.push({
            timestamp: new Date(hourly.time[i]).getTime(),
            temperature: hourly.temperature_2m[i],
            feelsLike: hourly.temperature_2m[i],
            humidity: hourly.relative_humidity_2m[i],
            pressure:
                pMsl != null && pMsl !== undefined && !Number.isNaN(Number(pMsl))
                    ? Math.round(Number(pMsl))
                    : null,
            windSpeed: hourly.wind_speed_10m[i],
            windDirection: hourly.wind_direction_10m[i],
            windGust: hourly.wind_gusts_10m[i],
            precipitation: hourly.precipitation[i],
            weather: weatherInfo.weather,
            weatherDescription: weatherInfo.description,
            source: 'Open-Meteo'
        });
    }

    return { hourly: rows, source: 'Open-Meteo' };
}
