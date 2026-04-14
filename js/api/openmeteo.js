/**
 * Open-Meteo API module - Free weather data with excellent coverage
 * No API key required, rate limit friendly
 */

/**
 * Fetch current weather from Open-Meteo
 */
export async function fetchCurrentWeather(latitude, longitude) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,visibility&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;

    try {
        const response = await fetch(url);

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
        const response = await fetch(url);

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
